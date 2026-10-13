"""Searching a team's notebook: its traces, filtered by what they say, which
work item they belong to, its side of the robot, the step, who took part,
when, and what kind of trace they are. Every filter given narrows the
results; none given is the whole notebook."""

from datetime import date
from typing import Any

from django.db.backends.base.base import BaseDatabaseWrapper
from django.db.models import Exists, Func, OuterRef, Q, QuerySet, TextField

from club.models import Entry, EntryParticipant, TeamSeason, User, WorkItem, fold_title
from club.workdays import workday_bounds


class Fold(Func):
    """`fold_title`, applied by the database row by row. SQLite's lower() is
    ASCII-only, so it would find « élodie » in neither « Élodie » nor
    « ELODIE ». Folded on reading rather than stored: a trace's text is also
    rewritten by UPDATEs (club/progress.py, club/corrections.py) that a
    stored copy would fall behind."""

    function = "club_fold"
    output_field = TextField()


def _fold(text: str | None) -> str | None:
    return None if text is None else fold_title(text)


def register_fold(sender: Any, connection: BaseDatabaseWrapper, **kwargs: Any) -> None:
    """Connected to `connection_created` (club/apps.py): every connection,
    test ones included, gets the function before its first query."""
    if connection.vendor == "sqlite":
        connection.connection.create_function(
            Fold.function, 1, _fold, deterministic=True
        )


def search_entries(
    team_season: TeamSeason,
    *,
    text: str = "",
    work_item: WorkItem | None = None,
    on_robot: bool | None = None,
    step: str | None = None,
    participant: User | None = None,
    since: date | None = None,
    until: date | None = None,
    entry_type: str | None = None,
    newest_first: bool = True,
) -> QuerySet[Entry]:
    """Each word of `text` must appear, in any order, in the trace's text, its
    handover or its work item's title: « intake moteur » finds the intake
    progress that mentions the motor. `participant` is whoever took part in a
    progress or attended a decision, or wrote the trace. Dates are workdays,
    both included, so a late evening counts for the day it started."""
    entries = Entry.objects.filter(team_season=team_season)
    words = fold_title(text).split()
    if words:
        entries = entries.annotate(
            body_folded=Fold("body"), handover_folded=Fold("handover")
        )
        for word in words:
            entries = entries.filter(
                Q(body_folded__contains=word)
                | Q(handover_folded__contains=word)
                | Q(work_item__title_folded__contains=word)
            )
    if work_item is not None:
        entries = entries.filter(work_item=work_item)
    if on_robot is not None:
        entries = entries.filter(work_item__on_robot=on_robot)
    if step is not None:
        entries = entries.filter(step=step)
    if participant is not None:
        took_part = EntryParticipant.objects.filter(
            entry=OuterRef("pk"), user=participant
        )
        entries = entries.filter(Q(author=participant) | Exists(took_part))
    if since is not None:
        entries = entries.filter(occurred_at__gte=workday_bounds(since)[0])
    if until is not None:
        entries = entries.filter(occurred_at__lt=workday_bounds(until)[1])
    if entry_type is not None:
        entries = entries.filter(type=entry_type)
    order = ("-occurred_at", "-id") if newest_first else ("occurred_at", "id")
    return entries.order_by(*order)


def people_of(team_season: TeamSeason) -> QuerySet[User]:
    """Who the participant filter offers: the team's members, and anyone
    who wrote or took part in one of its traces, a mentor or a member who
    has since left included."""
    return (
        User.objects.filter(
            Q(memberships__team_season=team_season)
            | Q(entries__team_season=team_season)
            | Q(participations__team_season=team_season)
        )
        .distinct()
        .order_by("display_name")
    )
