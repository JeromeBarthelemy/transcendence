from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.test import Client

from club.api.serializers import OpenWorkItemSerializer
from club.models import (
    Entry,
    EntryParticipant,
    Membership,
    Season,
    Team,
    TeamSeason,
    User,
    WorkItem,
    WorkshopSlot,
)
from club.progress import record_progress
from club.workdays import workday

from .races import overtaken_by


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


def names(members):
    return [member["display_name"] for member in members]


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
    intake = WorkItem.objects.create(team_season=rouages, title="intake", on_robot=True)
    progress = record_progress(
        intake,
        lina,
        "Rouleaux imprimés.",
        step=Entry.Step.PROTOTYPING,
        handover="Essayer les galets.",
    )
    WorkItem.objects.create(team_season=team_season(67890), title="châssis")
    client.force_login(lina)

    [item] = client.get(url(rouages)).json()

    assert item["title"] == "intake"
    assert item["team_season"] == rouages.id
    assert item["on_robot"] is True
    assert item["status"] == "open"
    assert item["current_step"] == "prototyping"
    assert item["handover"]["body"] == "Essayer les galets."
    assert item["handover"]["author"] == "lina"
    # Left at another step than the current one, the screen can flag it stale.
    assert item["handover"]["step"] == "prototyping"
    assert item["handover"]["day"] == str(workday(progress.occurred_at))
    assert item["last_progress"]["day"] == str(workday(progress.occurred_at))
    assert names(item["last_progress"]["participants"]) == ["lina"]


def test_a_work_item_nobody_worked_on_has_no_last_progress(client):
    rouages = team_season()
    WorkItem.objects.create(team_season=rouages, title="lanceur")
    client.force_login(member_of(rouages))

    [item] = client.get(url(rouages)).json()

    assert item["current_step"] is None
    assert item["last_progress"] is None
    assert item["handover"] is None


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


def test_a_work_item_cannot_be_listed_without_being_opened(client):
    # Suggestions live in the screen, not in the database: opening a work item
    # is starting on it, whatever else the request carries.
    rouages = team_season()
    client.force_login(member_of(rouages))

    client.post(url(rouages), {"title": "lanceur", "on_robot": True, "suggested": True})

    lanceur = WorkItem.objects.get(team_season=rouages, title="lanceur")
    assert lanceur.status == WorkItem.Status.OPEN
    assert lanceur.opened_at is not None


def test_a_taken_title_is_refused_with_a_code(client):
    rouages = team_season()
    WorkItem.objects.create(team_season=rouages, title="Dossier de sponsoring")
    client.force_login(member_of(rouages))

    response = client.post(url(rouages), {"title": "dossier de  sponsoring"})

    assert response.status_code == 400
    assert response.json()["title"][0]["code"] == "work_item_title_taken"


def test_of_two_simultaneous_openings_of_one_title_the_second_is_refused(
    client, monkeypatch
):
    rouages = team_season()
    client.force_login(member_of(rouages, "lina"))
    tom = Client()
    tom.force_login(member_of(rouages, "tom"))
    rival = overtaken_by(
        monkeypatch,
        OpenWorkItemSerializer,
        lambda: tom.post(url(rouages), {"title": "Intake"}),
    )

    response = client.post(url(rouages), {"title": "intake"})

    assert rival == [201]
    assert response.status_code == 400
    assert response.json()["title"][0]["code"] == "work_item_title_taken"
    assert rouages.work_items.count() == 1


def test_a_student_cannot_open_a_work_item_in_another_team(client):
    rouages = team_season(12345)
    client.force_login(member_of(team_season(67890)))

    response = client.post(url(rouages), {"title": "intake"})

    assert response.status_code == 403
    assert not WorkItem.objects.exists()


# --- one work item ---


def detail(item):
    return f"/api/work-items/{item.id}/"


def test_a_work_item_comes_with_its_thread_newest_first(client):
    rouages = team_season()
    lina = member_of(rouages)
    intake = WorkItem.objects.create(team_season=rouages, title="intake", on_robot=True)
    record_progress(intake, lina, "Maquette carton.")
    record_progress(
        intake,
        lina,
        "Rouleaux imprimés.",
        step=Entry.Step.PROTOTYPING,
        handover="Tester à 12 V.",
    )
    Entry.objects.create(
        team_season=rouages,
        author=lina,
        work_item=intake,
        type=Entry.Type.NOTE,
        body="Le câblage du bras est à refaire.",
    )
    client.force_login(lina)

    item = client.get(detail(intake)).json()

    assert item["title"] == "intake"
    assert item["team_season"] == rouages.id
    assert item["current_progress"]["body"] == "Rouleaux imprimés."
    assert item["current_user_participates"] is True
    assert [entry["type"] for entry in item["thread"]] == [
        "note",
        "progress",
        "progress",
    ]
    newest_progress = item["thread"][1]
    assert newest_progress["body"] == "Rouleaux imprimés."
    assert newest_progress["step"] == "prototyping"
    assert newest_progress["author"] == "lina"
    assert names(newest_progress["participants"]) == ["lina"]
    assert newest_progress["handover"] == "Tester à 12 V."


