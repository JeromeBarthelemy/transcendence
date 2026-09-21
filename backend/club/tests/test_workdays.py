from datetime import date, datetime, time
from zoneinfo import ZoneInfo

import pytest
from django.db import IntegrityError

from club.models import (
    Entry,
    EntryParticipant,
    Season,
    Team,
    TeamSeason,
    User,
    WorkItem,
    WorkshopSlot,
)
from club.workdays import attendance, day_entries, workday

PARIS = ZoneInfo("Europe/Paris")


def at(day, hour, minute=0):
    return datetime.combine(day, time(hour, minute), tzinfo=PARIS)


def test_a_late_evening_belongs_to_the_day_it_started():
    # A rush that ends at one in the morning is still Saturday's.
    assert workday(at(date(2026, 11, 15), 1, 30)) == date(2026, 11, 14)


def test_the_day_turns_at_four_in_the_morning():
    assert workday(at(date(2026, 11, 15), 3, 59)) == date(2026, 11, 14)
    assert workday(at(date(2026, 11, 15), 4, 0)) == date(2026, 11, 15)


def test_the_day_is_read_in_paris_time():
    # 01:30 UTC in summer is 03:30 in Paris: still the day before.
    utc_instant = datetime(2026, 9, 17, 1, 30, tzinfo=ZoneInfo("UTC"))

    assert workday(utc_instant) == date(2026, 9, 16)


def test_a_slot_cannot_end_before_it_starts():
    season = Season.objects.create(start_year=2026, game_name="BioBuzz")

    with pytest.raises(IntegrityError):
        WorkshopSlot.objects.create(
            season=season,
            weekday=WorkshopSlot.Weekday.WEDNESDAY,
            start_time=time(14),
            valid_from=date(2027, 1, 6),
            valid_until=date(2026, 12, 16),
        )


WEDNESDAY = date(2026, 11, 18)


def team_season(number=12345):
    season, _ = Season.objects.get_or_create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=number, name=f"Équipe {number}")
    return TeamSeason.objects.create(team=team, season=season)


def member(name, role=User.ClubRole.STUDENT):
    return User.objects.create_user(f"{name}@example.org", name, club_role=role)


def progress(team, when, *participants):
    intake, _ = WorkItem.objects.get_or_create(team_season=team, title="intake")
    entry = Entry.objects.create(
        team_season=team,
        author=participants[0],
        work_item=intake,
        type=Entry.Type.PROGRESS,
        occurred_at=when,
    )
    for user in participants:
        EntryParticipant.objects.create(entry=entry, user=user)
    return entry


def test_a_day_gathers_its_entries_up_to_four_the_next_morning():
    rouages = team_season()
    lina = member("lina")
    afternoon = progress(rouages, at(WEDNESDAY, 15), lina)
    late = progress(rouages, at(date(2026, 11, 19), 1), lina)
    progress(rouages, at(WEDNESDAY, 3), lina)  # still Tuesday
    progress(rouages, at(date(2026, 11, 19), 4), lina)  # already Thursday

    assert set(day_entries(rouages, WEDNESDAY)) == {afternoon, late}


def test_a_day_holds_only_its_own_teams_entries():
    rouages = team_season(12345)
    engrenages = team_season(67890)
    lina = member("lina")
    ours = progress(rouages, at(WEDNESDAY, 15), lina)
    progress(engrenages, at(WEDNESDAY, 15), lina)

    assert list(day_entries(rouages, WEDNESDAY)) == [ours]


def test_the_present_are_the_students_signed_up_that_day():
    rouages = team_season()
    lina, tom, sam = member("lina"), member("tom"), member("sam")
    progress(rouages, at(WEDNESDAY, 15), lina, tom)
    progress(rouages, at(WEDNESDAY, 16), tom)
    progress(rouages, at(date(2026, 11, 20), 18), sam)  # Friday

    assert set(attendance(rouages, WEDNESDAY)) == {lina, tom}


def test_a_mentor_is_never_counted_present():
    # Mentors supervise; they are not the team's roster.
    rouages = team_season()
    lina = member("lina")
    paul = member("paul", User.ClubRole.MENTOR)
    progress(rouages, at(WEDNESDAY, 15), lina, paul)

    assert list(attendance(rouages, WEDNESDAY)) == [lina]


def test_only_progress_makes_someone_present():
    rouages = team_season()
    lina = member("lina")
    Entry.objects.create(
        team_season=rouages,
        author=lina,
        type=Entry.Type.NOTE,
        occurred_at=at(WEDNESDAY, 15),
    )

    assert not attendance(rouages, WEDNESDAY).exists()


def test_being_present_for_another_team_does_not_count():
    rouages = team_season(12345)
    engrenages = team_season(67890)
    progress(engrenages, at(WEDNESDAY, 15), member("lina"))

    assert not attendance(rouages, WEDNESDAY).exists()
