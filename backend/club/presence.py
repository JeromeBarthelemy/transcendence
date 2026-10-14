"""A teammate's online status (#267): a green dot, nothing else — no last
seen, no timestamp, no separate graph to build and maintain. Team membership
(`Membership`, `TeamSeason`) is the whole relationship a student sees it
through; a mentor sees it for whichever team they are viewing, since they
may open any of them.
"""

from collections.abc import Callable
from datetime import timedelta

from django.db.models import Q
from django.http import HttpRequest, HttpResponse
from django.utils import timezone

from .models import Membership, Season, User

# "the last few minutes" — generous enough that the gap between two bumps
# of the same session never reads as offline.
ONLINE_WINDOW = timedelta(minutes=2)

# How often a visit actually reaches the database: a club's worth of members
# browsing the board would otherwise mean a write on every single request.
TOUCH_INTERVAL = timedelta(minutes=1)


def is_online(user: User) -> bool:
    return (
        user.last_seen is not None and user.last_seen >= timezone.now() - ONLINE_WINDOW
    )


def touch_last_seen(user: User) -> None:
    """Bumps `last_seen` to now, at most once per `TOUCH_INTERVAL`. An
    `.update()`, not `user.save()`: this runs on every request, so it must
    never race — or wait behind — whatever else that same request is about
    to write to this row."""
    now = timezone.now()
    threshold = now - TOUCH_INTERVAL
    if user.last_seen is not None and user.last_seen >= threshold:
        return
    User.objects.filter(pk=user.pk).filter(
        Q(last_seen__isnull=True) | Q(last_seen__lt=threshold)
    ).update(last_seen=now)


def shares_current_team(viewer: User, member: User) -> bool:
    """Whether `viewer` may see `member`'s online status (#176's profile,
    #267's rule): a mentor always may, since they can open any team; a
    student only for someone on their own current-season team."""
    if viewer.club_role == User.ClubRole.MENTOR:
        return True
    season = Season.objects.first()
    if season is None:
        return False
    viewer_teams = Membership.objects.filter(
        user=viewer, team_season__season=season
    ).values_list("team_season_id", flat=True)
    return Membership.objects.filter(
        user=member, team_season__season=season, team_season_id__in=viewer_teams
    ).exists()


class TrackLastSeenMiddleware:
    """No WebSocket needed (#267): every authenticated request already
    carries whoever is making it, which is as live as online status needs
    to be. Listed after AuthenticationMiddleware, which is what gives
    `request.user` its meaning."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        user = request.user
        if isinstance(user, User):
            touch_last_seen(user)
        return self.get_response(request)