def test_a_work_item_says_when_the_reader_has_not_joined_todays_progress(client):
    rouages = team_season()
    lina = member_of(rouages, "lina")
    tom = member_of(rouages, "tom")
    intake = WorkItem.objects.create(team_season=rouages, title="intake")
    progress = record_progress(intake, lina, "Maquette carton.")
    client.force_login(tom)

    item = client.get(detail(intake)).json()

    assert item["current_progress"]["id"] == progress.id
    assert item["current_user_participates"] is False


def test_a_work_item_of_another_team_is_refused(client):
    intake = WorkItem.objects.create(team_season=team_season(12345), title="intake")
    client.force_login(member_of(team_season(67890)))

    assert client.get(detail(intake)).status_code == 403


def test_an_unknown_work_item_is_not_found(client):
    client.force_login(mentor())

    assert client.get("/api/work-items/999/").status_code == 404


def test_a_member_closes_a_work_item(client):
    rouages = team_season()
    intake = WorkItem.objects.create(team_season=rouages, title="intake")
    client.force_login(member_of(rouages))

    client.patch(detail(intake), {"status": "dropped"}, content_type="application/json")

    intake.refresh_from_db()
    assert intake.status == WorkItem.Status.DROPPED
    assert intake.closed_at is not None


def test_a_robot_work_item_cannot_be_finished(client):
    rouages = team_season()
    intake = WorkItem.objects.create(team_season=rouages, title="intake", on_robot=True)
    client.force_login(member_of(rouages))

    response = client.patch(
        detail(intake), {"status": "done"}, content_type="application/json"
    )

    assert response.status_code == 400
    assert response.json()["status"][0]["code"] == "done_on_robot"
    intake.refresh_from_db()
    assert intake.status == WorkItem.Status.OPEN


def test_a_robot_work_item_can_be_dropped(client):
    rouages = team_season()
    intake = WorkItem.objects.create(team_season=rouages, title="intake", on_robot=True)
    client.force_login(member_of(rouages))

    response = client.patch(
        detail(intake), {"status": "dropped"}, content_type="application/json"
    )

    assert response.status_code == 200
    intake.refresh_from_db()
    assert intake.status == WorkItem.Status.DROPPED


def test_an_off_robot_work_item_can_be_finished(client):
    rouages = team_season()
    sponsoring = WorkItem.objects.create(team_season=rouages, title="sponsoring")
    client.force_login(member_of(rouages))

    response = client.patch(
        detail(sponsoring), {"status": "done"}, content_type="application/json"
    )

    assert response.status_code == 200
    sponsoring.refresh_from_db()
    assert sponsoring.status == WorkItem.Status.DONE


def test_a_work_item_is_not_reopened_by_hand(client):
    # Working on it again reopens it; there is no other way.
    rouages = team_season()
    intake = WorkItem.objects.create(
        team_season=rouages, title="intake", status=WorkItem.Status.DONE
    )
    client.force_login(member_of(rouages))

    response = client.patch(
        detail(intake), {"status": "open"}, content_type="application/json"
    )

    assert response.status_code == 400
    intake.refresh_from_db()
    assert intake.status == WorkItem.Status.DONE


def test_a_student_cannot_change_another_teams_work_item(client):
    intake = WorkItem.objects.create(team_season=team_season(12345), title="intake")
    client.force_login(member_of(team_season(67890)))

    response = client.patch(
        detail(intake), {"status": "done"}, content_type="application/json"
    )

    assert response.status_code == 403
    intake.refresh_from_db()
    assert intake.status == WorkItem.Status.OPEN


# --- ticking a work item ---


def tick(client, item, **body):
    return client.post(
        f"/api/work-items/{item.id}/tick/", body, content_type="application/json"
    )


def robot_work_item(team):
    return WorkItem.objects.create(team_season=team, title="intake", on_robot=True)


