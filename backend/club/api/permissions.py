"""Permissions beyond authenticated-or-not, which is all DRF's own classes
know how to say."""

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
