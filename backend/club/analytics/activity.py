"""Team activity analytics derived from work items and progress entries.

Nothing in this module is a score. It describes recorded participation and
the current state of the work, without ranking members or judging output.
"""

import csv
from dataclasses import dataclass, field
from datetime import date, timedelta
from io import StringIO
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


class PeriodSummary(TypedDict):
    progress_entries: int
    active_days: int
    active_members: int
    work_items: int


class WeeklyActivity(TypedDict):
    week_start: date
    progress_entries: int
    active_members: int
    active_days: int


class WorkItemActivity(TypedDict):
    id: int
    title: str
    on_robot: bool
    status: str
    current_step: str | None
    progress_entries: int
    active_days: int
    active_members: int
    last_progress_day: date | None


class CategoryActivity(TypedDict):
    on_robot: bool
    progress_entries: int


class ActivityAnalytics(TypedDict):
    period: Period
    summary: PeriodSummary
    snapshot: Snapshot
    activity_by_day: list[DailyActivity]
    activity_by_week: list[WeeklyActivity]
    activity_by_category: list[CategoryActivity]
    work_items: list[WorkItemActivity]
    members: list[MemberActivity]


def to_csv(days: list[DailyActivity]) -> str:
    """The same daily values as the chart, with a header even if empty."""
    output = StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["day", "progress_entries", "active_members"])
    for day in days:
        writer.writerow([day["day"], day["progress_entries"], day["active_members"]])
    return output.getvalue()


def _csv_label(value: str) -> str:
    """Quoting alone does not stop a spreadsheet evaluating a user label."""
    if value.lstrip().startswith(("=", "+", "-", "@")) or value.startswith(
        ("\t", "\r", "\n")
    ):
        return "'" + value
    return value


def to_report_csv(data: ActivityAnalytics, on_robot: bool | None) -> str:
    """One rectangular CSV, with typed rows for each view of the report."""
    output = StringIO(newline="")
    columns = [
        "section",
        "since",
        "until",
        "scope",
        "label",
        "id",
        "date",
        "on_robot",
        "status",
        "step",
        "progress_entries",
        "active_members",
        "active_days",
        "work_items",
        "last_progress_day",
        "is_current_member",
        "count",
    ]
    writer = csv.DictWriter(output, fieldnames=columns)
    writer.writeheader()

    def row(section: str, **values: object) -> None:
        writer.writerow(
            {
                "section": section,
                **data["period"],
                "scope": "all"
                if on_robot is None
                else "robot"
                if on_robot
                else "off_robot",
                **values,
            }
        )

    row("summary", **data["summary"])
    for day in data["activity_by_day"]:
        row(
            "day",
            date=day["day"],
            progress_entries=day["progress_entries"],
            active_members=day["active_members"],
        )
    for week in data["activity_by_week"]:
        row(
            "week",
            date=week["week_start"],
            progress_entries=week["progress_entries"],
            active_members=week["active_members"],
            active_days=week["active_days"],
        )
    for category in data["activity_by_category"]:
        row(
            "category",
            on_robot=str(category["on_robot"]).lower(),
            progress_entries=category["progress_entries"],
        )
    for item in data["work_items"]:
        row(
            "work_item",
            id=item["id"],
            label=_csv_label(item["title"]),
            on_robot=str(item["on_robot"]).lower(),
            status=item["status"],
            step=item["current_step"],
            progress_entries=item["progress_entries"],
            active_members=item["active_members"],
            active_days=item["active_days"],
            last_progress_day=item["last_progress_day"],
        )
    for member in data["members"]:
        row(
            "member",
            id=member["id"],
            label=_csv_label(member["display_name"]),
            progress_entries=member["progress_entries"],
            active_days=member["active_days"],
            work_items=member["work_items"],
            last_progress_day=member["last_progress_day"],
            is_current_member=str(member["is_current_member"]).lower(),
        )
    for status in data["snapshot"]["work_items_by_status"]:
        row("status", status=status["status"], count=status["count"])
    for step in data["snapshot"]["work_items_by_step"]:
        row("step", step=step["step"], count=step["count"])
    row(
        "snapshot",
        label="without_progress",
        count=data["snapshot"]["work_items_without_progress"],
    )
    return output.getvalue()


@dataclass
class _MemberTotals:
    days: set[date] = field(default_factory=set)
    entries: set[int] = field(default_factory=set)
    work_items: set[int] = field(default_factory=set)


