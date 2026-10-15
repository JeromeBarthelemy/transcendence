"""A team's roster (#176): the students it counts on, a page reached from
their name or avatar — mentors supervise and are never in it."""

from club.models import Membership, Season, Team, TeamSeason, User

PASSWORD = "rouage-bleu-2026"


def team_season(number, start_year=2026):
    season, _ = Season.objects.get_or_create(
        start_year=start_year, defaults={"game_name": f"Game {start_year}"}
    )
    team, _ = Team.objects.get_or_create(
        number=number, defaults={"name": f"Team {number}"}
    )
    return TeamSeason.objects.create(team=team, season=season)


def person(name, club_role=User.ClubRole.STUDENT):
    return User.objects.create_user(
        f"{name}@club.fr", name, password=PASSWORD, club_role=club_role
    )


def roster(client, team_season):
    return client.get(f"/api/team-seasons/{team_season.id}/roster/")


def test_a_teammate_sees_the_roster(client):
    theirs = team_season(111)
    ada = person("ada")
    Membership.objects.create(user=ada, team_season=theirs)
    client.force_login(ada)

    response = roster(client, theirs)

    assert response.status_code == 200
    assert response.json() == [{"id": ada.id, "display_name": "ada", "avatar": None}]


def test_the_roster_leaves_out_mentors(client):
    theirs = team_season(111)
    paul = person("paul", User.ClubRole.MENTOR)
    ada = person("ada")
    Membership.objects.create(user=paul, team_season=theirs)
    Membership.objects.create(user=ada, team_season=theirs)
    client.force_login(ada)

    assert [member["display_name"] for member in roster(client, theirs).json()] == [
        "ada"
    ]


def test_a_mentor_sees_any_teams_roster(client):
    theirs = team_season(111)
    ada = person("ada")
    Membership.objects.create(user=ada, team_season=theirs)
    client.force_login(person("paul", User.ClubRole.MENTOR))

    assert roster(client, theirs).status_code == 200


def test_a_member_of_another_team_cannot_see_this_roster(client):
    theirs = team_season(111)
    team_season(222)
    outsider = person("tom")
    Membership.objects.create(user=outsider, team_season=team_season(333))
    client.force_login(outsider)

    response = roster(client, theirs)

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "not_a_member"


def test_an_anonymous_caller_cannot_see_a_roster(client):
    theirs = team_season(111)

    assert roster(client, theirs).status_code == 403


def test_the_roster_is_ordered_by_name(client):
    theirs = team_season(111)
    tom = person("tom")
    Membership.objects.create(user=tom, team_season=theirs)
    for name in ("theo", "ada", "zoe"):
        Membership.objects.create(user=person(name), team_season=theirs)
    client.force_login(tom)

    assert [member["display_name"] for member in roster(client, theirs).json()] == [
        "ada",
        "theo",
        "tom",
        "zoe",
    ]
