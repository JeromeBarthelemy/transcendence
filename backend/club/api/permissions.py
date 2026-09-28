"""Permissions beyond authenticated-or-not, which is all DRF's own classes
know how to say."""

from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from club.models import Membership, TeamSeason, User


class IsClubAdmin(BasePermission):
    """Creating, renaming or deleting a team is an administrative act. Self-
    contained rather than paired with `IsAuthenticated`: an anonymous caller
    has `request.user` set to Django's `AnonymousUser`, which answers
    `is_authenticated` before anything tries to read `is_club_admin` off it —
    a field it does not have."""

    def has_permission(self, request: Request, view: APIView) -> bool:
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.is_club_admin
        )


def team_season_acted_on(user: User, team_season_id: int) -> TeamSeason:
    """The team season a request works on, if the caller may: a member acts
    on their own team, a mentor on any of the four."""
    team_season = get_object_or_404(TeamSeason, pk=team_season_id)
    is_member = Membership.objects.filter(user=user, team_season=team_season)
    if user.club_role != User.ClubRole.MENTOR and not is_member.exists():
        raise PermissionDenied(
            "Vous n'êtes pas membre de cette équipe.", code="not_a_member"
        )
    return team_season


def team_seasons_open_to(user: User) -> QuerySet[TeamSeason]:
    """The same rule as `team_season_acted_on`, as a list: what the front end
    may offer to open."""
    team_seasons = TeamSeason.objects.select_related("team", "season")
    if user.club_role == User.ClubRole.MENTOR:
        return team_seasons.all()
    return team_seasons.filter(memberships__user=user)


def not_self(request: Request, target: User) -> None:
    """An admin manages other members here, never their own account:
    demoting or deactivating yourself has no recovery path but another
    admin — and on a single-admin club there may not be one."""
    if target == request.user:
        raise PermissionDenied(
            "Vous ne pouvez pas modifier votre propre compte ici.",
            code="cannot_target_self",
        )


def not_staff_target(request: Request, target: User) -> None:
    """A club admin's reach stops at Django staff: staff is what resets a
    forgotten password from the Django admin (README, "Sessions"). A staff
    account demoted or deactivated by a club admin without staff access
    would leave the club with no recovery path but `manage.py`.

    Superuser is a second, stricter boundary layered on top of it rather
    than folded into the same check: `is_staff` alone opens the Django
    admin, but says nothing about `is_superuser` — a staff club admin who
    is not a superuser could otherwise still demote or deactivate one,
    found reviewing #88."""
    if target.is_staff and not request.user.is_staff:
        raise PermissionDenied(
            "Ce compte a accès à l'admin Django ; seul un accès équivalent "
            "peut le modifier.",
            code="cannot_target_staff",
        )
    if target.is_superuser and not request.user.is_superuser:
        raise PermissionDenied(
            "Ce compte a un accès superutilisateur ; seul un accès "
            "équivalent peut le modifier.",
            code="cannot_target_superuser",
def not_the_last_admin(user: User) -> None:
    """There is no password reset by email on this instance (README,
    "Sessions") — the club admin is the recovery path for everyone else.
    Deleting the last one leaves nobody who can set anything right."""
    if (
        user.is_club_admin
        and not User.objects.filter(is_club_admin=True, is_active=True)
        .exclude(pk=user.pk)
        .exists()
    ):
        raise PermissionDenied(
            "Vous êtes le seul administrateur du club : vous ne pouvez pas "
            "supprimer votre compte.",
            code="last_admin_cannot_leave",
        )
