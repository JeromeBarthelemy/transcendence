from club.models import Membership, Season, Team, TeamSeason, User

PASSWORD = "rouage-bleu-2026"
ME = "/api/auth/me/"


def team_season(number, start_year=2026):
    season, _ = Season.objects.get_or_create(
        start_year=start_year, defaults={"game_name": f"Game {start_year}"}
    )
    team, _ = Team.objects.get_or_create(
        number=number, defaults={"name": f"Team {number}"}
    )
    return TeamSeason.objects.create(team=team, season=season)


def person(name, club_role=User.ClubRole.STUDENT, **extra):
    return User.objects.create_user(
        f"{name}@club.fr", name, password=PASSWORD, club_role=club_role, **extra
    )


def team_season_ids(client, user):
    client.force_login(user)
    return [entry["id"] for entry in client.get(ME).json()["team_seasons"]]


def test_a_student_sees_only_the_team_seasons_they_belong_to(client):
    ada = person("ada")
    theirs = team_season(111)
    team_season(222)
    Membership.objects.create(user=ada, team_season=theirs)

    assert team_season_ids(client, ada) == [theirs.id]


def test_a_mentor_sees_only_the_team_seasons_they_are_assigned_to(client):
    claire = person("claire", User.ClubRole.MENTOR)
    first, second = team_season(111), team_season(222)
    team_season(333)
    for each in (first, second):
        Membership.objects.create(user=claire, team_season=each)

    assert team_season_ids(client, claire) == [first.id, second.id]


def test_a_mentor_without_a_team_gets_an_empty_list(client):
    team_season(111)

    assert team_season_ids(client, person("claire", User.ClubRole.MENTOR)) == []


def test_a_club_admin_sees_every_team_season(client):
    first, second = team_season(111), team_season(222)
    paul = person("paul", User.ClubRole.MENTOR, is_club_admin=True)

    assert team_season_ids(client, paul) == [first.id, second.id]


def test_a_student_without_a_team_gets_an_empty_list(client):
    team_season(111)

    assert team_season_ids(client, person("ada")) == []


def test_the_newest_season_comes_first(client):
    ada = person("ada")
    last_year = team_season(111, start_year=2025)
    this_year = team_season(111, start_year=2026)
    for each in (last_year, this_year):
        Membership.objects.create(user=ada, team_season=each)

    assert team_season_ids(client, ada) == [this_year.id, last_year.id]


def test_a_team_season_names_its_team_and_its_season(client):
    ada = person("ada")
    theirs = team_season(111)
    Membership.objects.create(user=ada, team_season=theirs)
    client.force_login(ada)

    assert client.get(ME).json()["team_seasons"] == [
        {
            "id": theirs.id,
            "team": {"id": theirs.team.id, "number": 111, "name": "Team 111"},
            "season": {"start_year": 2026, "game_name": "Game 2026"},
        }
    ]


def test_the_login_response_carries_the_team_seasons_too(client):
    ada = person("ada")
    theirs = team_season(111)
    Membership.objects.create(user=ada, team_season=theirs)

    response = client.post(
        "/api/auth/login/",
        {"username": "ada", "password": PASSWORD},
        content_type="application/json",
    )

    assert [entry["id"] for entry in response.json()["team_seasons"]] == [theirs.id]
