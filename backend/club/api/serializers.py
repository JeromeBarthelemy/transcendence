"""What sign-up accepts, and what it refuses in French.

Validation runs here and in the browser both, as the subject requires; this
side is the one that decides.
"""

from typing import Any

from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ErrorDetail

from club.models import (
    Membership,
    Season,
    Team,
    TeamSeason,
    User,
    VerificationRequest,
    WorkItem,
    fold_title,
    no_at_sign,
)
from club.signup import reserved_email


class SignUpSerializer(serializers.Serializer[User]):
    """The six things sign-up asks, plus the address, which is optional
    because the youngest members have none."""

    # allow_blank, not required=False: the form always sends the field, and an
    # empty string is how it says "I have no address".
    email = serializers.EmailField(required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, style={"input_type": "password"})
    display_name = serializers.CharField(max_length=80, validators=[no_at_sign])
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
            # stays underneath as the backstop: two callers racing would
            # otherwise reach it and get a 500.
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

    @transaction.atomic
    def create(self, validated_data: dict[str, Any]) -> User:
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


class LoginSerializer(serializers.Serializer[dict[str, Any]]):
    """One field for both identifiers, because the account does not care
    which of the two reached it — `authenticate` tries the address, then the
    display name."""

    username = serializers.CharField()
    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        user = authenticate(
            self.context.get("request"),
            username=attrs["username"],
            password=attrs["password"],
        )
        if user is None:
            # One message for both failures: naming the unknown identifier
            # would turn the login form into a roster of the club.
            raise serializers.ValidationError(
                "Identifiant ou mot de passe incorrect.", code="bad_credentials"
            )
        attrs["user"] = user
        return attrs


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

    @transaction.atomic
    def create(self, validated_data: dict[str, Any]) -> Team:
        season = validated_data.pop("season")
        team = Team.objects.create(**validated_data)
        TeamSeason.objects.create(team=team, season=season)
        return team


class RenameTeamSerializer(serializers.Serializer[Team]):
    """Only the name — `number` is FIRST's, never the club's to rewrite."""

    name = serializers.CharField(max_length=120)


class AddMembershipSerializer(serializers.Serializer[Membership]):
    """The database constraint (`unique_membership_per_team_season`) already
    refuses a duplicate — checked here first so a race is the only way it is
    ever actually reached, same backstop pattern as sign-up's display name."""

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
        return Membership.objects.create(**validated_data)


class OpenWorkItemSerializer(serializers.Serializer[WorkItem]):
    """Opening a work item is starting on it; a work item listed in September
    is only suggested, and opened by its first progress."""

    title = serializers.CharField(max_length=120)
    on_robot = serializers.BooleanField(default=False)
    suggested = serializers.BooleanField(default=False, write_only=True)

    def validate_title(self, value: str) -> str:
        # Checked here so a duplicate is a coded 400; the folded unique
        # constraint stays the backstop a race would reach.
        taken = WorkItem.objects.filter(
            team_season=self.context["team_season"], title_folded=fold_title(value)
        )
        if taken.exists():
            raise serializers.ValidationError(
                "Ce chantier existe déjà dans l'équipe.", code="work_item_title_taken"
            )
        return value

    def create(self, validated_data: dict[str, Any]) -> WorkItem:
        suggested = validated_data.pop("suggested")
        return WorkItem.objects.create(
            team_season=self.context["team_season"],
            status=WorkItem.Status.SUGGESTED if suggested else WorkItem.Status.OPEN,
            opened_at=None if suggested else timezone.now(),
            **validated_data,
        )


class CloseWorkItemSerializer(serializers.Serializer[WorkItem]):
    """Only closing: a work item is reopened by working on it again."""

    status = serializers.ChoiceField(
        choices=[WorkItem.Status.DONE, WorkItem.Status.DROPPED]
    )

    def update(self, instance: WorkItem, validated_data: dict[str, Any]) -> WorkItem:
        instance.status = validated_data["status"]
        instance.closed_at = timezone.now()
        instance.save(update_fields=["status", "closed_at"])
        return instance
