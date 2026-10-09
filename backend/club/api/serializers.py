"""What sign-up accepts, and what it refuses in French.

Validation runs here and in the browser both, as the subject requires; this
side is the one that decides.
"""

from collections.abc import Callable
from io import BytesIO
from typing import Any
from uuid import uuid4

from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import UploadedFile
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from PIL import ImageOps
from rest_framework import serializers
from rest_framework.exceptions import ErrorDetail
from rest_framework.fields import empty
from rest_framework.settings import api_settings

from club import attachments, images
from club.export import CATEGORY_KEYS
from club.models import (
    Attachment,
    Document,
    Entry,
    Membership,
    Season,
    Team,
    TeamSeason,
    User,
    VerificationRequest,
    WorkItem,
    fold_title,
    no_at_sign,
    not_an_anonymized_name,
    remove_after_commit,
)
from club.signup import reserved_email
from club.sources import check_source_url


def recheck(checks: dict[str, Callable[[], object]]) -> None:
    """For a write the database refused: another request passed the same
    checks at the same moment and wrote first. Its row is committed now, so
    running the checks again finds it and refuses this request as they would
    a second later, each under its field. If none finds anything, the caller
    re-raises the database's error as it came."""
    for field, check in checks.items():
        try:
            check()
        except serializers.ValidationError as taken:
            raise serializers.ValidationError({field: taken.detail}) from None


class SignUpSerializer(serializers.Serializer[User]):
    """The six things sign-up asks, plus the address, which is optional
    because the youngest members have none."""

    # allow_blank, not required=False: the form always sends the field, and an
    # empty string is how it says "I have no address".
    email = serializers.EmailField(required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, style={"input_type": "password"})
    display_name = serializers.CharField(
        max_length=80, validators=[no_at_sign, not_an_anonymized_name]
    )
    # Not a field: nobody declares their own role. Sign-up is open to whoever
    # has the address, so a role declared here would be a role granted by
    # asking for it — and #52 is about to build permissions on top of it. The
    # AssoConnect export confirms names, never roles, so nothing downstream
    # would ever catch the claim. A mentor is made by the club admin, who
    # knows who the mentors are: one club, one room.
    # Only ever written to the verification request: the club trusts what is
    # declared here exactly as far as the AssoConnect export confirms it.
    last_name = serializers.CharField(max_length=80)
    first_name = serializers.CharField(max_length=80)
    birth_date = serializers.DateField()

    def validate_email(self, value: str) -> str:
        # Stored lowercased, so a duplicate must be caught lowercased too.
        value = value.lower()
        if value and User.objects.filter(email=value).exists():
            raise serializers.ValidationError(
                "Cette adresse est déjà utilisée.", code="email_taken"
            )
        return value

    def validate_display_name(self, value: str) -> str:
        # On the stored folded column, not on a Lower() computed in the
        # database: SQLite's lower() is ASCII-only, so Élodie would fold to
        # itself and this check would miss a duplicate the constraint then
        # catches as a 500.
        taken = User.objects.filter(display_name_folded=value.casefold()).exists()
        if taken:
            # Same code and same sentence as the database constraint, which
            # stays underneath as the backstop for two callers racing past
            # this check (see `create`).
            raise serializers.ValidationError(
                "Ce nom d'affichage est déjà pris. Ajoutez une initiale, "
                "par exemple « Marie D. ».",
                code="display_name_taken",
            )
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        # Run after the other fields, because the similarity validator
        # compares the password against the name and address it accompanies.
        candidate = User(
            email=attrs.get("email", ""),
            display_name=attrs["display_name"],
        )
        try:
            validate_password(attrs["password"], candidate)
        except DjangoValidationError as refused:
            # Django's validators already name what is wrong —
            # password_too_short, password_too_common, password_too_similar.
            # Rebuilding them as plain strings would throw that away, which is
            # exactly what the front end needs.
            raise serializers.ValidationError(
                {
                    "password": [
                        ErrorDetail(str(message), code=error.code or "invalid")
                        for error in refused.error_list
                        for message in error.messages
                    ]
                }
            ) from refused
        return attrs

    def create(self, validated_data: dict[str, Any]) -> User:
        try:
            return self._create(validated_data)
        except IntegrityError:
            # Another sign-up passed the same checks at the same moment and
            # wrote first. Its account is committed now, so running the checks
            # again finds it and refuses this one as they would a second later.
            checks = {
                "email": self.validate_email,
                "display_name": self.validate_display_name,
            }
            for field, check in checks.items():
                try:
                    check(validated_data.get(field, ""))
                except serializers.ValidationError as taken:
                    raise serializers.ValidationError({field: taken.detail}) from None
            raise

    @transaction.atomic
    def _create(self, validated_data: dict[str, Any]) -> User:
        """All or nothing: an account without its verification request would
        never be matched, and would stay a minor for ever."""
        email = validated_data.get("email") or reserved_email(
            validated_data["first_name"], validated_data["last_name"]
        )
        user = User.objects.create_user(
            email=email,
            display_name=validated_data["display_name"],
            password=validated_data["password"],
        )
        VerificationRequest.objects.create(
            user=user,
            last_name=validated_data["last_name"],
            first_name=validated_data["first_name"],
            # Never written to the account: a minor could type any date, so
            # only the export may establish one.
            birth_date=validated_data["birth_date"],
        )
        return user


