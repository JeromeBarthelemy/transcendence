"""Club foundation: accounts, teams, seasons, memberships, image-rights consent.

One deployment serves one club, so there is no Club model: the organisation
the subject asks us to create, edit and delete is the team.
"""

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
from django.db import models
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
    """An active account is club membership. Parents have no account; a member
    who leaves keeps theirs, deactivated, so their traces stay attributed."""

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
        "nom d'affichage", max_length=80, validators=[no_at_sign]
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
    # Only a robot work item has steps.
    on_robot = models.BooleanField("sur le robot", default=False)
    status = models.CharField(
        "statut", max_length=10, choices=Status.choices, default=Status.OPEN
    )
    opened_at = models.DateTimeField("ouvert le", null=True, blank=True)
    closed_at = models.DateTimeField("fermé le", null=True, blank=True)
    # Overwritten at every progress entry, shown when the work item is reopened.
    handover = models.TextField("passation", blank=True)

    class Meta:
        ordering = ["title"]
        verbose_name = "chantier"
        constraints = [
            models.UniqueConstraint(
                fields=["team_season", "title"], name="unique_work_item_title_per_team"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.team_season})"


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
