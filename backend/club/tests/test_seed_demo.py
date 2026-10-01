"""The demo club a fresh install can be filled with, so its screens and routes
have something to show."""

from datetime import timedelta
from io import StringIO

import pytest
from django.contrib.auth import authenticate
from django.core.management import CommandError, call_command
from django.utils import timezone

from club.models import Entry, Team, TeamSeason, User, WorkItem
from club.workdays import attendance, gaps, workday

PASSWORD = "rouage-demo-2026"


def seed():
    call_command("seed_demo", stdout=StringIO())


def test_the_demo_club_has_four_teams_with_their_students():
    seed()

    assert Team.objects.count() == 4
    for team_season in TeamSeason.objects.all():
        assert team_season.memberships.count() == 3


def test_the_demo_accounts_sign_in_with_the_demo_password():
    seed()

    # One of each kind: the admin, a mentor, a student, the unverified one.
    for name in ["Paul", "Claire", "Lina", "Yanis"]:
        user = User.objects.get(display_name=name)
        assert authenticate(username=name, password=PASSWORD) == user


def test_every_team_has_work_items_with_a_thread():
    seed()

    for team_season in TeamSeason.objects.all():
        items = team_season.work_items.all()
        assert items.filter(on_robot=True).exists()
        assert items.filter(on_robot=False).exists()
        assert items.filter(status=WorkItem.Status.SUGGESTED).exists()
        assert items.filter(status=WorkItem.Status.DONE).exists()
        assert team_season.entries.filter(type=Entry.Type.PROGRESS).count() >= 5
        assert team_season.entries.exclude(handover="").exists()


def test_the_demo_is_dated_up_to_the_last_few_days():
    seed()

    latest = Entry.objects.latest("occurred_at").occurred_at
    assert timezone.now() - latest < timedelta(days=7)
    # Written through the application's rules, then dated in the past: the
    # entries look written on the day, not all at once today.
    for entry in Entry.objects.all():
        assert entry.created_at == entry.occurred_at


def test_a_demo_team_has_days_with_who_was_there_and_days_without_progress():
    seed()
    today = workday(timezone.now())

    for team_season in TeamSeason.objects.all():
        since = today - timedelta(weeks=4)
        assert gaps(team_season, since, today)
        days = {workday(entry.occurred_at) for entry in team_season.entries.all()}
        assert any(attendance(team_season, day).exists() for day in days)


def test_a_work_item_off_the_robot_carries_no_step():
    seed()

    off_robot = Entry.objects.filter(work_item__on_robot=False)
    assert off_robot.exists()
    assert not off_robot.exclude(step=None).exists()


def test_seeding_refuses_a_database_that_already_holds_accounts():
    User.objects.create_user("vraie@club.fr", "Vraie")

    with pytest.raises(CommandError):
        seed()

    assert User.objects.count() == 1
    assert not Team.objects.exists()
