"""Slice 1 — the club foundation.

Direct translation of the "Le schéma" section of the concept note (the
"Socle club" group). Naming convention: English in the code, French in the
interface — so field and model names, comments and docstrings are English,
while `verbose_name`, choice labels and validation messages stay French
because they are displayed as-is.

One deployment serves one club, locally. That premise is why there is no
`Club` model: it would be a singleton, and every foreign key to it a constant
column. The organisation the subject asks us to create, edit and delete is
therefore the team.

Nothing here is visible to a user, and everything else depends on it.
"""

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.db.models import Q
from django.utils import timezone


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

class UserManager(BaseUserManager):
    """Replacing the user model means supplying its manager: this is what
    `createsuperuser` and the start-of-season AssoConnect import call."""

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
        # password=None sets an unusable password — exactly what the
        # start-of-season import needs: the account exists, the student
        # activates it.
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, display_name, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("is_minor", False)
        # The first account created is the person deploying the instance, who
        # is also the one who will register everyone else. Club admin by
        # default, so a fresh install is usable without a second step.
        extra.setdefault("club_role", User.ClubRole.MENTOR)
        extra.setdefault("is_club_admin", True)
        if extra.get("is_staff") is not True:
            raise ValueError("Un superutilisateur doit avoir is_staff=True.")
        if extra.get("is_superuser") is not True:
            raise ValueError("Un superutilisateur doit avoir is_superuser=True.")
        return self.create_user(email, display_name, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    """`password` and `last_login` come from AbstractBaseUser, so hashing and
    salting are Django's job — which settles one of the subject's mandatory
    requirements. `is_superuser`, `groups` and `user_permissions` come from
    PermissionsMixin.

    Holding an account *is* club membership: parents and alumni may belong to
    the association but have no reason to use this tool, so they have no
    account. That is what removed the former ClubMembership table.
    """

    class ClubRole(models.TextChoices):
        STUDENT = "student", "élève"
        MENTOR = "mentor", "mentor"

    email = models.EmailField(unique=True)
    display_name = models.CharField("nom d'affichage", max_length=80)
    avatar = models.ImageField(upload_to="avatars/", blank=True)  # requires Pillow

    # Minor by default: in a school club that is the common case, and it is the
    # default that protects. Adulthood is established, never assumed.
    is_minor = models.BooleanField("mineur", default=True)

    club_role = models.CharField("rôle au club", max_length=10,
                                 choices=ClubRole.choices,
                                 default=ClubRole.STUDENT)

    # Additive on purpose: administrators are mentors who also administrate.
    # A role enum could not express that — it would make the two exclusive.
    # Distinct from `is_staff`, which grants access to the Django admin, i.e.
    # to the raw database: managing members should not require that.
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


# ---------------------------------------------------------------------------
# Teams and seasons
# ---------------------------------------------------------------------------

class Season(models.Model):
    """Scoping by season is what makes cross-season archiving free: a new
    season opens new objects and the old ones stay readable, unmigrated."""

    label = models.CharField(max_length=20, unique=True)  # "2026-2027"

    class Meta:
        ordering = ["-label"]
        verbose_name = "saison"

    def __str__(self):
        return self.label


class Team(models.Model):
    # The number is assigned by FIRST and is unique worldwide.
    number = models.PositiveIntegerField(unique=True)
    name = models.CharField(max_length=120)

    class Meta:
        ordering = ["number"]
        verbose_name = "équipe"

    def __str__(self):
        return f"{self.number} — {self.name}"


class TeamSeason(models.Model):
    """The team as it exists in a given season: this is what the notebook, the
    workstreams and the roster attach to."""

    # PROTECT on both sides. Deleting a team would otherwise cascade through
    # its seasons and into every membership, workstream and photo below them —
    # several seasons of work behind one click. A team with no history can
    # still be deleted, which is all the Organisations module needs to
    # demonstrate create/read/update/delete.
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
    """Belonging to a team for a season, and nothing more.

    No role here on purpose: captaincy exists in the club but opens no right
    and changes no screen, and a label nothing depends on drifts out of date.
    The two levels that do matter live on the account (`club_role`,
    `is_club_admin`). The model stays explicit rather than becoming a plain
    ManyToManyField so that a column — joined_at, left_at, or captaincy if it
    ever earns its keep — can be added without converting the join table.
    """

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


# ---------------------------------------------------------------------------
# Consents
# ---------------------------------------------------------------------------

class Consent(models.Model):
    """Image rights — the only consent the club collects.

    The form authorises the club to use photos and videos of the member, taken
    at club meetings and at events, to promote the association, on any medium
    (website, social networks, noticeboards, video) and for as long as the
    documents or the association live. There is no internal-only variant, so
    there is nothing to qualify here: a member either granted it or did not.

    Because it lasts as long as the documents, there is no expiry to store —
    only a start, and possibly a withdrawal.

    Two things live elsewhere and must not be duplicated here. The signed proof
    is in AssoConnect, which is also where a member may withdraw the
    authorisation; this table holds a dated copy, and an import that lags is a
    known operational risk rather than a bug. And the signatory's name is not
    stored: what matters is their capacity, since parents are not members and
    have no account.

    Withdrawal is not retroactive: it does not make past use unlawful. It does
    stop use from that moment, including use that is still happening — a photo
    on the club website is an ongoing publication. Filtering must therefore be
    applied when reading, never frozen at upload time, or a withdrawal will not
    catch what was already marked publishable.
    """

    class GrantedBy(models.TextChoices):
        """The signatory's capacity, not their identity. There are two versions
        of the form: one signed by adult members, one by a legal guardian."""

        SELF = "self", "l'intéressé"
        LEGAL_GUARDIAN = "legal_guardian", "représentant légal"

    # CASCADE: deleting an account deletes its consents. That is also what the
    # GDPR module expects.
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
            # A history is allowed — withdrawn then granted again — but only one
            # authorisation may be in force at a time. The dated history is what
            # proves the authorisation held on the day a photo was used, which
            # a single boolean could never show.
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