def test_the_first_tick_of_the_day_creates_the_progress(client):
    rouages = team_season()
    intake = robot_work_item(rouages)
    client.force_login(member_of(rouages))

    response = tick(client, intake)

    assert response.status_code == 201
    assert names(response.json()["participants"]) == ["lina"]


def test_a_second_member_ticking_joins_the_progress_of_the_day(client):
    rouages = team_season()
    intake = robot_work_item(rouages)
    client.force_login(member_of(rouages, "lina"))
    tick(client, intake)
    client.force_login(member_of(rouages, "tom"))

    response = tick(client, intake)

    assert response.status_code == 200
    assert names(response.json()["participants"]) == ["lina", "tom"]
    assert intake.entries.count() == 1


def with_avatar(user):
    user.avatar.name = "avatars/lina.webp"
    user.save(update_fields=["avatar"])
    return user


def test_a_participant_is_listed_with_their_avatar(client):
    rouages = team_season()
    intake = robot_work_item(rouages)
    lina = with_avatar(member_of(rouages))
    client.force_login(lina)

    response = tick(client, intake)

    assert response.json()["participants"] == [
        {"display_name": "lina", "avatar": f"/api/users/{lina.pk}/avatar/"}
    ]


def test_ticking_twice_signs_up_once(client):
    rouages = team_season()
    intake = robot_work_item(rouages)
    client.force_login(member_of(rouages))
    tick(client, intake)

    response = tick(client, intake)

    assert names(response.json()["participants"]) == ["lina"]
    assert intake.entries.count() == 1


def test_a_mentor_who_ticks_is_signed_up(client):
    rouages = team_season()
    intake = robot_work_item(rouages)
    client.force_login(mentor())

    assert names(tick(client, intake).json()["participants"]) == ["paul"]


def test_ticking_at_another_step_opens_a_second_progress(client):
    # Prototyping in the morning, building in the afternoon: two progress.
    rouages = team_season()
    intake = robot_work_item(rouages)
    client.force_login(member_of(rouages))
    tick(client, intake)

    response = tick(client, intake, step="building")

    assert response.status_code == 201
    assert response.json()["step"] == "building"
    assert intake.entries.count() == 2


def test_a_step_off_the_robot_is_refused_with_its_code(client):
    rouages = team_season()
    sponsoring = WorkItem.objects.create(team_season=rouages, title="sponsoring")
    client.force_login(member_of(rouages))

    response = tick(client, sponsoring, step="building")

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "step_off_robot"


def test_a_student_cannot_tick_another_teams_work_item(client):
    intake = robot_work_item(team_season(12345))
    client.force_login(member_of(team_season(67890)))

    assert tick(client, intake).status_code == 403
    assert not intake.entries.exists()


# --- writing a progress ---


def write(client, entry, **body):
    return client.patch(
        f"/api/entries/{entry.id}/", body, content_type="application/json"
    )


def test_a_participant_writes_the_progress(client):
    rouages = team_season()
    lina = member_of(rouages)
    entry = record_progress(robot_work_item(rouages), lina, "")
    client.force_login(lina)

    response = write(
        client,
        entry,
        body="Galets montés.",
        step="building",
        handover="Ne pas resserrer la courroie.",
    )

    assert response.status_code == 200
    entry.refresh_from_db()
    assert entry.body == "Galets montés."
    assert entry.step == Entry.Step.BUILDING
    assert entry.handover == "Ne pas resserrer la courroie."


def test_a_student_who_did_not_take_part_cannot_write_it(client):
    rouages = team_season()
    entry = record_progress(robot_work_item(rouages), member_of(rouages, "lina"), "")
    client.force_login(member_of(rouages, "tom"))

    response = write(client, entry, body="Pas moi.")

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "edit_not_participant"


def test_a_note_is_not_written_as_a_progress(client):
    rouages = team_season()
    lina = member_of(rouages)
    note = Entry.objects.create(team_season=rouages, author=lina, type=Entry.Type.NOTE)
    client.force_login(lina)

    response = write(client, note, body="Perceuse HS.")

    assert response.json()["detail"]["code"] == "edit_not_progress"


def test_a_student_cannot_write_another_teams_progress(client):
    other = team_season(67890)
    entry = record_progress(robot_work_item(other), member_of(other, "sam"), "")
    client.force_login(member_of(team_season(12345)))

    assert write(client, entry, body="Pas chez moi.").status_code == 403


# --- notes ---


def note(client, team, **body):
    return client.post(
        f"/api/team-seasons/{team.id}/notes/", body, content_type="application/json"
    )