def _account_locked_error() -> serializers.ValidationError:
    # Told apart from a wrong password on purpose: a member locked out needs
    # to know to stop guessing and wait, not be left thinking they keep
    # mistyping it.
    return serializers.ValidationError(
        "Compte temporairement verrouillé après plusieurs tentatives "
        "infructueuses. Réessayez dans quelques minutes.",
        code="account_locked",
    )


class LoginSerializer(serializers.Serializer[dict[str, Any]]):
    """One field for both identifiers, because the account does not care
    which of the two reached it — `authenticate` tries the address, then the
    display name."""

    username = serializers.CharField()
    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        # Same two identifiers authenticate() itself tries — resolved here
        # too, ahead of it: a lock must refuse even the right password
        # without hashing it, and a failed attempt must be counted against
        # the right row, which a plain None from authenticate() would not
        # carry. `is_active` first: an admin suspension is a separate, older
        # state a stale lock must never get credit (or blame) for.
        username = attrs["username"].strip()
        account = User.objects.filter(
            Q(email=username.lower()) | Q(display_name_folded=username.casefold())
        ).first()
        if account is not None and account.is_active and account.is_locked:
            raise _account_locked_error()

        user = authenticate(
            self.context.get("request"),
            username=attrs["username"],
            password=attrs["password"],
        )
        if user is None:
            # Only an active account's own wrong password counts: an
            # already-suspended one reaches here too (ModelBackend refuses
            # an inactive user before checking it), but that is a decision
            # an admin already made, not a guess to start counting against.
            if account is not None and account.is_active:
                account.register_failed_login()
                if account.is_locked:
                    raise _account_locked_error()
            # One message for both failures: naming the unknown identifier
            # would turn the login form into a roster of the club.
            raise serializers.ValidationError(
                "Identifiant ou mot de passe incorrect.", code="bad_credentials"
            )
        user.register_successful_login()
        attrs["user"] = user
        return attrs


class DeleteAccountSerializer(serializers.Serializer[None]):
    """Just enough to read `password` out of `request.data` typed — the
    check against the account itself lives in `club/gdpr.py`'s
    `request_deletion`, the same place the rest of what deletion refuses
    for (no contact address, the last admin) already lives. Not required:
    a missing password is refused the same `wrong_password` way a wrong
    one is, rather than DRF's own, differently-shaped "this field is
    required"."""

    password = serializers.CharField(
        required=False, default="", write_only=True, style={"input_type": "password"}
    )


