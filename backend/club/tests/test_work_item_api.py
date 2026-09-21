from club.models import Entry, Membership, Season, Team, TeamSeason, User, WorkItem
from club.progress import record_progress


def team_season(number=12345):
    season, _ = Season.objects.get_or_create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=number, name=f"Équipe {number}")
    return TeamSeason.objects.create(team=team, season=season)


def member_of(team_season, name="lina", role=User.ClubRole.STUDENT):
    user = User.objects.create_user(f"{name}@example.org", name, club_role=role)
    Membership.objects.create(user=user, team_season=team_season)
    return user


def mentor(name="paul"):
    return User.objects.create_user(
        f"{name}@example.org", name, club_role=User.ClubRole.MENTOR
    )


def url(team_season):
    return f"/api/team-seasons/{team_season.id}/work-items/"


# --- who may act on a team ---


def test_an_anonymous_caller_is_refused(client):
    assert client.get(url(team_season())).status_code == 403


def test_a_student_of_another_team_is_refused(client):
    rouages = team_season(12345)
    client.force_login(member_of(team_season(67890)))

    response = client.get(url(rouages))

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "not_a_member"


def test_an_unknown_team_season_is_not_found(client):
    client.force_login(mentor())

    assert client.get("/api/team-seasons/999/work-items/").status_code == 404


def test_a_mentor_steps_in_on_a_team_that_is_not_theirs(client):
    rouages = team_season(12345)
    client.force_login(mentor())

    assert client.get(url(rouages)).status_code == 200


# --- listing a team's work items ---


def test_a_member_lists_the_work_items_of_their_team(client):
    rouages = team_season(12345)
    lina = member_of(rouages)
    intake = WorkItem.objects.create(
        team_season=rouages, title="intake", on_robot=True, handover="galets"
    )
    record_progress(intake, lina, "Rouleaux imprimés.", step=Entry.Step.PROTOTYPING)
    WorkItem.objects.create(team_season=team_season(67890), title="châssis")
    client.force_login(lina)

    [item] = client.get(url(rouages)).json()

    assert item["title"] == "intake"
    assert item["on_robot"] is True
    assert item["status"] == "open"
    assert item["current_step"] == "prototyping"
    assert item["handover"] == "galets"
    assert item["last_progress"]["participants"] == ["lina"]


def test_a_work_item_nobody_worked_on_has_no_last_progress(client):
    rouages = team_season()
    WorkItem.objects.create(
        team_season=rouages, title="lanceur", status=WorkItem.Status.SUGGESTED
    )
    client.force_login(member_of(rouages))

    [item] = client.get(url(rouages)).json()

    assert item["current_step"] is None
    assert item["last_progress"] is None


# --- opening a work item ---


def test_a_member_opens_a_work_item(client):
    rouages = team_season()
    client.force_login(member_of(rouages))

    response = client.post(url(rouages), {"title": "intake", "on_robot": True})

    assert response.status_code == 201
    intake = WorkItem.objects.get(team_season=rouages, title="intake")
    assert intake.on_robot
    assert intake.status == WorkItem.Status.OPEN
    assert intake.opened_at is not None


def test_a_work_item_listed_in_september_is_suggested_not_opened(client):
    rouages = team_season()
    client.force_login(member_of(rouages))

    client.post(url(rouages), {"title": "lanceur", "on_robot": True, "suggested": True})

    lanceur = WorkItem.objects.get(team_season=rouages, title="lanceur")
    assert lanceur.status == WorkItem.Status.SUGGESTED
    assert lanceur.opened_at is None


def test_a_taken_title_is_refused_with_a_code(client):
    rouages = team_season()
    WorkItem.objects.create(team_season=rouages, title="Dossier de sponsoring")
    client.force_login(member_of(rouages))

    response = client.post(url(rouages), {"title": "dossier de  sponsoring"})

    assert response.status_code == 400
    assert response.json()["title"][0]["code"] == "work_item_title_taken"


def test_a_student_cannot_open_a_work_item_in_another_team(client):
    rouages = team_season(12345)
    client.force_login(member_of(team_season(67890)))

    response = client.post(url(rouages), {"title": "intake"})

    assert response.status_code == 403
    assert not WorkItem.objects.exists()
