"""A teammate's online status (#267): a green dot, nothing else. Derived
from the WebSocket every signed-in member already holds (`club/live.py`),
not from a stored timestamp — reviewing #272, Jerome pointed out that a
timestamp would be new personal data needing its own export, erasure and
privacy-policy entry, and that polling it drifts from what "online" should
mean: a member who leaves a page open stays "online" for as long as a poll
keeps asking, while one actually using the app between polls can read as
offline. Counting open sockets has neither problem: nothing is stored, and
the count is exactly who has the app open right now.
"""

from collections import defaultdict
from threading import Lock

from .models import Membership, Season, User

# One process (`daphne`, compose.yml) holds every open socket, so one
# dict in it is the whole picture — nothing to share across workers.
_lock = Lock()
_open_sockets: dict[int, int] = defaultdict(int)


def is_online(user: User) -> bool:
    return _open_sockets.get(user.pk, 0) > 0


def connected(user_id: int) -> bool:
    """Counts one more open socket for this member; several tabs are a
    count, not a flag. Returns whether this is their first — the moment
    their teammates should be told."""
    with _lock:
        _open_sockets[user_id] += 1
        return _open_sockets[user_id] == 1


def disconnected(user_id: int) -> bool:
    """The matching close. Returns whether this was their last — the
    moment their teammates should be told the dot is off."""
    with _lock:
        _open_sockets[user_id] -= 1
        if _open_sockets[user_id] <= 0:
            del _open_sockets[user_id]
            return True
        return False


def current_team_season_ids(user: User) -> list[int]:
    """The team seasons whose readers should hear this member's presence
    change — empty for a mentor, who is not on one team."""
    season = Season.objects.first()
    if season is None:
        return []
    return list(
        Membership.objects.filter(user=user, team_season__season=season).values_list(
            "team_season_id", flat=True
        )
    )


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