class CreateTeamSerializer(serializers.Serializer[Team]):
    """Creating a team and opening it for a season are one act, not two: a
    team with no season would have nowhere to hold members. `season` names
    the year FIRST assigns it, `Season.start_year`, rather than a surrogate
    id — the same key a person would type."""

    number = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=120)
    season = serializers.IntegerField(write_only=True)

    def validate_number(self, value: int) -> int:
        # A plain Serializer does not inherit Team.number's uniqueness from
        # the model the way a ModelSerializer would — checked here first so
        # a duplicate is a 400, same backstop pattern as display_name_taken,
        # rather than the IntegrityError Team.objects.create() would raise.
        if Team.objects.filter(number=value).exists():
            raise serializers.ValidationError(
                "Ce numéro d'équipe est déjà utilisé.", code="team_number_taken"
            )
        return value

    def validate_season(self, value: int) -> Season:
        try:
            return Season.objects.get(start_year=value)
        except Season.DoesNotExist:
            raise serializers.ValidationError(
                "Cette saison n'existe pas.", code="season_not_found"
            ) from None

    def create(self, validated_data: dict[str, Any]) -> Team:
        try:
            return self._create(validated_data)
        except IntegrityError:
            recheck({"number": lambda: self.validate_number(validated_data["number"])})
            raise

    @transaction.atomic
    def _create(self, validated_data: dict[str, Any]) -> Team:
        season = validated_data.pop("season")
        team = Team.objects.create(**validated_data)
        TeamSeason.objects.create(team=team, season=season)
        return team


class RenameTeamSerializer(serializers.Serializer[Team]):
    """Only the name — `number` is FIRST's, never the club's to rewrite."""

    name = serializers.CharField(max_length=120)


class UserSearchSerializer(serializers.Serializer[User]):
    """The query string of the member list: `search` absent is the full list,
    present — even blank — is the typeahead."""

    search = serializers.CharField(required=False, allow_blank=True)
    team_season = serializers.PrimaryKeyRelatedField(
        queryset=TeamSeason.objects.all(), required=False
    )


class AddMembershipSerializer(serializers.Serializer[Membership]):
    """The database constraint (`unique_membership_per_team_season`) already
    refuses a duplicate — checked here first so a coded 400 is the answer,
    and a race that still reaches the constraint is refused the same way
    (see `create`)."""

    user = serializers.PrimaryKeyRelatedField(queryset=User.objects.all())
    team_season = serializers.PrimaryKeyRelatedField(queryset=TeamSeason.objects.all())

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        exists = Membership.objects.filter(
            user=attrs["user"], team_season=attrs["team_season"]
        ).exists()
        if exists:
            raise serializers.ValidationError(
                "Ce membre est déjà affecté à cette équipe.",
                code="membership_exists",
            )
        return attrs

    def create(self, validated_data: dict[str, Any]) -> Membership:
        try:
            # A savepoint of its own, so a refused write leaves the
            # transaction usable for the check that follows.
            with transaction.atomic():
                return Membership.objects.create(**validated_data)
        except IntegrityError:
            # The check spans both fields, so its refusal names neither.
            key = api_settings.NON_FIELD_ERRORS_KEY
            recheck({key: lambda: self.validate(validated_data)})
            raise


class OpenWorkItemSerializer(serializers.Serializer[WorkItem]):
    """Opening a work item is starting on it."""

    title = serializers.CharField(max_length=120)
    on_robot = serializers.BooleanField(default=False)

    def validate_title(self, value: str) -> str:
        # Checked here so a duplicate is a coded 400; a race that reaches the
        # folded unique constraint is refused the same way (see `create`).
        taken = WorkItem.objects.filter(
            team_season=self.context["team_season"], title_folded=fold_title(value)
        )
        if taken.exists():
            raise serializers.ValidationError(
                "Ce chantier existe déjà dans l'équipe.", code="work_item_title_taken"
            )
        return value

    def create(self, validated_data: dict[str, Any]) -> WorkItem:
        try:
            with transaction.atomic():
                return WorkItem.objects.create(
                    team_season=self.context["team_season"], **validated_data
                )
        except IntegrityError:
            recheck({"title": lambda: self.validate_title(validated_data["title"])})
            raise


