"""Opening another member's profile (#176): any signed-in member may, and
never sees more than a display name, a photo and a current-season team."""

from django.utils import timezone

from club.models import Membership, Season, Team, TeamSeason, User

PASSWORD = "rouage-bleu-2026"


def person(name, club_role=User.ClubRole.STUDENT, **extra):
    return User.objects.create_user(
        f"{name}@club.fr", name, password=PASSWORD, club_role=club_role, **extra
    )


def team_season(number, start_year=2026):
    season, _ = Season.objects.get_or_create(
        start_year=start_year, defaults={"game_name": f"Game {start_year}"}
    )
    team, _ = Team.objects.get_or_create(
        number=number, defaults={"name": f"Team {number}"}
    )
    return TeamSeason.objects.create(team=team, season=season)


def profile(client, user):
    return client.get(f"/api/users/{user.pk}/profile/")


def test_a_students_profile_shows_their_current_season_team(client):
    ada = person("ada")
    theirs = team_season(111)
    Membership.objects.create(user=ada, team_season=theirs)
    client.force_login(person("tom"))

    response = profile(client, ada)

    assert response.status_code == 200
    assert response.json() == {
        "id": ada.id,
        "display_name": "ada",
        "avatar": None,
        "online": None,
        "club_role": "student",
        "team": {"id": theirs.team.id, "number": 111, "name": "Team 111"},
    }


def test_a_mentors_profile_carries_no_single_team(client):
    paul = person("paul", User.ClubRole.MENTOR)
    client.force_login(person("tom"))

    response = profile(client, paul)

    assert response.status_code == 200
    assert response.json()["club_role"] == "mentor"
    assert response.json()["team"] is None


def test_a_student_with_no_current_season_membership_has_no_team(client):
    ada = person("ada")
    client.force_login(person("tom"))

    assert profile(client, ada).json()["team"] is None


def test_a_membership_from_a_past_season_does_not_count_as_current(client):
    ada = person("ada")
    last_year = team_season(111, start_year=2025)
    team_season(222, start_year=2026)
    Membership.objects.create(user=ada, team_season=last_year)
    client.force_login(person("tom"))

    assert profile(client, ada).json()["team"] is None


def test_opening_a_profile_never_carries_an_address_or_a_birth_date(client):
    ada = person("ada", birth_date="2010-05-01")
    client.force_login(person("tom"))

    assert set(profile(client, ada).json()) == {
        "id",
        "display_name",
        "avatar",
        "online",
        "club_role",
        "team",
    }


def test_a_member_sees_a_profile_whatever_the_team(client):
    # The club works in one room: opening a profile is not limited to one's
    # own team, unlike the online status split out to #267.
    ada = person("ada")
    theirs = team_season(111)
    Membership.objects.create(user=ada, team_season=theirs)
    tom = person("tom")
    Membership.objects.create(user=tom, team_season=team_season(222))
    client.force_login(tom)

    assert profile(client, ada).status_code == 200


def test_an_anonymous_caller_cannot_open_a_profile(client):
    ada = person("ada")

    assert profile(client, ada).status_code == 403


def test_opening_a_suspended_members_profile_finds_nothing(client):
    ada = person("ada", is_active=False)
    client.force_login(person("tom"))

    assert profile(client, ada).status_code == 404


def test_opening_an_unknown_members_profile_finds_nothing(client):
    client.force_login(person("tom"))

    assert client.get("/api/users/999999/profile/").status_code == 404


def test_a_teammate_sees_whether_ada_is_online(client):
    theirs = team_season(111)
    ada = person("ada")
    tom = person("tom")
    Membership.objects.create(user=ada, team_season=theirs)
    Membership.objects.create(user=tom, team_season=theirs)
    client.force_login(tom)

    assert profile(client, ada).json()["online"] is False

    ada.last_seen = timezone.now()
    ada.save(update_fields=["last_seen"])

    assert profile(client, ada).json()["online"] is True


def test_a_non_teammate_never_sees_online_status(client):
    ada = person("ada", last_seen=timezone.now())
    Membership.objects.create(user=ada, team_season=team_season(111))
    client.force_login(person("tom"))

    assert profile(client, ada).json()["online"] is None


def test_a_mentor_always_sees_online_status(client):
    ada = person("ada", last_seen=timezone.now())
    client.force_login(person("paul", User.ClubRole.MENTOR))

    assert profile(client, ada).json()["online"] is True
