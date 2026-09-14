"""Club foundation: accounts, teams, seasons, memberships, image-rights consent.

One deployment serves one club, so there is no Club model: the organisation
the subject asks us to create, edit and delete is the team.
"""

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.db.models import Q
from django.utils import timezone


class UserManager(BaseUserManager):
    """Required by a custom user model; `createsuperuser` and the AssoConnect
    import go through it."""

    use_in_migrations = True

    def create_user(self, email, display_name, password=None, **extra):
        if not email:
            raise ValueError("Un compte exige une adresse e-mail : c'est la clé "
                             "de réconciliation avec AssoConnect.")
        user = self.model(
            email=self.normalize_email(email),
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


class User(AbstractBaseUser, PermissionsMixin):
    """Holding an account is club membership: parents and alumni belong to the
    association but have no use for this tool."""

    class ClubRole(models.TextChoices):
        STUDENT = "student", "élève"
        MENTOR = "mentor", "mentor"

    email = models.EmailField(unique=True)
    display_name = models.CharField("nom d'affichage", max_length=80)
    avatar = models.ImageField(upload_to="avatars/", blank=True)

    # Adulthood is established, never assumed.
    is_minor = models.BooleanField("mineur", default=True)

    club_role = models.CharField("rôle au club", max_length=10,
                                 choices=ClubRole.choices,
                                 default=ClubRole.STUDENT)

    # A flag rather than a third role: administrators are mentors who also
    # administrate. Distinct from `is_staff`, which opens the Django admin and
    # therefore the raw database.
    is_club_admin = models.BooleanField("administrateur du club", default=False)

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["display_name"]

    class Meta:
        ordering = ["display_name"]
        verbose_name = "membre"
        verbose_name_plural = "membres"

    def __str__(self):
        return self.display_name

    @property
    def is_mentor(self):
        return self.club_role == self.ClubRole.MENTOR


class Season(models.Model):
    """Scoping by season archives past seasons for free: their objects stay
    readable, unmigrated."""

    label = models.CharField(max_length=20, unique=True)  # "2026-2027"

    class Meta:
        ordering = ["-label"]
        verbose_name = "saison"

    def __str__(self):
        return self.label


class Team(models.Model):
    # Assigned by FIRST, unique worldwide.
    number = models.PositiveIntegerField(unique=True)
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
    team = models.ForeignKey(Team, on_delete=models.PROTECT, related_name="seasons")
    season = models.ForeignKey(Season, on_delete=models.PROTECT, related_name="team_seasons")

    class Meta:
        ordering = ["-season__label", "team__number"]
        verbose_name = "équipe-saison"
        constraints = [
            models.UniqueConstraint(fields=["team", "season"],
                                    name="unique_team_per_season"),
        ]

    def __str__(self):
        return f"{self.team.number} ({self.season.label})"


class Membership(models.Model):
    """Belonging to a team for a season. No role: captaincy opens no right.
    An explicit model rather than a ManyToManyField, so a column can be added
    without converting the join table."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name="memberships")
    team_season = models.ForeignKey(TeamSeason, on_delete=models.CASCADE,
                                    related_name="memberships")

    class Meta:
        verbose_name = "adhésion"
        constraints = [
            models.UniqueConstraint(fields=["user", "team_season"],
                                    name="unique_membership_per_team_season"),
        ]

    def __str__(self):
        return f"{self.user} — {self.team_season}"


class Consent(models.Model):
    """Image-rights consent, the only one the club collects. It has no expiry,
    only a grant and possibly a withdrawal. The signed proof lives in
    AssoConnect.

    Withdrawal stops use from that moment, so publishability must be filtered
    when reading, never frozen at upload time.
    """

    class GrantedBy(models.TextChoices):
        """The signatory's capacity, not their identity: parents have no
        account."""

        SELF = "self", "l'intéressé"
        LEGAL_GUARDIAN = "legal_guardian", "représentant légal"

    # Deleting an account deletes its consents, as the GDPR module expects.
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name="consents")
    granted_by = models.CharField("signé par", max_length=15,
                                  choices=GrantedBy.choices)

    granted_at = models.DateTimeField("accordée le", default=timezone.now)
    revoked_at = models.DateTimeField("retirée le", null=True, blank=True)

    class Meta:
        ordering = ["-granted_at"]
        verbose_name = "autorisation de droit à l'image"
        verbose_name_plural = "autorisations de droit à l'image"
        constraints = [
            # History is allowed, but only one authorisation may be in force:
            # the dated history proves consent held on the day a photo was used.
            models.UniqueConstraint(
                fields=["user"],
                condition=Q(revoked_at__isnull=True),
                name="one_active_consent",
            ),
        ]

    def __str__(self):
        state = "retirée" if self.revoked_at else "en vigueur"
        return f"{self.user} — droit à l'image ({state})"

    @property
    def is_active(self):
        return self.revoked_at is None
