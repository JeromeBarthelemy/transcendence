from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from club.models import Entry, Membership, Season, Team, TeamSeason, User
from club.workdays import month_activity

PARIS = ZoneInfo("Europe/Paris")


@pytest.fixture
def calendar_team():
    season = Season.objects.create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=1796, name="Les Rouages")
    team_season = TeamSeason.objects.create(team=team, season=season)
    user = User.objects.create_user("lina@example.org", "Lina")
    Membership.objects.create(user=user, team_season=team_season)
    return team_season, user


def trace(team_season, user, instant, kind=Entry.Type.NOTE):
    return Entry.objects.create(
        team_season=team_season,
        author=user,
        type=kind,
        occurred_at=datetime.fromisoformat(instant).replace(tzinfo=PARIS),
    )


def calendar_url(team_season, month="2026-09"):
    return f"/api/team-seasons/{team_season.pk}/calendar/?month={month}"


def test_a_calendar_groups_all_three_kinds_sorted_by_workday(client, calendar_team):
    team, user = calendar_team
    trace(team, user, "2026-09-30T15:00", Entry.Type.PROGRESS)
    trace(team, user, "2026-09-02T15:00", Entry.Type.DECISION)
    trace(team, user, "2026-09-30T16:00", Entry.Type.PROGRESS)
    trace(team, user, "2026-09-30T17:00")
    client.force_login(user)

    response = client.get(calendar_url(team))

    assert response.status_code == 200
    assert response.json()["month"] == "2026-09"
    assert response.json()["days"] == [
        {"day": "2026-09-02", "progress": 0, "notes": 0, "decisions": 1},
        {"day": "2026-09-30", "progress": 2, "notes": 1, "decisions": 0},
    ]


def test_a_calendar_has_no_dates_for_an_empty_month(client, calendar_team):
    team, user = calendar_team
    trace(team, user, "2026-08-15T15:00")
    client.force_login(user)

    assert client.get(calendar_url(team)).json()["days"] == []


def test_month_boundaries_are_four_am_not_midnight(client, calendar_team):
    team, user = calendar_team
    trace(team, user, "2026-09-01T03:59")  # August
    trace(team, user, "2026-09-01T04:00")
    trace(team, user, "2026-10-01T03:59")  # September
    trace(team, user, "2026-10-01T04:00")  # October
    client.force_login(user)

    assert client.get(calendar_url(team)).json()["days"] == [
        {"day": "2026-09-01", "progress": 0, "notes": 1, "decisions": 0},
        {"day": "2026-09-30", "progress": 0, "notes": 1, "decisions": 0},
    ]


@pytest.mark.parametrize(
    ("instant", "month", "day"),
    [
        ("2026-03-29T03:30", "2026-03", "2026-03-28"),
        ("2026-03-29T04:00", "2026-03", "2026-03-29"),
        ("2026-10-25T03:30", "2026-10", "2026-10-24"),
        ("2026-10-25T04:00", "2026-10", "2026-10-25"),
        ("2024-02-29T15:00", "2024-02", "2024-02-29"),
        ("2027-01-01T03:59", "2026-12", "2026-12-31"),
        ("2000-01-01T04:00", "2000-01", "2000-01-01"),
        ("2099-12-31T15:00", "2099-12", "2099-12-31"),
    ],
)
def test_calendar_dates_use_the_same_workday_rule(
    client, calendar_team, instant, month, day
):
    team, user = calendar_team
    trace(team, user, instant)
    client.force_login(user)

    assert client.get(calendar_url(team, month)).json()["days"] == [
        {"day": day, "progress": 0, "notes": 1, "decisions": 0}
    ]


def test_today_is_resolved_on_the_server(client, calendar_team, monkeypatch):
    team, user = calendar_team
    monkeypatch.setattr(
        "club.api.views.timezone.now",
        lambda: datetime(2026, 10, 1, 1, 30, tzinfo=PARIS),
    )
    client.force_login(user)

    assert client.get(calendar_url(team)).json()["today"] == "2026-09-30"


def test_another_teams_traces_are_not_in_the_calendar(client, calendar_team):
    team, user = calendar_team
    other = TeamSeason.objects.create(
        team=Team.objects.create(number=999, name="Other"), season=team.season
    )
    trace(other, user, "2026-09-30T15:00")
    client.force_login(user)

    assert client.get(calendar_url(team)).json()["days"] == []


def test_anonymous_callers_cannot_read_a_calendar(client, calendar_team):
    team, _user = calendar_team

    assert client.get(calendar_url(team)).status_code == 403


def test_non_members_cannot_read_a_calendar(client, calendar_team):
    team, _user = calendar_team
    client.force_login(User.objects.create_user("tom@example.org", "Tom"))

    response = client.get(calendar_url(team))

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "not_a_member"


def test_mentors_can_read_any_teams_calendar(client, calendar_team):
    team, _user = calendar_team
    mentor = User.objects.create_user(
        "paul@example.org", "Paul", club_role=User.ClubRole.MENTOR
    )
    client.force_login(mentor)

    assert client.get(calendar_url(team)).status_code == 200
    assert (
        client.get("/api/team-seasons/999999/calendar/?month=2026-09").status_code
        == 404
    )


@pytest.mark.parametrize(
    "month",
    [
        "",
        "2026-00",
        "2026-13",
        "2026-1",
        "2026-01-01",
        "0000-01",
        "0001-01",
        "1999-12",
        "2100-01",
        "9999-12",
        "2026-02\n",
        "٢٠٢٦-٠٢",
    ],
)
def test_invalid_months_are_refused(client, calendar_team, month):
    team, user = calendar_team
    client.force_login(user)

    response = client.get(f"/api/team-seasons/{team.pk}/calendar/", {"month": month})

    assert response.status_code == 400
    assert "month" in response.json()


def test_the_month_is_required(client, calendar_team):
    team, user = calendar_team
    client.force_login(user)

    response = client.get(f"/api/team-seasons/{team.pk}/calendar/")

    assert response.status_code == 400
    assert response.json()["month"][0]["code"] == "required"


@pytest.mark.parametrize("populated", [False, True])
def test_aggregation_uses_one_query_for_the_whole_month(
    calendar_team, django_assert_num_queries, populated
):
    team, user = calendar_team
    if populated:
        for day in range(1, 31):
            trace(team, user, f"2026-09-{day:02d}T15:00")

    with django_assert_num_queries(1):
        result = month_activity(team, date(2026, 9, 1))

    assert len(result) == (30 if populated else 0)
