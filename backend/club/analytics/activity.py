"""Team activity analytics derived from work items and progress entries.

Nothing in this module is a score. It describes recorded participation and
the current state of the work, without ranking members or judging output.
"""

from dataclasses import dataclass, field
from datetime import date
from typing import TypedDict

from django.db import models

from club.models import (
    Entry,
    EntryParticipant,
    Membership,
    TeamSeason,
    User,
    WorkItem,
)
from club.workdays import workday, workday_bounds


class LabelledCount(TypedDict):
    status: str
    count: int


class StepCount(TypedDict):
    step: str
    count: int


class Snapshot(TypedDict):
    work_items_by_status: list[LabelledCount]
    work_items_by_step: list[StepCount]
    work_items_without_progress: int


class DailyActivity(TypedDict):
    day: date
    progress_entries: int
    active_members: int


class MemberActivity(TypedDict):
    id: int
    display_name: str
    avatar: str | None
    is_current_member: bool
    active_days: int
    progress_entries: int
    work_items: int
    last_progress_day: date | None


class Period(TypedDict):
    since: date
    until: date


class ActivityAnalytics(TypedDict):
    period: Period
    snapshot: Snapshot
    activity_by_day: list[DailyActivity]
    members: list[MemberActivity]


@dataclass
class _MemberTotals:
    days: set[date] = field(default_factory=set)
    entries: set[int] = field(default_factory=set)
    work_items: set[int] = field(default_factory=set)


def _snapshot(team_season: TeamSeason) -> Snapshot:
    """Current work-item state, independently of the requested period."""
    latest_progress = Entry.objects.filter(
        work_item_id=models.OuterRef("pk"), type=Entry.Type.PROGRESS
    ).order_by("-occurred_at", "-id")
    work_items = (
        WorkItem.objects.filter(team_season=team_season)
        .annotate(
            analytics_latest_progress_id=models.Subquery(
                latest_progress.values("id")[:1],
                output_field=models.IntegerField(),
            ),
            analytics_current_step=models.Subquery(
                latest_progress.values("step")[:1],
                output_field=models.CharField(),
            ),
        )
        .values_list("status", "analytics_latest_progress_id", "analytics_current_step")
    )

    status_counts = {value: 0 for value, _label in WorkItem.Status.choices}
    step_counts = {value: 0 for value, _label in Entry.Step.choices}
    without_progress = 0
    for status, latest_progress_id, current_step in work_items:
        status_counts[status] += 1
        if latest_progress_id is None:
            without_progress += 1
        elif current_step is not None:
            step_counts[current_step] += 1

    return {
        "work_items_by_status": [
            {"status": value, "count": status_counts[value]}
            for value, _label in WorkItem.Status.choices
        ],
        "work_items_by_step": [
            {"step": value, "count": step_counts[value]}
            for value, _label in Entry.Step.choices
        ],
        "work_items_without_progress": without_progress,
    }


def summarize_activity(
    team_season: TeamSeason, since: date, until: date
) -> ActivityAnalytics:
    """Build the activity response in five queries, regardless of team size."""
    start = workday_bounds(since)[0]
    end = workday_bounds(until)[1]
    progress_rows = list(
        Entry.objects.filter(
            team_season=team_season,
            type=Entry.Type.PROGRESS,
            occurred_at__gte=start,
            occurred_at__lt=end,
        ).values_list("id", "occurred_at", "work_item_id")
    )
    progress = {
        entry_id: (workday(occurred_at), work_item_id)
        for entry_id, occurred_at, work_item_id in progress_rows
    }
    participants = list(
        EntryParticipant.objects.filter(
            entry_id__in=progress,
            user__club_role=User.ClubRole.STUDENT,
        ).values_list("entry_id", "user_id")
    )
    current_members = set(
        Membership.objects.filter(team_season=team_season)
        .roster()
        .values_list("user_id", flat=True)
        .order_by()
    )

    progress_by_day: dict[date, int] = {}
    active_members_by_day: dict[date, set[int]] = {}
    for day, _work_item_id in progress.values():
        progress_by_day[day] = progress_by_day.get(day, 0) + 1
        active_members_by_day.setdefault(day, set())

    totals: dict[int, _MemberTotals] = {}
    for entry_id, user_id in participants:
        day, work_item_id = progress[entry_id]
        active_members_by_day[day].add(user_id)
        member = totals.setdefault(user_id, _MemberTotals())
        member.days.add(day)
        member.entries.add(entry_id)
        if work_item_id is not None:
            member.work_items.add(work_item_id)

    represented_members = current_members | set(totals)
    users = User.objects.filter(id__in=represented_members).order_by(
        "display_name", "id"
    )
    members: list[MemberActivity] = []
    for user in users:
        member = totals.get(user.id, _MemberTotals())
        members.append(
            {
                "id": user.id,
                "display_name": user.display_name,
                "avatar": f"/api/users/{user.id}/avatar/" if user.avatar else None,
                "is_current_member": user.id in current_members,
                "active_days": len(member.days),
                "progress_entries": len(member.entries),
                "work_items": len(member.work_items),
                "last_progress_day": max(member.days, default=None),
            }
        )

    return {
        "period": {"since": since, "until": until},
        "snapshot": _snapshot(team_season),
        "activity_by_day": [
            {
                "day": day,
                "progress_entries": progress_by_day[day],
                "active_members": len(active_members_by_day[day]),
            }
            for day in sorted(progress_by_day)
        ],
        "members": members,
    }