class WorkItemStatusSerializer(serializers.Serializer[WorkItem]):
    """Closing, and reopening on purpose: a closed work item is read-only
    until then. Why it was dropped is asked, since that is what the notebook
    would lose; finishing or reopening may say why too. The reason becomes a
    note by whoever changed the status, written with it."""

    status = serializers.ChoiceField(choices=WorkItem.Status.choices)
    reason = serializers.CharField(required=False, allow_blank=True)

    def validate_status(self, value: str) -> str:
        instance = self.instance
        assert isinstance(instance, WorkItem)
        if value == WorkItem.Status.OPEN and instance.status == WorkItem.Status.OPEN:
            raise serializers.ValidationError(
                "Ce chantier est déjà ouvert.", code="already_open"
            )
        # A robot subsystem goes to tuning, then repair, and back again until
        # the last competition — what ends it is the season, not a judgement
        # that it's "finished". Off the robot, some work items do end (a
        # tournament has taken place, a file has been sent), and `done` is
        # right for those.
        if value == WorkItem.Status.DONE and instance.on_robot:
            raise serializers.ValidationError(
                "Un chantier sur le robot ne se termine pas, il s'abandonne.",
                code="done_on_robot",
            )
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        attrs["reason"] = attrs.get("reason", "").strip()
        if attrs["status"] == WorkItem.Status.DROPPED and not attrs["reason"]:
            raise serializers.ValidationError(
                {
                    "reason": serializers.ErrorDetail(
                        "Dites pourquoi ce chantier est abandonné.",
                        code="reason_required",
                    )
                }
            )
        return attrs

    @transaction.atomic
    def update(self, instance: WorkItem, validated_data: dict[str, Any]) -> WorkItem:
        reopening = validated_data["status"] == WorkItem.Status.OPEN
        instance.status = validated_data["status"]
        instance.closed_at = None if reopening else timezone.now()
        instance.save(update_fields=["status", "closed_at"])
        if validated_data["reason"]:
            Entry.objects.create(
                team_season=instance.team_season,
                author=self.context["author"],
                work_item=instance,
                type=Entry.Type.NOTE,
                body=validated_data["reason"],
            )
        return instance


class TickSerializer(serializers.Serializer[Entry]):
    step = serializers.ChoiceField(choices=Entry.Step.choices, required=False)


class WriteProgressSerializer(serializers.Serializer[Entry]):
    addition = serializers.CharField(allow_blank=True, required=False)
    step = serializers.ChoiceField(choices=Entry.Step.choices, required=False)
    handover = serializers.CharField(allow_blank=True, required=False)
    handover_was = serializers.CharField(allow_blank=True, required=False)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        """A handover change without what it started from would erase blind.
        `body` is refused, not ignored: an outdated screen still sending it
        would otherwise be told its text was saved."""
        if "body" in self.initial_data:
            raise serializers.ValidationError(
                {"body": "Le texte d'une avancée ne se remplace pas : ajoutez-y."},
                code="use_addition",
            )
        if "handover" in attrs and "handover_was" not in attrs:
            raise serializers.ValidationError(
                {"handover_was": "Ce champ est obligatoire."}, code="required"
            )
        return attrs


class CorrectionSerializer(serializers.Serializer[Entry]):
    """A mentor's correction, with the text it was written over."""

    body = serializers.CharField(allow_blank=True)
    body_was = serializers.CharField(allow_blank=True)


class NoteSerializer(serializers.Serializer[Entry]):
    body = serializers.CharField()
    work_item = serializers.PrimaryKeyRelatedField(
        queryset=WorkItem.objects.all(), required=False
    )
    client_id = serializers.UUIDField(required=False)

    def validate_work_item(self, value: WorkItem) -> WorkItem:
        if value.team_season != self.context["team_season"]:
            raise serializers.ValidationError(
                "Ce chantier n'est pas celui de l'équipe.",
                code="work_item_not_in_team",
            )
        return value

    def create(self, validated_data: dict[str, Any]) -> Entry:
        return Entry.objects.create(
            team_season=self.context["team_season"],
            author=self.context["author"],
            type=Entry.Type.NOTE,
            **validated_data,
        )