@dataclass
class _GroupTotals:
    days: set[date] = field(default_factory=set)
    entries: int = 0
    members: set[int] = field(default_factory=set)


def _snapshot(
    team_season: TeamSeason, on_robot: bool | None, totals: dict[int, _GroupTotals]
) -> tuple[Snapshot, list[WorkItemActivity]]:
    """Current work-item state, independently of the requested period."""
    latest_progress = Entry.objects.filter(
        work_item_id=models.OuterRef("pk")
    ).progress_newest_first()
    selected_items = WorkItem.objects.filter(team_season=team_season)
    if on_robot is not None:
        selected_items = selected_items.filter(on_robot=on_robot)
    work_items = selected_items.annotate(
        analytics_latest_progress_id=models.Subquery(
            latest_progress.values("id")[:1],
            output_field=models.IntegerField(),
        ),
        analytics_current_step=models.Subquery(
            latest_progress.values("step")[:1],
            output_field=models.CharField(),
        ),
    ).values_list(
        "id",
        "title",
        "on_robot",
        "status",
        "analytics_latest_progress_id",
        "analytics_current_step",
    )

    status_counts = {value: 0 for value, _label in WorkItem.Status.choices}
    step_counts = {value: 0 for value, _label in Entry.Step.choices}
    without_progress = 0
    activity: list[WorkItemActivity] = []
    for item_id, title, side, status, latest_progress_id, current_step in work_items:
        status_counts[status] += 1
        if latest_progress_id is None:
            without_progress += 1
        elif current_step is not None:
            step_counts[current_step] += 1
        recorded = totals.get(item_id, _GroupTotals())
        activity.append(
            {
                "id": item_id,
                "title": title,
                "on_robot": side,
                "status": status,
                "current_step": current_step,
                "progress_entries": recorded.entries,
                "active_days": len(recorded.days),
                "active_members": len(recorded.members),
                "last_progress_day": max(recorded.days, default=None),
            }
        )

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
    }, activity


def summarize_activity(
    team_season: TeamSeason, since: date, until: date, *, on_robot: bool | None = None
) -> ActivityAnalytics:
    """Build the activity response in five queries, regardless of team size."""
    start = workday_bounds(since)[0]
    end = workday_bounds(until)[1]
    selected_progress = Entry.objects.filter(
        team_season=team_season,
        type=Entry.Type.PROGRESS,
        occurred_at__gte=start,
        occurred_at__lt=end,
    )
    if on_robot is not None:
        selected_progress = selected_progress.filter(work_item__on_robot=on_robot)
    progress_rows = list(
        selected_progress.values_list("id", "occurred_at", "work_item_id")
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
    weeks: dict[date, _GroupTotals] = {}
    work_totals: dict[int, _GroupTotals] = {}
    for day, work_item_id in progress.values():
        progress_by_day[day] = progress_by_day.get(day, 0) + 1
        active_members_by_day.setdefault(day, set())
        week = weeks.setdefault(day - timedelta(days=day.weekday()), _GroupTotals())
        week.entries += 1
        week.days.add(day)
        if work_item_id is not None:
            item = work_totals.setdefault(work_item_id, _GroupTotals())
            item.entries += 1
            item.days.add(day)

    totals: dict[int, _MemberTotals] = {}
    for entry_id, user_id in participants:
        day, work_item_id = progress[entry_id]
        active_members_by_day[day].add(user_id)
        weeks[day - timedelta(days=day.weekday())].members.add(user_id)
        if work_item_id is not None:
            work_totals[work_item_id].members.add(user_id)
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

    snapshot, work_items = _snapshot(team_season, on_robot, work_totals)
    return {
        "period": {"since": since, "until": until},
        "summary": {
            "progress_entries": len(progress),
            "active_days": len(progress_by_day),
            "active_members": len(totals),
            "work_items": len(work_totals),
        },
        "snapshot": snapshot,
        "work_items": work_items,
        "activity_by_category": [
            {
                "on_robot": side,
                "progress_entries": sum(
                    item["progress_entries"]
                    for item in work_items
                    if item["on_robot"] == side
                ),
            }
            for side in (True, False)
        ],
        "activity_by_week": [
            {
                "week_start": week,
                "progress_entries": group.entries,
                "active_members": len(group.members),
                "active_days": len(group.days),
            }
            for week, group in sorted(weeks.items())
        ],
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
