"""A teammate's online status (#267): a green dot, nothing else — derived
from the WebSocket every signed-in member already holds, not from a stored
timestamp (reviewed on #272)."""

from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from config.asgi import application
from django.test import Client

from club.models import Membership, Season, Team, TeamSeason, User
from club.presence import (
    connected,
    current_team_season_ids,
    disconnected,
    is_online,
    shares_current_team,
)


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


# --- is_online / connected / disconnected ---


def test_a_member_with_no_open_socket_is_offline():
    assert is_online(person("ada")) is False


def test_connecting_once_makes_a_member_online():
    ada = person("ada")

    assert connected(ada.pk) is True
    assert is_online(ada) is True


def test_a_second_tab_does_not_double_count_as_a_fresh_connection():
    ada = person("ada")
    connected(ada.pk)

    assert connected(ada.pk) is False
    assert is_online(ada) is True


def test_disconnecting_one_of_two_tabs_leaves_the_member_online():
    ada = person("ada")
    connected(ada.pk)
    connected(ada.pk)

    assert disconnected(ada.pk) is False
    assert is_online(ada) is True


def test_disconnecting_the_last_tab_makes_a_member_offline():
    ada = person("ada")
    connected(ada.pk)

    assert disconnected(ada.pk) is True
    assert is_online(ada) is False


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


# --- current_team_season_ids ---


def test_a_students_current_team_season_ids_are_their_own():
    ada = person("ada")
    theirs = team_season(111)
    Membership.objects.create(user=ada, team_season=theirs)

    assert current_team_season_ids(ada) == [theirs.id]


def test_a_past_seasons_team_is_not_a_current_team_season_id():
    ada = person("ada")
    last_year = team_season(111, start_year=2025)
    team_season(222, start_year=2026)
    Membership.objects.create(user=ada, team_season=last_year)

    assert current_team_season_ids(ada) == []


def test_a_mentor_has_no_current_team_season_ids():
    paul = person("paul", User.ClubRole.MENTOR)

    assert current_team_season_ids(paul) == []


# --- the socket, end to end ---


def headers(user):
    client = Client()
    client.force_login(user)
    session = client.cookies["sessionid"].value
    return [
        (b"origin", b"http://localhost"),
        (b"cookie", f"sessionid={session}".encode()),
    ]


def test_connecting_a_socket_makes_a_member_online(db):
    ada = person("ada")
    sent = headers(ada)

    async def scenario():
        communicator = WebsocketCommunicator(application, "/ws/me/", sent)
        await communicator.connect()
        during = is_online(ada)
        await communicator.disconnect()
        return during

    during = async_to_sync(scenario)()

    assert during is True
    assert is_online(ada) is False


def test_a_teammate_hears_a_socket_open_and_close(db):
    theirs = team_season(111)
    ada = person("ada")
    tom = person("tom")
    Membership.objects.create(user=ada, team_season=theirs)
    Membership.objects.create(user=tom, team_season=theirs)
    toms_headers = headers(tom)
    adas_headers = headers(ada)

    async def scenario():
        listener = WebsocketCommunicator(application, "/ws/me/", toms_headers)
        await listener.connect()

        arriving = WebsocketCommunicator(application, "/ws/me/", adas_headers)
        await arriving.connect()
        opened = await listener.receive_json_from()

        await arriving.disconnect()
        closed = await listener.receive_json_from()

        await listener.disconnect()
        return opened, closed

    opened, closed = async_to_sync(scenario)()

    assert opened == {"presence": True, "team_season": theirs.id}
    assert closed == {"presence": True, "team_season": theirs.id}


def test_a_member_of_another_team_hears_nothing_of_a_sockets_open_or_close(db):
    theirs = team_season(111)
    other = team_season(222)
    tom = person("tom")
    Membership.objects.create(user=tom, team_season=other)
    ada = person("ada")
    Membership.objects.create(user=ada, team_season=theirs)
    toms_headers = headers(tom)
    adas_headers = headers(ada)

    async def scenario():
        listener = WebsocketCommunicator(application, "/ws/me/", toms_headers)
        await listener.connect()

        arriving = WebsocketCommunicator(application, "/ws/me/", adas_headers)
        await arriving.connect()
        heard = await listener.receive_nothing(timeout=0.2)

        await arriving.disconnect()
        await listener.disconnect()
        return heard

    heard_nothing = async_to_sync(scenario)()

    assert heard_nothing


def test_a_second_tab_tells_nobody_again(db):
    theirs = team_season(111)
    ada = person("ada")
    tom = person("tom")
    Membership.objects.create(user=ada, team_season=theirs)
    Membership.objects.create(user=tom, team_season=theirs)
    toms_headers = headers(tom)
    adas_headers = headers(ada)

    async def scenario():
        listener = WebsocketCommunicator(application, "/ws/me/", toms_headers)
        await listener.connect()

        first_tab = WebsocketCommunicator(application, "/ws/me/", adas_headers)
        await first_tab.connect()
        await listener.receive_json_from()

        second_tab = WebsocketCommunicator(application, "/ws/me/", adas_headers)
        await second_tab.connect()
        heard_again = await listener.receive_nothing(timeout=0.2)

        await first_tab.disconnect()
        await second_tab.disconnect()
        await listener.disconnect()
        return heard_again

    heard_nothing = async_to_sync(scenario)()

    assert heard_nothing