def test_a_member_writes_a_note_for_the_team(client):
    rouages = team_season()
    client.force_login(member_of(rouages))

    response = note(client, rouages, body="Perceuse HS, à remplacer avant vendredi.")

    assert response.status_code == 201
    written = Entry.objects.get()
    assert written.type == Entry.Type.NOTE
    assert written.team_season == rouages
    assert written.author.display_name == "lina"
    assert written.work_item is None


def test_a_note_addressed_to_a_work_item_waits_in_its_thread(client):
    rouages = team_season()
    bras = WorkItem.objects.create(team_season=rouages, title="bras", on_robot=True)
    client.force_login(member_of(rouages))

    note(client, rouages, body="Le câblage est à refaire.", work_item=bras.id)

    [waiting] = client.get(f"/api/work-items/{bras.id}/").json()["thread"]
    assert waiting["type"] == "note"
    assert waiting["body"] == "Le câblage est à refaire."


def test_a_note_cannot_be_addressed_to_another_teams_work_item(client):
    rouages = team_season(12345)
    theirs = WorkItem.objects.create(team_season=team_season(67890), title="bras")
    client.force_login(member_of(rouages))

    response = note(client, rouages, body="Câblage.", work_item=theirs.id)

    assert response.status_code == 400
    assert response.json()["work_item"][0]["code"] == "work_item_not_in_team"
    assert not Entry.objects.exists()


def test_an_empty_note_is_refused(client):
    rouages = team_season()
    client.force_login(member_of(rouages))

    assert note(client, rouages, body="").status_code == 400


def test_a_student_cannot_write_a_note_in_another_team(client):
    rouages = team_season(12345)
    client.force_login(member_of(team_season(67890)))

    assert note(client, rouages, body="Coucou.").status_code == 403
    assert not Entry.objects.exists()


# --- the day and its gaps ---

PARIS = ZoneInfo("Europe/Paris")
# Early in the 2026 season, so already past whenever the tests run.
WEDNESDAY = date(2026, 9, 9)


def progress_on(team, day, *participants):
    intake, _ = WorkItem.objects.get_or_create(team_season=team, title="intake")
    entry = Entry.objects.create(
        team_season=team,
        author=participants[0],
        work_item=intake,
        type=Entry.Type.PROGRESS,
        occurred_at=datetime.combine(day, time(15), tzinfo=PARIS),
    )
    for user in participants:
        EntryParticipant.objects.create(entry=entry, user=user)
    return entry


def test_a_day_shows_its_entries_and_who_was_there_out_of_the_roster(client):
    rouages = team_season()
    lina, tom = member_of(rouages, "lina"), member_of(rouages, "tom")
    member_of(rouages, "sam")
    member_of(rouages, "paul", User.ClubRole.MENTOR)
    progress_on(rouages, WEDNESDAY, lina, tom)
    client.force_login(lina)

    day = client.get(f"/api/team-seasons/{rouages.id}/days/2026-09-09/").json()

    assert len(day["entries"]) == 1
    assert names(day["present"]) == ["lina", "tom"]
    # The roster counts students: mentors supervise, they are not the team.
    assert day["roster"] == 3
    assert day["advanced_work_items"] == 1


def test_today_means_the_current_club_workday(client, monkeypatch):
    rouages = team_season()
    lina = member_of(rouages)
    progress_on(rouages, WEDNESDAY, lina)
    after_midnight = datetime.combine(
        WEDNESDAY + timedelta(days=1), time(1), tzinfo=PARIS
    )
    monkeypatch.setattr("club.api.views.timezone.now", lambda: after_midnight)
    client.force_login(lina)

    day = client.get(f"/api/team-seasons/{rouages.id}/days/today/").json()

    assert day["day"] == str(WEDNESDAY)
    assert len(day["entries"]) == 1


def test_a_day_counts_distinct_work_items_advanced(client):
    rouages = team_season()
    lina = member_of(rouages)
    progress_on(rouages, WEDNESDAY, lina)
    progress_on(rouages, WEDNESDAY, lina)
    client.force_login(lina)

    day = client.get(f"/api/team-seasons/{rouages.id}/days/2026-09-09/").json()

    assert len(day["entries"]) == 2
    assert day["advanced_work_items"] == 1


