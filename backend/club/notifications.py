"""Who is told of a change on the board (module 13), and the open screens
with it: one call per write, from the views. A write that forgets it shows at
once, since its screens stop being live too. What an administrator does to a
member is told to that member alone."""

from django.db.models import Q, QuerySet

from club.live import broadcast, tell
from club.models import Entry, Notification, TeamSeason, User, WorkItem

# Nobody follows a work item yet when it opens, nor once it is deleted
# (only one without traces can be): both are the whole team's news.
TEAM_NEWS = {Notification.Verb.WORK_ITEM_OPENED, Notification.Verb.WORK_ITEM_DELETED}

# About the recipient themselves, not a board: kept in their bell even once the
# team is no longer theirs to open.
PERSONAL = {
    Notification.Verb.MEMBERSHIP_ADDED,
    Notification.Verb.MEMBERSHIP_REMOVED,
    Notification.Verb.MADE_MENTOR,
    Notification.Verb.MADE_STUDENT,
    Notification.Verb.ADMIN_GRANTED,
    Notification.Verb.ADMIN_REVOKED,
}


def record_change(
    actor: User,
    verb: Notification.Verb,
    *,
    team_season: TeamSeason,
    work_item: WorkItem | None,
    entry: Entry | None = None,
) -> None:
    """Called inside the write's transaction, so that notices failing take
    the write back with them: the error answered is then true, and a retry
    does not make the write twice. Before a deletion, while what goes still
    has its id."""
    Notification.objects.bulk_create(
        Notification(
            recipient=recipient,
            actor=actor,
            team_season=team_season,
            verb=verb,
            work_item=work_item,
            work_item_title=work_item.title if work_item else "",
            entry=entry,
            entry_type=entry.type if entry else None,
        )
        for recipient in _recipients(actor, verb, team_season, work_item)
    )
    broadcast(
        team_season.id,
        work_item.id if work_item else None,
        deleted=verb == Notification.Verb.WORK_ITEM_DELETED,
    )


def _recipients(
    actor: User,
    verb: Notification.Verb,
    team_season: TeamSeason,
    work_item: WorkItem | None,
) -> QuerySet[User]:
    """Those who follow the work item — who took part in one of its progress
    entries and may still open it, by the rule of `team_season_acted_on` — or
    the whole team for what concerns none; never the actor."""
    if work_item is None or verb in TEAM_NEWS:
        users = User.objects.filter(memberships__team_season=team_season)
    else:
        users = User.objects.filter(
            participations__work_item=work_item,
            participations__type=Entry.Type.PROGRESS,
        ).filter(
            Q(club_role=User.ClubRole.MENTOR) | Q(memberships__team_season=team_season)
        )
    return users.filter(is_active=True).exclude(pk=actor.pk).distinct()


def notify_member(
    actor: User,
    recipient: User,
    verb: Notification.Verb,
    team_season: TeamSeason | None = None,
) -> None:
    """What an administrator did to one member, told to them alone. Inside
    the write's transaction, as `record_change`."""
    if recipient == actor or not recipient.is_active:
        return
    Notification.objects.create(
        recipient=recipient, actor=actor, team_season=team_season, verb=verb
    )
    tell(recipient.pk, team_season.id if team_season else None)
