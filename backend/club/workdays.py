"""The workday: what a team did on a given day, read off its entries. Nothing
here is stored — a day is a reading, not an object."""

from datetime import date, datetime, time, timedelta

from django.db.models import QuerySet
from django.utils import timezone

from club.models import Entry, TeamSeason, User, WorkItem, WorkshopSlot

# A rush that ends at one in the morning belongs to the day it started, as
# everyone but a clock thinks.
DAY_TURNS_AT = timedelta(hours=4)


def workday(instant: datetime) -> date:
    """The day an instant belongs to, in the club's time zone."""
    return (timezone.localtime(instant) - DAY_TURNS_AT).date()


def _bounds(day: date) -> tuple[datetime, datetime]:
    # Built from local wall-clock times, not by adding 24 hours: the day the
    # clocks change is 23 or 25 hours long.
    def turn(of: date) -> datetime:
        return timezone.make_aware(datetime.combine(of, time()) + DAY_TURNS_AT)

    return turn(day), turn(day + timedelta(days=1))


def day_entries(team_season: TeamSeason, day: date) -> QuerySet[Entry]:
    """Everything the team wrote down for that day: the day's summary."""
    start, end = _bounds(day)
    return Entry.objects.filter(
        team_season=team_season, occurred_at__gte=start, occurred_at__lt=end
    )


def attendance(team_season: TeamSeason, day: date) -> QuerySet[User]:
    """The students signed up to one of the team's progress entries that day.
    Mentors supervise and are not the roster; being there without moving
    anything forward is not counted either."""
    progress = day_entries(team_season, day).filter(type=Entry.Type.PROGRESS)
    return User.objects.filter(
        club_role=User.ClubRole.STUDENT, participations__in=progress
    ).distinct()


def gaps(team_season: TeamSeason, since: date, until: date) -> list[date]:
    """The slot days, from since to until, on which the team moved nothing
    forward. Today is never one: its slot may not have happened yet."""
    last = min(until, workday(timezone.now()) - timedelta(days=1))
    expected: set[date] = set()
    for slot in WorkshopSlot.objects.filter(season=team_season.season):
        start = max(since, slot.valid_from)
        end = min(last, slot.valid_until or last)
        first = start + timedelta(days=(slot.weekday - start.weekday()) % 7)
        expected.update(
            first + timedelta(weeks=n) for n in range((end - first).days // 7 + 1)
        )

    low, high = _bounds(since)[0], _bounds(last)[1]
    worked = {
        workday(occurred_at)
        for occurred_at in Entry.objects.filter(
            team_season=team_season,
            type=Entry.Type.PROGRESS,
            occurred_at__gte=low,
            occurred_at__lt=high,
        ).values_list("occurred_at", flat=True)
    }
    return sorted(expected - worked)


def progress_of_the_day(work_item: WorkItem, day: date) -> Entry | None:
    """The progress someone ticking this work item joins, or None when they
    are the first today and create it. After a change of step there are two;
    the latest is the one under way."""
    return (
        day_entries(work_item.team_season, day)
        .filter(work_item=work_item, type=Entry.Type.PROGRESS)
        .order_by("-occurred_at", "-id")
        .first()
    )