def test_who_was_there_is_listed_with_their_avatars(client):
    rouages = team_season()
    lina, tom = with_avatar(member_of(rouages, "lina")), member_of(rouages, "tom")
    progress_on(rouages, WEDNESDAY, lina, tom)
    client.force_login(lina)

    day = client.get(f"/api/team-seasons/{rouages.id}/days/2026-09-09/").json()

    assert day["present"] == [
        {"display_name": "lina", "avatar": f"/api/users/{lina.pk}/avatar/"},
        {"display_name": "tom", "avatar": None},
    ]


def test_an_unreadable_day_is_refused(client):
    rouages = team_season()
    client.force_login(member_of(rouages))

    response = client.get(f"/api/team-seasons/{rouages.id}/days/mercredi/")

    assert response.status_code == 400


def test_the_gaps_are_the_slot_days_nothing_moved(client):
    rouages = team_season()
    lina = member_of(rouages)
    WorkshopSlot.objects.create(
        season=rouages.season,
        weekday=WorkshopSlot.Weekday.WEDNESDAY,
        start_time=time(14),
        valid_from=date(2026, 9, 1),
    )
    progress_on(rouages, WEDNESDAY, lina)
    client.force_login(lina)

    response = client.get(
        f"/api/team-seasons/{rouages.id}/gaps/?since=2026-09-01&until=2026-09-20"
    )

    assert response.json() == ["2026-09-02", "2026-09-16"]


def test_gaps_need_a_period(client):
    rouages = team_season()
    client.force_login(member_of(rouages))

    assert client.get(f"/api/team-seasons/{rouages.id}/gaps/").status_code == 400


def test_a_student_cannot_read_another_teams_day(client):
    rouages = team_season(12345)
    client.force_login(member_of(team_season(67890)))

    response = client.get(f"/api/team-seasons/{rouages.id}/days/2026-09-09/")

    assert response.status_code == 403


# --- what the screens show ---


def day_of(client, team, day):
    return client.get(f"/api/team-seasons/{team.id}/days/{day.isoformat()}/").json()


def test_each_entry_of_a_day_names_its_work_item(client):
    rouages = team_season()
    lina = member_of(rouages)
    progress = progress_on(rouages, WEDNESDAY, lina)
    Entry.objects.create(
        team_season=rouages,
        author=lina,
        type=Entry.Type.NOTE,
        body="Foret de 4 cassé.",
        occurred_at=datetime.combine(WEDNESDAY, time(16), tzinfo=PARIS),
    )
    client.force_login(lina)

    entries = day_of(client, rouages, WEDNESDAY)["entries"]

    assert [entry["work_item"] for entry in entries] == [
        None,
        {"id": progress.work_item_id, "title": "intake"},
    ]


def test_a_work_item_says_when_it_was_opened(client):
    rouages = team_season()
    client.force_login(member_of(rouages))
    client.post(url(rouages), {"title": "intake", "on_robot": True})

    [listed] = client.get(url(rouages)).json()

    intake = WorkItem.objects.get(team_season=rouages, title="intake")
    assert listed["opened_at"] == intake.opened_at.isoformat().replace("+00:00", "Z")


def test_a_day_points_to_the_last_and_next_days_the_team_left_a_trace(client):
    rouages = team_season()
    lina = member_of(rouages)
    for day in (date(2026, 9, 4), WEDNESDAY, date(2026, 9, 16)):
        progress_on(rouages, day, lina)
    client.force_login(lina)

    day = day_of(client, rouages, WEDNESDAY)

    # Friday the 11th left nothing, so the next day is the Wednesday after.
    assert (day["previous"], day["next"]) == ("2026-09-04", "2026-09-16")


def test_a_trace_left_after_midnight_belongs_to_the_day_before(client):
    rouages = team_season()
    lina = member_of(rouages)
    progress_on(rouages, WEDNESDAY, lina)
    Entry.objects.create(
        team_season=rouages,
        author=lina,
        type=Entry.Type.NOTE,
        occurred_at=datetime(2026, 9, 12, 1, 0, tzinfo=PARIS),
    )
    client.force_login(lina)

    assert day_of(client, rouages, WEDNESDAY)["next"] == "2026-09-11"


def test_a_day_with_no_trace_before_or_after_points_nowhere(client):
    rouages = team_season(12345)
    lina = member_of(rouages)
    progress_on(rouages, WEDNESDAY, lina)
    court_circuit = team_season(67890)
    progress_on(court_circuit, date(2026, 9, 4), member_of(court_circuit, "hugo"))
    client.force_login(lina)

    day = day_of(client, rouages, WEDNESDAY)

    # Another team's Friday is not this team's.
    assert (day["previous"], day["next"]) == (None, None)
