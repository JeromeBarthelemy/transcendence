"""Club foundation: accounts, teams, seasons, memberships, image-rights consent.

One deployment serves one club, so there is no Club model: the organisation
the subject asks us to create, edit and delete is the team.
"""

import unicodedata
from datetime import date
from typing import Any

from django.conf import settings
from django.contrib.auth.models import (
    AbstractBaseUser,
    BaseUserManager,
    PermissionsMixin,
)
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models, transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver
from django.utils import timezone


def no_at_sign(value: str) -> None:
    """A display name must never be mistakable for an address: it is what
    lets login accept either identifier without having to guess which was
    typed."""
    if "@" in value:
        # The code is what the front end branches on, the message what it
        # shows: rewording one must never break the other.
        raise ValidationError(
            "Un nom d'affichage ne peut pas contenir « @ ».",
            code="display_name_has_at_sign",
        )


# What `anonymize` (club/gdpr.py) renames an account to, followed by its id.
ANONYMIZED_NAME = "Ancien membre"


def not_an_anonymized_name(value: str) -> None:
    """Names are unique: a member already called "Ancien membre 13" would
    make the anonymization of account 13 fail, and with it an erasure the
    club owes. Reserved as typed by hand — any case, accent or spacing —
    which also makes the name a reliable mark of an anonymized account."""
    if fold_title(value).startswith(fold_title(ANONYMIZED_NAME)):
        raise ValidationError(
            "Ce nom est réservé aux comptes des anciens membres.",
            code="display_name_reserved",
        )


class UserManager(BaseUserManager["User"]):
    """Required by a custom user model; `createsuperuser` goes through it.
    The AssoConnect import never does: it verifies accounts, it never creates
    one."""

    use_in_migrations = True

    def create_user(
        self, email: str, display_name: str, password: str | None = None, **extra: Any
    ) -> "User":
        """The only door an account comes through, `createsuperuser` included."""
        if not email:
            raise ValueError(
                "Un compte exige une adresse e-mail : c'est l'identifiant de connexion."
            )
        user = self.model(
            # normalize_email only lowercases the domain, and SQLite's unique
            # constraint is case-sensitive: Ada@ and ada@ would be two accounts.
            email=self.normalize_email(email).lower(),
            display_name=display_name,
            **extra,
        )
        # password=None leaves the password unusable, which is what an
        # account created without one deserves until someone sets it.
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(
        self, email: str, display_name: str, password: str | None = None, **extra: Any
    ) -> "User":
        """The account of whoever installs the instance; everyone else signs
        up for themselves."""
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        # The first account belongs to whoever installs the instance and then
        # registers everyone else. It is a minor until verified, like any other.
        extra.setdefault("club_role", User.ClubRole.MENTOR)
        extra.setdefault("is_club_admin", True)
        if extra.get("is_staff") is not True:
            raise ValueError("Un superutilisateur doit avoir is_staff=True.")
        if extra.get("is_superuser") is not True:
            raise ValueError("Un superutilisateur doit avoir is_superuser=True.")
        return self.create_user(email, display_name, password, **extra)

    def get_by_natural_key(self, username: str | None) -> "User":
        """Login looks the account up here, and emails are stored lowercased."""
        if username is not None:
            username = username.lower()
        return super().get_by_natural_key(username)


