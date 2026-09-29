from django.utils import timezone

from club.models import Entry, Membership, Season, Team, TeamSeason, User, WorkItem
from club.workdays import attendance, workday


def team_season(number=12345):
    season, _ = Season.objects.get_or_create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=number, name=f"Équipe {number}")
    return TeamSeason.objects.create(team=team, season=season)


def member_of(team_season, name="lina"):
    user = User.objects.create_user(f"{name}@example.org", name)
    Membership.objects.create(user=user, team_season=team_season)
    return user


def mentor(name="paul"):
    return User.objects.create_user(
        f"{name}@example.org", name, club_role=User.ClubRole.MENTOR
    )


def decide(client, team, **body):
    return client.post(
        f"/api/team-seasons/{team.id}/decisions/", body, content_type="application/json"
    )


def names(members):
    return {member["display_name"] for member in members}


# --- writing one ---


def test_a_member_writes_a_decision_for_the_team(client):
    rouages = team_season()
    client.force_login(member_of(rouages))

    response = decide(client, rouages, body="On passe aux roues mecanum.")

    assert response.status_code == 201
    written = Entry.objects.get()
    assert written.type == Entry.Type.DECISION
    assert written.team_season == rouages
    assert written.author.display_name == "lina"
    assert written.work_item is None


def test_a_decision_about_a_work_item_waits_in_its_thread(client):
    rouages = team_season()
    bras = WorkItem.objects.create(team_season=rouages, title="bras", on_robot=True)
    client.force_login(member_of(rouages))

    decide(client, rouages, body="Le bras sera en carbone.", work_item=bras.id)

    [waiting] = client.get(f"/api/work-items/{bras.id}/").json()["thread"]
    assert waiting["type"] == "decision"
    assert waiting["body"] == "Le bras sera en carbone."


def test_a_decision_cannot_be_about_another_teams_work_item(client):
    rouages = team_season(12345)
    theirs = WorkItem.objects.create(team_season=team_season(67890), title="bras")
    client.force_login(member_of(rouages))

    response = decide(client, rouages, body="Carbone.", work_item=theirs.id)

    assert response.status_code == 400
    assert response.json()["work_item"][0]["code"] == "work_item_not_in_team"
    assert not Entry.objects.exists()


def test_an_empty_decision_is_refused(client):
    rouages = team_season()
    client.force_login(member_of(rouages))

    assert decide(client, rouages, body="").status_code == 400


def test_a_student_cannot_write_a_decision_in_another_team(client):
    rouages = team_season(12345)
    client.force_login(member_of(team_season(67890)))

    assert decide(client, rouages, body="Carbone.").status_code == 403
    assert not Entry.objects.exists()


# --- who was at the meeting ---


def test_the_author_is_at_the_meeting_with_those_they_tick(client):
    rouages = team_season()
    lina, tom = member_of(rouages, "lina"), member_of(rouages, "tom")
    member_of(rouages, "sam")
    client.force_login(lina)

    response = decide(client, rouages, body="Carbone.", attendees=[tom.id])

    assert names(response.json()["participants"]) == {"lina", "tom"}


def test_a_mentor_can_be_ticked_at_the_meeting(client):
    rouages = team_season()
    paul = mentor()
    client.force_login(member_of(rouages))

    response = decide(client, rouages, body="Carbone.", attendees=[paul.id])

    assert names(response.json()["participants"]) == {"lina", "paul"}


def test_a_student_of_another_team_cannot_be_ticked(client):
    rouages = team_season(12345)
    sam = member_of(team_season(67890), "sam")
    client.force_login(member_of(rouages))

    response = decide(client, rouages, body="Carbone.", attendees=[sam.id])

    assert response.status_code == 400
    assert response.json()["attendees"][0]["code"] == "attendee_not_in_team"
    assert not Entry.objects.exists()


# --- presence ---


def test_the_student_who_writes_a_decision_is_present(client):
    rouages = team_season()
    lina = member_of(rouages)
    client.force_login(lina)

    decide(client, rouages, body="Carbone.")

    assert list(attendance(rouages, workday(timezone.now()))) == [lina]


def test_a_student_only_ticked_on_a_decision_is_not_present(client):
    # Nobody signs anybody else up: being ticked is the author's word.
    rouages = team_season()
    lina, tom = member_of(rouages, "lina"), member_of(rouages, "tom")
    client.force_login(lina)

    decide(client, rouages, body="Carbone.", attendees=[tom.id])

    assert list(attendance(rouages, workday(timezone.now()))) == [lina]
