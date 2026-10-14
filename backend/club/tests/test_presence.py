"""A teammate's online status (#267): a green dot, nothing else."""

from datetime import timedelta

from django.utils import timezone

from club.models import Membership, Season, Team, TeamSeason, User
from club.presence import is_online, shares_current_team, touch_last_seen

NOW = timezone.now()


def person(name, club_role=User.ClubRole.STUDENT, **extra):
    return User.objects.create_user(
        f"{name}@club.fr", name, club_role=club_role, **extra
    )


def team_season(number, start_year=2026):
    season, _ = Season.objects.get_or_create(
        start_year=start_year, defaults={"game_name": f"Game {start_year}"}
    )
    team, _ = Team.objects.get_or_create(
        number=number, defaults={"name": f"Team {number}"}
    )
    return TeamSeason.objects.create(team=team, season=season)


# --- is_online ---


def test_a_member_never_seen_is_offline():
    assert is_online(person("ada")) is False


def test_a_recently_seen_member_is_online(monkeypatch):
    monkeypatch.setattr("club.presence.timezone.now", lambda: NOW)
    ada = person("ada", last_seen=NOW - timedelta(minutes=1))

    assert is_online(ada) is True


def test_a_member_seen_long_ago_is_offline(monkeypatch):
    monkeypatch.setattr("club.presence.timezone.now", lambda: NOW)
    ada = person("ada", last_seen=NOW - timedelta(minutes=5))

    assert is_online(ada) is False


# --- touch_last_seen ---


def test_touch_last_seen_sets_it_the_first_time(monkeypatch):
    monkeypatch.setattr("club.presence.timezone.now", lambda: NOW)
    ada = person("ada")

    touch_last_seen(ada)

    ada.refresh_from_db()
    assert ada.last_seen == NOW


def test_touch_last_seen_does_nothing_within_the_interval(monkeypatch):
    seen_at = NOW - timedelta(seconds=30)
    ada = person("ada", last_seen=seen_at)
    monkeypatch.setattr("club.presence.timezone.now", lambda: NOW)

    touch_last_seen(ada)

    ada.refresh_from_db()
    assert ada.last_seen == seen_at


def test_touch_last_seen_updates_again_once_the_interval_has_passed(monkeypatch):
    seen_at = NOW - timedelta(minutes=2)
    ada = person("ada", last_seen=seen_at)
    monkeypatch.setattr("club.presence.timezone.now", lambda: NOW)

    touch_last_seen(ada)

    ada.refresh_from_db()
    assert ada.last_seen == NOW


# --- shares_current_team ---


def test_a_mentor_always_shares_the_current_team():
    paul = person("paul", User.ClubRole.MENTOR)
    ada = person("ada")
    Membership.objects.create(user=ada, team_season=team_season(111))

    assert shares_current_team(paul, ada) is True


def test_two_students_on_the_same_team_share_it():
    theirs = team_season(111)
    ada = person("ada")
    tom = person("tom")
    Membership.objects.create(user=ada, team_season=theirs)
    Membership.objects.create(user=tom, team_season=theirs)

    assert shares_current_team(tom, ada) is True


def test_two_students_on_different_teams_do_not_share_it():
    ada = person("ada")
    tom = person("tom")
    Membership.objects.create(user=ada, team_season=team_season(111))
    Membership.objects.create(user=tom, team_season=team_season(222))

    assert shares_current_team(tom, ada) is False


def test_a_shared_team_from_a_past_season_does_not_count():
    ada = person("ada")
    tom = person("tom")
    last_year = team_season(111, start_year=2025)
    team_season(222, start_year=2026)
    Membership.objects.create(user=ada, team_season=last_year)
    Membership.objects.create(user=tom, team_season=last_year)

    assert shares_current_team(tom, ada) is False


def test_a_student_with_no_team_shares_nothing():
    ada = person("ada")
    tom = person("tom")

    assert shares_current_team(tom, ada) is False


# --- the middleware, end to end ---


def test_a_signed_in_requests_own_visit_sets_last_seen(client):
    ada = person("ada")
    assert ada.last_seen is None
    client.force_login(ada)

    client.get("/api/auth/me/")

    ada.refresh_from_db()
    assert ada.last_seen is not None


def test_an_anonymous_visit_raises_nothing(client):
    # isinstance(user, User) must hold for AnonymousUser too.
    assert client.get("/api/auth/me/").status_code == 200
