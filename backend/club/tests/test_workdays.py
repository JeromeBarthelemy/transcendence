from datetime import date, datetime, time
from zoneinfo import ZoneInfo

import pytest
from django.db import IntegrityError

from club.models import Season, WorkshopSlot
from club.workdays import workday

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
