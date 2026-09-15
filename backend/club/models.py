"""Club foundation: accounts, teams, seasons, memberships, image-rights consent.

One deployment serves one club, so there is no Club model: the organisation
the subject asks us to create, edit and delete is the team.
"""

from django.conf import settings
from django.contrib.auth.models import (
    AbstractBaseUser,
    BaseUserManager,
    PermissionsMixin,
)
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone


class UserManager(BaseUserManager):
    """Required by a custom user model; `createsuperuser` and the AssoConnect
    import go through it."""

    use_in_migrations = True

    def create_user(self, email, display_name, password=None, **extra):
        if not email:
            raise ValueError(
                "Un compte exige une adresse e-mail : c'est la clé "
                "de réconciliation avec AssoConnect."
            )
        user = self.model(
            # normalize_email only lowercases the domain, and SQLite's unique
            # constraint is case-sensitive: Ada@ and ada@ would be two accounts.
            email=self.normalize_email(email).lower(),
            display_name=display_name,
            **extra,
        )
        # password=None leaves the password unusable: the imported account
        # exists, and the student activates it.
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, display_name, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("is_minor", False)
        # The first account belongs to whoever installs the instance and then
        # registers everyone else.
        extra.setdefault("club_role", User.ClubRole.MENTOR)
        extra.setdefault("is_club_admin", True)
        if extra.get("is_staff") is not True:
            raise ValueError("Un superutilisateur doit avoir is_staff=True.")
        if extra.get("is_superuser") is not True:
            raise ValueError("Un superutilisateur doit avoir is_superuser=True.")
        return self.create_user(email, display_name, password, **extra)

    def get_by_natural_key(self, username):
        # Login looks the account up here; emails are stored lowercased.
        return super().get_by_natural_key(username.lower())


class User(AbstractBaseUser, PermissionsMixin):
    """Holding an account is club membership: parents and alumni belong to the
    association but have no use for this tool."""

    class ClubRole(models.TextChoices):
        STUDENT = "student", "élève"
        MENTOR = "mentor", "mentor"

    email = models.EmailField("adresse e-mail", unique=True)
    display_name = models.CharField("nom d'affichage", max_length=80)
    avatar = models.ImageField(upload_to="avatars/", blank=True)

    # Adulthood is established, never assumed.
    is_minor = models.BooleanField("mineur", default=True)

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

    def __str__(self):
        return self.display_name

    def clean(self):
        super().clean()
        # full_clean() runs clean() before the uniqueness check, so a form
        # reports a duplicate differing only by case instead of crashing on save.
        self.email = self.email.lower()

    @property
    def is_mentor(self):
        return self.club_role == self.ClubRole.MENTOR


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

    def __str__(self):
        return f"{self.label} · {self.game_name}"

    @property
    def label(self):
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

    def __str__(self):
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

    def __str__(self):
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

    def __str__(self):
        return f"{self.user} ({self.team_season})"


class ConsentQuerySet(models.QuerySet):
    def in_force_for(self, user):
        """The latest decision, or None when nothing was ever decided."""
        return self.filter(user=user).order_by("-decided_at", "-id").first()

    def refusals(self):
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

    def __str__(self):
        return f"{self.user} — droit à l'image {self.get_decision_display()}"
