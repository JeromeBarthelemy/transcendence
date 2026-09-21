"""The workday: what a team did on a given day, read off its entries. Nothing
here is stored — a day is a reading, not an object."""

from datetime import date, datetime, timedelta

from django.utils import timezone

# A rush that ends at one in the morning belongs to the day it started, as
# everyone but a clock thinks.
DAY_TURNS_AT = timedelta(hours=4)


def workday(instant: datetime) -> date:
    """The day an instant belongs to, in the club's time zone."""
    return (timezone.localtime(instant) - DAY_TURNS_AT).date()