class User(AbstractBaseUser, PermissionsMixin):
    """An active account is club membership. Parents have no account.
    Suspended (`is_active=False`) is temporary; a member who asks to leave
    for good is anonymized instead (`club/gdpr.py`, `anonymize`) — the row
    stays, so what they wrote stays attributed, but nothing else about who
    they were does."""

    class ClubRole(models.TextChoices):
        STUDENT = "student", "élève"
        MENTOR = "mentor", "mentor"

    email = models.EmailField("adresse e-mail", unique=True)

    # Where confirmations go, which is not where the credential points: a
    # minor's rights are exercised by their legal guardian, and the login
    # address may be on a domain that delivers nothing. Never unique —
    # siblings share one mailbox — and never a key.
    contact_email = models.EmailField("adresse de contact", blank=True)
    display_name = models.CharField(
        "nom d'affichage",
        max_length=80,
        validators=[no_at_sign, not_an_anonymized_name],
    )
    # The name folded for comparison, because SQLite cannot fold it for us:
    # its lower() is ASCII-only, so Lower("display_name") leaves Élodie as
    # Élodie and the uniqueness it was meant to enforce would miss exactly the
    # names a French club is full of. Wider than the name it folds: casefold()
    # may lengthen (ß becomes ss).
    display_name_folded = models.CharField(max_length=160, editable=False, default="")
    avatar = models.ImageField(upload_to="avatars/", blank=True)

    # Both come from AssoConnect when the account is verified; until then the
    # account is a minor, whatever it declared.
    assoconnect_id = models.CharField(
        "numéro d'adhérent", max_length=30, unique=True, null=True, blank=True
    )
    birth_date = models.DateField("date de naissance", null=True, blank=True)

    club_role = models.CharField(
        "rôle au club",
        max_length=10,
        choices=ClubRole.choices,
        default=ClubRole.STUDENT,
    )

    # A flag rather than a third role: administrators are mentors who also
    # administrate. Distinct from `is_staff`, which opens the Django admin and
    # therefore the raw database.
    is_club_admin = models.BooleanField("administrateur du club", default=False)

    is_active = models.BooleanField("actif", default=True)
    is_staff = models.BooleanField("accès à l'admin", default=False)
    date_joined = models.DateTimeField("date d'inscription", default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["display_name"]

    class Meta:
        ordering = ["display_name"]
        verbose_name = "membre"
        verbose_name_plural = "membres"
        constraints = [
            # On the folded column, not on the name itself: SQLite's unique
            # index is case-sensitive, so Lina and lina would be two members
            # showing up as the same name under every attribution. Folding in
            # Python and storing the result is what makes that true for
            # Élodie as well as for Lina.
            models.UniqueConstraint(
                "display_name_folded",
                name="unique_display_name_regardless_of_case",
                violation_error_code="display_name_taken",
                violation_error_message=(
                    "Ce nom d'affichage est déjà pris. Ajoutez une initiale, "
                    "par exemple « Marie D. »."
                ),
            ),
        ]

    def __str__(self) -> str:
        return self.display_name

    def clean(self) -> None:
        super().clean()
        # full_clean() runs clean() before the uniqueness check, so a form
        # reports a duplicate differing only by case instead of crashing on save.
        self.email = self.email.lower()
        self.display_name_folded = self.display_name.casefold()

    def save(self, *args: Any, **kwargs: Any) -> None:
        # Not only in clean(): create_user() and the admin's own writes never
        # call full_clean(), and a folded column that lags its name is worse
        # than none at all.
        self.display_name_folded = self.display_name.casefold()
        update_fields = kwargs.get("update_fields")
        if update_fields is not None and "display_name" in update_fields:
            kwargs["update_fields"] = {*update_fields, "display_name_folded"}
        super().save(*args, **kwargs)

    @property
    def is_mentor(self) -> bool:
        return self.club_role == self.ClubRole.MENTOR

    @property
    def is_minor(self) -> bool:
        return self.is_minor_on(timezone.localdate())

    def is_minor_on(self, day: date) -> bool:
        """Adulthood is established, never assumed: only a birth date that
        came with verification counts."""
        if self.assoconnect_id is None or self.birth_date is None:
            return True
        birthday_passed = (day.month, day.day) >= (
            self.birth_date.month,
            self.birth_date.day,
        )
        age = day.year - self.birth_date.year - (0 if birthday_passed else 1)
        return age < 18


def remove_after_commit(user: User, name: str | None) -> None:
    """Only once the account no longer points at it: removed any earlier, a
    failed save would leave the account with a photo that is gone. Shared
    by the avatar API and account anonymization (`club/gdpr.py`) — both
    replace or clear `avatar` and need the old file gone the same way."""
    if name:
        storage = user.avatar.storage
        transaction.on_commit(lambda: storage.delete(name))


class VerificationRequest(models.Model):
    """What sign-up typed to match the account with its AssoConnect membership.
    Only used for matching: a minor could type any birth date, so this one
    never decides adulthood. Deleted once the account is verified."""

    # One per account: a second one would leave the import unsure which to
    # believe.
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="verification_request",
    )
    last_name = models.CharField("nom", max_length=80)
    first_name = models.CharField("prénom", max_length=80)
    birth_date = models.DateField("date de naissance déclarée")
    created_at = models.DateTimeField("demandée le", auto_now_add=True)

    class Meta:
        verbose_name = "demande de vérification"
        verbose_name_plural = "demandes de vérification"

    def __str__(self) -> str:
        return f"{self.first_name} {self.last_name} ({self.user})"