class DecisionSerializer(NoteSerializer):
    """The one trace where someone else ticks who was there: a meeting is
    seen by all, so the author's word is enough, and it counts no one
    present."""

    attendees = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), many=True, required=False
    )

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        # Replay is a note concept (NoteCreateView): offline decisions are
        # not the problem #154 was about, and inheriting the field without
        # inheriting that view's guards would let a decision collide with,
        # or be mistaken for, a note sharing its (author, client_id).
        super().__init__(*args, **kwargs)
        del self.fields["client_id"]

    def validate_attendees(self, value: list[User]) -> list[User]:
        members = Membership.objects.filter(team_season=self.context["team_season"])
        for user in value:
            if (
                user.club_role != User.ClubRole.MENTOR
                and not members.filter(user=user).exists()
            ):
                raise serializers.ValidationError(
                    f"{user.display_name} n'est ni de l'équipe ni mentor.",
                    code="attendee_not_in_team",
                )
        return value

    def create(self, validated_data: dict[str, Any]) -> Entry:
        attendees = validated_data.pop("attendees", [])
        author = self.context["author"]
        with transaction.atomic():
            entry = Entry.objects.create(
                team_season=self.context["team_season"],
                author=author,
                type=Entry.Type.DECISION,
                **validated_data,
            )
            entry.participants.set({author, *attendees})
        return entry


class DaySerializer(serializers.Serializer[None]):
    day = serializers.DateField()


class PeriodSerializer(serializers.Serializer[None]):
    since = serializers.DateField()
    until = serializers.DateField()

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if attrs["since"] > attrs["until"]:
            raise serializers.ValidationError(
                "La date de début doit précéder la date de fin.",
                code="period_reversed",
            )
        return attrs


class ActivityAnalyticsSerializer(PeriodSerializer):
    format = serializers.ChoiceField(choices=["json", "csv"], default="json")
    on_robot = serializers.BooleanField(required=False)
    report = serializers.ChoiceField(choices=["daily", "full"], default="daily")


class ExportSerializer(serializers.Serializer[None]):
    format = serializers.ChoiceField(choices=["markdown"], default="markdown")
    category = serializers.ChoiceField(choices=CATEGORY_KEYS, required=False)
    work_item = serializers.PrimaryKeyRelatedField(
        queryset=WorkItem.objects.all(), required=False
    )

    def validate_work_item(self, value: WorkItem) -> WorkItem:
        if value.team_season != self.context["team_season"]:
            raise serializers.ValidationError(
                "Ce chantier n'est pas celui de l'équipe.",
                code="work_item_not_in_team",
            )
        return value


class AnswerField(serializers.BooleanField):
    """A yes or no that must be given: a form leaves an unticked box out, so
    DRF reads a missing boolean as False, and a forgotten answer would pass
    for "no"."""

    default_empty_html = empty


class AttachmentSerializer(serializers.Serializer[Attachment]):
    file = serializers.FileField()
    people_recognisable = AnswerField()

    def validate_file(self, value: UploadedFile) -> attachments.Checked:
        return attachments.check(value)

    def create(self, validated_data: dict[str, Any]) -> Attachment:
        checked = validated_data["file"]
        return Attachment.objects.create(
            entry=self.context["entry"],
            uploaded_by=self.context["user"],
            file=checked.file,
            name=checked.name,
            content_type=checked.content_type,
            people_recognisable=validated_data["people_recognisable"],
        )


