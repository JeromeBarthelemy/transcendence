"""The demo club a fresh install can be filled with, so its screens and routes
have something to show."""

from datetime import timedelta
from io import StringIO
from urllib.error import URLError

import pytest
from django.contrib.auth import authenticate
from django.core.management import CommandError, call_command
from django.utils import timezone

from club.models import Document, Entry, Season, Team, TeamSeason, User, WorkItem
from club.workdays import attendance, gaps, workday

from .test_rag import REAL_HTML_EXCERPT, REAL_QA_BOARD_EXCERPT

PASSWORD = "rouage-demo-2026"


MANUAL_URL = (
    "https://ftc-resources.firstinspires.org/ftc/game/cm-html/"
    "BIOBUZZ%20Competition%20Manual%20-%20TU05.htm"
)
QA_URL = "https://game-qa.firstinspires.org/boards/2027/FTC/QA"


def seed(**options):
    call_command("seed_demo", stdout=StringIO(), **options)


def serve_first_pages(monkeypatch):
    pages = {
        Document.Source.GAME_MANUAL: REAL_HTML_EXCERPT,
        Document.Source.OFFICIAL_QA: REAL_QA_BOARD_EXCERPT,
    }
    monkeypatch.setattr("club.sources.fetch_page", lambda url, source: pages[source])


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
        assert items.filter(status=WorkItem.Status.OPEN).exists()
        assert items.filter(status=WorkItem.Status.DONE, on_robot=False).exists()
        assert items.filter(status=WorkItem.Status.DROPPED, on_robot=True).exists()
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


def test_the_demo_administrator_can_open_the_django_admin(client):
    seed()

    client.force_login(User.objects.get(display_name="Paul"))

    assert client.get("/admin/").status_code == 200


def test_the_demo_season_gets_the_manual_and_the_qa_from_their_urls(monkeypatch):
    serve_first_pages(monkeypatch)

    seed(manual_url=MANUAL_URL, qa_url=QA_URL)

    season = Season.objects.get()
    manual = Document.objects.get(season=season, source=Document.Source.GAME_MANUAL)
    qa = Document.objects.get(season=season, source=Document.Source.OFFICIAL_QA)
    assert manual.url == MANUAL_URL and manual.chunks.exists()
    assert qa.url == QA_URL and qa.chunks.exists()


def test_without_urls_the_demo_fetches_nothing(monkeypatch):
    def offline(url, source):
        raise AssertionError("no page should be fetched")

    monkeypatch.setattr("club.sources.fetch_page", offline)

    seed()

    assert not Document.objects.exists()


def test_a_page_that_cannot_be_fetched_leaves_no_demo_club(monkeypatch):
    def unreachable(url, source):
        raise URLError("offline")

    monkeypatch.setattr("club.sources.fetch_page", unreachable)

    with pytest.raises(CommandError):
        seed(manual_url=MANUAL_URL, qa_url=QA_URL)

    assert not User.objects.exists()
    assert not Team.objects.exists()
    assert not Document.objects.exists()


def test_a_url_off_first_s_site_is_refused_before_anything_is_created(monkeypatch):
    serve_first_pages(monkeypatch)

    with pytest.raises(CommandError):
        seed(manual_url="https://example.com/manual.htm", qa_url=QA_URL)

    assert not User.objects.exists()
    assert not Document.objects.exists()