class Season(models.Model):
    """Scoping by season archives past seasons for free: their objects stay
    readable, unmigrated."""

    # The end year is always the next one, so it is not stored.
    start_year = models.PositiveSmallIntegerField("année de début", unique=True)
    # FIRST never reuses a game name: a duplicate is the same season entered twice.
    game_name = models.CharField("nom du jeu", max_length=60, unique=True)

    class Meta:
        ordering = ["-start_year"]
        verbose_name = "saison"

    def __str__(self) -> str:
        return f"{self.label} · {self.game_name}"

    @property
    def label(self) -> str:
        """A season spans two years; only the first is stored."""
        return f"{self.start_year}-{self.start_year + 1}"


class Team(models.Model):
    """A FIRST team, the same one from season to season: what changes each
    year — roster, notebook, workstreams — hangs on TeamSeason instead."""

    # Assigned by FIRST, unique worldwide.
    number = models.PositiveIntegerField(unique=True, validators=[MinValueValidator(1)])
    name = models.CharField(max_length=120)

    class Meta:
        ordering = ["number"]
        verbose_name = "équipe"

    def __str__(self) -> str:
        return f"{self.number} — {self.name}"


class TeamSeason(models.Model):
    """A team within one season: the notebook, workstreams and roster attach
    here."""

    # PROTECT: deleting a team or a season must not cascade through seasons of
    # work. A team with no history can still be deleted.
    team = models.ForeignKey(
        Team, on_delete=models.PROTECT, related_name="team_seasons"
    )
    season = models.ForeignKey(
        Season, on_delete=models.PROTECT, related_name="team_seasons"
    )

    class Meta:
        ordering = ["-season__start_year", "team__number"]
        verbose_name = "équipe-saison"
        verbose_name_plural = "équipes-saisons"
        constraints = [
            models.UniqueConstraint(
                fields=["team", "season"], name="unique_team_per_season"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.team.number} - {self.season.game_name}"


class Membership(models.Model):
    """Belonging to a team for a season; it carries no role. An explicit model
    rather than a ManyToManyField, so a column can be added without converting
    the join table."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    team_season = models.ForeignKey(
        TeamSeason, on_delete=models.CASCADE, related_name="memberships"
    )

    class Meta:
        # Not « adhésion »: in the club that means joining the association in
        # AssoConnect, which a member can do before being on any team.
        verbose_name = "affectation"
        constraints = [
            models.UniqueConstraint(
                fields=["user", "team_season"], name="unique_membership_per_team_season"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user} ({self.team_season})"


class WorkshopSlot(models.Model):
    """A usual workshop time, when every team is expected: a slot day with no
    progress is a gap. Changing a slot closes this row and opens another, so
    what was expected in November stays expected."""

    class Weekday(models.IntegerChoices):
        # Numbered as date.weekday() numbers them.
        MONDAY = 0, "lundi"
        TUESDAY = 1, "mardi"
        WEDNESDAY = 2, "mercredi"
        THURSDAY = 3, "jeudi"
        FRIDAY = 4, "vendredi"
        SATURDAY = 5, "samedi"
        SUNDAY = 6, "dimanche"

    season = models.ForeignKey(
        Season, on_delete=models.PROTECT, related_name="workshop_slots"
    )
    weekday = models.PositiveSmallIntegerField("jour", choices=Weekday.choices)
    # Shown, never computed with: nothing closes at the end of a slot.
    start_time = models.TimeField("début")
    end_time = models.TimeField("fin", null=True, blank=True)
    valid_from = models.DateField("à partir du")
    valid_until = models.DateField("jusqu'au", null=True, blank=True)

    class Meta:
        ordering = ["weekday", "start_time"]
        verbose_name = "créneau d'atelier"
        verbose_name_plural = "créneaux d'atelier"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(valid_until__isnull=True)
                | models.Q(valid_until__gte=models.F("valid_from")),
                name="slot_ends_after_it_starts",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.get_weekday_display()} {self.start_time:%H:%M}"


def fold_title(title: str) -> str:
    """A title as it is compared: typed by hand, the same subject comes back
    with another case, an accent missing or a double space."""
    without_accents = "".join(
        letter
        for letter in unicodedata.normalize("NFKD", title)
        if not unicodedata.combining(letter)
    )
    return " ".join(without_accents.casefold().split())


class WorkItem(models.Model):
    """A chantier: the thread a team reopens over a season, around one robot
    subsystem or one subject off the robot. Its title is the subsystem, so
    the robot needs no separate subsystem list."""

    class Status(models.TextChoices):
        # Listed in September, not started: the pre-season list is this table.
        SUGGESTED = "suggested", "suggéré"
        OPEN = "open", "ouvert"
        DONE = "done", "terminé"
        DROPPED = "dropped", "abandonné"

    team_season = models.ForeignKey(
        TeamSeason, on_delete=models.PROTECT, related_name="work_items"
    )
    title = models.CharField("titre", max_length=120)
    # Folded in Python and stored, like User.display_name_folded: SQLite folds
    # neither accents nor anything beyond ASCII. Wider than the title, since
    # casefold() may lengthen it.
    title_folded = models.CharField(max_length=240, editable=False, default="")
    # Only a robot work item has steps.
    on_robot = models.BooleanField("sur le robot", default=False)
    status = models.CharField(
        "statut", max_length=10, choices=Status.choices, default=Status.OPEN
    )
    opened_at = models.DateTimeField("ouvert le", null=True, blank=True)
    closed_at = models.DateTimeField("fermé le", null=True, blank=True)

    class Meta:
        ordering = ["title"]
        verbose_name = "chantier"
        constraints = [
            models.UniqueConstraint(
                fields=["team_season", "title_folded"],
                name="unique_work_item_title_per_team",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.team_season})"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.title_folded = fold_title(self.title)
        update_fields = kwargs.get("update_fields")
        if update_fields is not None and "title" in update_fields:
            kwargs["update_fields"] = {*update_fields, "title_folded"}
        super().save(*args, **kwargs)

    @property
    def current_step(self) -> "str | None":
        """Never stored: the step of the latest progress, so moving back a
        step is an entry like any other."""
        latest = (
            self.entries.filter(type=Entry.Type.PROGRESS)
            .order_by("-occurred_at", "-id")
            .first()
        )
        return latest.step if latest else None

    @property
    def last_handover(self) -> "Entry | None":
        """The progress whose handover is shown: the latest that left one. It
        carries who left it and when; a progress with nothing to hand over
        leaves the previous one in place."""
        return (
            self.entries.filter(type=Entry.Type.PROGRESS)
            .exclude(handover="")
            .order_by("-occurred_at", "-id")
            .first()
        )


class Entry(models.Model):
    """A trace: anything the notebook can cite, whatever its kind. One table
    so that a citation points at one kind of thing."""

    class Type(models.TextChoices):
        PROGRESS = "progress", "avancée"
        NOTE = "note", "remarque"
        DECISION = "decision", "décision"

    class Step(models.TextChoices):
        """Fixed and ordered; repair happens at any point, off the sequence."""

        BRAINSTORMING = "brainstorming", "brainstorming"
        PROTOTYPING = "prototyping", "prototypage"
        BUILDING = "building", "construction"
        DRY_TESTS = "dry_tests", "tests à vide"
        INTEGRATION = "integration", "intégration"
        TEST_ZERO = "test_zero", "test zéro"
        TUNING = "tuning", "optimisation"
        REPAIR = "repair", "réparation"

    team_season = models.ForeignKey(
        TeamSeason, on_delete=models.PROTECT, related_name="entries"
    )
    # PROTECT until the GDPR module decides what a deleted member's traces become.
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="entries"
    )
    work_item = models.ForeignKey(
        WorkItem,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="entries",
    )
    type = models.CharField("type", max_length=10, choices=Type.choices)
    body = models.TextField("texte", blank=True)
    # What to know before picking the work item up again, and what not to undo.
    handover = models.TextField("passation", blank=True)
    step = models.CharField(
        "étape", max_length=15, choices=Step.choices, null=True, blank=True
    )
    # Apart from created_at, so that a backfilled trace shows the gap.
    occurred_at = models.DateTimeField("survenu le", default=timezone.now)
    created_at = models.DateTimeField("créé le", auto_now_add=True)
    updated_at = models.DateTimeField("modifié le", null=True, blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="modifié par",
    )
    participants = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through="EntryParticipant",
        related_name="participations",
        blank=True,
    )

    class Meta:
        ordering = ["-occurred_at", "-id"]
        verbose_name = "trace"

    def __str__(self) -> str:
        return f"{self.get_type_display()} — {self.team_season}"


class EntryParticipant(models.Model):
    """Who moved a work item forward that day, each signed up by themselves:
    the day's attendance is read here, and stored nowhere else. On a decision,
    who was at the meeting, ticked by its author, and counted present for
    nothing."""

    entry = models.ForeignKey(Entry, on_delete=models.CASCADE)
    # PROTECT until the GDPR module decides what a deleted member's traces become.
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)

    class Meta:
        verbose_name = "participation"
        constraints = [
            models.UniqueConstraint(
                fields=["entry", "user"], name="unique_participant_per_entry"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user} ({self.entry})"


class AttachmentQuerySet(models.QuerySet["Attachment"]):
    def to_check(self) -> "AttachmentQuerySet":
        """Files with people on them, in a team where a member's refusal is in
        force now: a later refusal stops use from its date and a later grant
        reopens it, whatever the date of the photo. Nobody outside the team is
        tracked — the tool flags, it does not police."""
        refusing = [decision.user_id for decision in Consent.objects.refusals()]
        return self.filter(
            people_recognisable=True,
            entry__team_season__memberships__user__in=refusing,
        ).distinct()


class Attachment(models.Model):
    """A file kept with an entry: a photo of the prototype, a plan, a video
    of a test run. Anyone on the team adds one to any of its entries; only
    whoever added it, or a mentor, takes it away."""

    entry = models.ForeignKey(
        Entry, on_delete=models.CASCADE, related_name="attachments"
    )
    # PROTECT, not CASCADE: an anonymized member's files stay in the team's
    # notebook, attributed to "Ancien membre" like the rest of what they
    # wrote (club/gdpr.py, `anonymize`) — deletion removes the identity,
    # never the history.
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
        verbose_name="déposé par",
    )
    # Stored under a random name; the one it was sent with is kept apart.
    file = models.FileField("fichier", upload_to="attachments/")
    name = models.CharField("nom", max_length=255)
    # Read from the file's content when it was accepted, never from its name.
    content_type = models.CharField("type", max_length=50)
    people_recognisable = models.BooleanField(
        "personnes reconnaissables",
        default=False,
        help_text="Au moins une personne, quelle qu'elle soit, est reconnaissable "
        "sur le fichier. Ne décocher que si personne ne l'est, pas seulement "
        "parce que celle qui refuse n'y figure pas.",
    )
    uploaded_at = models.DateTimeField("déposé le", auto_now_add=True)

    objects = AttachmentQuerySet.as_manager()

    class Meta:
        ordering = ["uploaded_at", "id"]
        verbose_name = "pièce jointe"
        verbose_name_plural = "pièces jointes"

    def __str__(self) -> str:
        return self.name


@receiver(post_delete, sender=Attachment)
def remove_attachment_file(instance: Attachment, **kwargs: Any) -> None:
    """A signal rather than delete(), which an entry's deletion never calls
    on its attachments. After the commit: removed any earlier, a rollback
    would leave a row pointing at a file that is gone."""
    storage, name = instance.file.storage, instance.file.name
    # Always set on a saved attachment; the type allows None for a new field.
    assert name is not None
    transaction.on_commit(lambda: storage.delete(name))


class ConsentQuerySet(models.QuerySet["Consent"]):
    """Reading a journal of decisions: what is in force is never a column, it
    is the latest line."""

    def in_force_for(self, user: "User") -> "Consent | None":
        """The latest decision, or None when nothing was ever decided."""
        return self.filter(user=user).order_by("-decided_at", "-id").first()

    def refusals(self) -> "list[Consent]":
        """The refusal in force of each member who refused, with its date: the
        short list shown when publishing. Members with no decision are not in
        it. One query per member, which a club's roster makes negligible, and
        the "latest decision" rule stays in in_force_for alone."""
        in_force = (self.in_force_for(user) for user in User.objects.all())
        return [
            decision
            for decision in in_force
            if decision is not None and decision.decision == Consent.Decision.REFUSED
        ]


class Consent(models.Model):
    """One dated image-rights decision, never edited: granting and refusing
    are both decisions, and the latest one is in force. No decision at all
    means unknown. The signed proof lives in AssoConnect.

    A later refusal stops use from that moment, so publishability must be
    filtered when reading, never frozen at upload time.
    """

    class Decision(models.TextChoices):
        GRANTED = "granted", "accordé"
        REFUSED = "refused", "refusé"

    class GrantedBy(models.TextChoices):
        """The signatory's capacity, not their identity: parents have no
        account."""

        SELF = "self", "l'intéressé"
        LEGAL_GUARDIAN = "legal_guardian", "représentant légal"

    # Deleting an account deletes its decisions, as the GDPR module expects.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="consents"
    )
    decision = models.CharField("décision", max_length=10, choices=Decision.choices)
    granted_by = models.CharField("signé par", max_length=15, choices=GrantedBy.choices)
    decided_at = models.DateTimeField("décidé le", default=timezone.now)

    objects = ConsentQuerySet.as_manager()

    class Meta:
        ordering = ["-decided_at", "-id"]
        verbose_name = "décision de droit à l'image"
        verbose_name_plural = "décisions de droit à l'image"

    def __str__(self) -> str:
        return f"{self.user} — droit à l'image {self.get_decision_display()}"


class Document(models.Model):
    """A source the rulebook RAG has ingested: the game manual or the
    official Q&A. Never something the club wrote itself — a house fiche
    would go stale with no visible expiry date, and be cited with the same
    confidence as a binding rule (docs/fieldnotes.html, "Le RAG règlement").
    A forum was considered and dropped: the FTC Community forum has no
    rules category, and Chief Delphi's FTC threads are mostly build logs
    and strategy — nothing would ever fill it."""

    class Source(models.TextChoices):
        GAME_MANUAL = "game_manual", "manuel de jeu"
        OFFICIAL_QA = "official_qa", "Q&A officiel"

    class Authority(models.TextChoices):
        """What the source is worth, read off `source` at ingestion — never
        typed by hand. The manual takes precedence over the Q&A (§1.7.4):
        `ask` sorts citations by this before score."""

        BINDING = "binding", "contraignant"
        RULING = "ruling", "ruling officiel"

    season = models.ForeignKey(
        Season, on_delete=models.PROTECT, related_name="documents"
    )
    source = models.CharField("source", max_length=15, choices=Source.choices)
    authority = models.CharField("autorité", max_length=10, choices=Authority.choices)
    title = models.CharField("titre", max_length=200)
    url = models.URLField(blank=True)
    fetched_at = models.DateTimeField("récupéré le", default=timezone.now)

    class Meta:
        ordering = ["-fetched_at"]
        verbose_name = "document"

    def __str__(self) -> str:
        return self.title


class Chunk(models.Model):
    """One passage of a `Document`, short enough to cite and to compare: the
    unit both retrieval and a citation point at."""

    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name="chunks"
    )
    ordinal = models.PositiveIntegerField("position")
    # What a citation names: a rule ID ("G420") or a numbered section
    # ("10.6.4") for the prose around them — blank only for front matter
    # ingested before either is recognised. Not unique: a rule too long for
    # one passage keeps its own reference across all of them.
    reference = models.CharField("référence", max_length=20, blank=True, default="")
    text = models.TextField("texte")
    # A fixed-size vector, packed: a manual is a few thousand chunks, and a
    # brute-force dot product over them takes milliseconds — no vector
    # database earns its keep at this size (docs/fieldnotes.html).
    embedding = models.BinaryField(editable=False)

    class Meta:
        ordering = ["document", "ordinal"]
        verbose_name = "passage"
        constraints = [
            models.UniqueConstraint(
                fields=["document", "ordinal"], name="unique_ordinal_per_document"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.document} #{self.ordinal}"


class RuleQuery(models.Model):
    """A question asked of the rulebook, and what came back. `answer` is
    empty when the citations speak for themselves, and holds the refusal
    sentence when none of them may be trusted to."""

    # PROTECT, not CASCADE: an anonymized member's questions stay, pointing
    # to "Ancien membre" like the rest of what they left behind
    # (club/gdpr.py, `anonymize`).
    asker = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="rule_queries"
    )
    question = models.TextField("question")
    answer = models.TextField("réponse", blank=True)
    created_at = models.DateTimeField("posée le", default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name = "question de règlement"
        verbose_name_plural = "questions de règlement"

    def __str__(self) -> str:
        return self.question


class QueryCitation(models.Model):
    """The passage a query's answer rests on, ranked: what the reader is
    handed to check the answer against, in the order it was trusted."""

    query = models.ForeignKey(
        RuleQuery, on_delete=models.CASCADE, related_name="citations"
    )
    # PROTECT: a citation must never point at a passage that no longer
    # exists to be checked against.
    chunk = models.ForeignKey(Chunk, on_delete=models.PROTECT)
    rank = models.PositiveSmallIntegerField("rang")

    class Meta:
        ordering = ["query", "rank"]
        verbose_name = "citation de réponse"
        verbose_name_plural = "citations de réponse"
        constraints = [
            models.UniqueConstraint(
                fields=["query", "rank"], name="unique_rank_per_query"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.query} — #{self.rank}"