class AvatarSerializer(serializers.Serializer[User]):
    """Trusts neither the file's extension nor the type the browser announces,
    only what Pillow reads in it. What is stored is always re-encoded: upright,
    at most 512 pixels a side, and stripped of the photo's metadata, which on a
    phone photo includes where it was taken."""

    MAX_BYTES = 10 * 1024 * 1024
    # HEIF is how iPhones take their photos.
    FORMATS = {"JPEG", "PNG", "WEBP", "HEIF"}
    SIDE = 512

    avatar = serializers.FileField()

    def validate_avatar(self, value: UploadedFile) -> ContentFile:
        # Django sizes every file it receives; the type allows None only for
        # files built by hand.
        assert value.size is not None
        # Before Pillow opens anything, so an oversized file costs nothing.
        if value.size > self.MAX_BYTES:
            raise serializers.ValidationError(
                "Cette photo dépasse 10 Mo.", code="avatar_too_large"
            )
        try:
            image = images.decode(value)
        except images.TooManyPixels:
            raise serializers.ValidationError(
                "Cette photo compte trop de pixels.", code="avatar_too_many_pixels"
            ) from None
        except images.Unreadable:
            raise serializers.ValidationError(
                "Ce fichier n'est pas une image.", code="avatar_not_an_image"
            ) from None
        if image.format not in self.FORMATS:
            raise serializers.ValidationError(
                "Formats acceptés : JPEG, PNG, WebP ou HEIC.",
                code="avatar_format_refused",
            )
        upright = ImageOps.exif_transpose(image).convert("RGBA")
        upright.thumbnail((self.SIDE, self.SIDE))
        encoded = BytesIO()
        upright.save(encoded, "WEBP")
        # A random name: the file says nothing about whose face it is.
        return ContentFile(encoded.getvalue(), name=f"{uuid4().hex}.webp")

    def update(self, instance: User, validated_data: dict[str, Any]) -> User:
        previous = instance.avatar.name
        instance.avatar = validated_data["avatar"]
        instance.save(update_fields=["avatar"])
        remove_after_commit(instance, previous)
        return instance


class UserRoleSerializer(serializers.Serializer[User]):
    """What an admin manages about another account: making them a mentor,
    making them an administrator, and lifting or imposing a suspension.
    Everything else — the name, the password — stays where it already is,
    the Django admin (README, "Sessions")."""

    club_role = serializers.ChoiceField(choices=User.ClubRole.choices, required=False)
    is_club_admin = serializers.BooleanField(required=False)
    is_active = serializers.BooleanField(required=False)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        # Checked against the account's *resulting* state, not just the
        # fields this call happens to touch — an admin demoted to student
        # in one request and left with the flag from a previous one would
        # be just as inconsistent as setting both wrong at once.
        instance = self.instance
        assert isinstance(instance, User)
        club_role = attrs.get("club_role", instance.club_role)
        is_club_admin = attrs.get("is_club_admin", instance.is_club_admin)
        if is_club_admin and club_role != User.ClubRole.MENTOR:
            raise serializers.ValidationError(
                "Un administrateur doit être mentor.", code="admin_must_be_mentor"
            )
        return attrs

    def update(self, instance: User, validated_data: dict[str, Any]) -> User:
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save(update_fields=list(validated_data))
        return instance


class AddSourceSerializer(serializers.Serializer[None]):
    # `source` is also a Field attribute in DRF; the typing clash is harmless here.
    source = serializers.ChoiceField(choices=[Document.Source.GAME_MANUAL])  # type: ignore[assignment]
    url = serializers.URLField(max_length=500)

    def validate_url(self, value: str) -> str:
        try:
            return check_source_url(value)
        except ValueError as error:
            raise serializers.ValidationError(
                str(error), code="source_not_allowed"
            ) from error


class AskSerializer(serializers.Serializer[None]):
    question = serializers.CharField(max_length=500)


class ReadNotificationsSerializer(serializers.Serializer[None]):
    """Without `ids`, every notification of the member's is read."""

    # SQLite's integers stop at 2**63 - 1: past it, the query fails rather
    # than finding nothing.
    ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1, max_value=2**63 - 1),
        required=False,
    )
