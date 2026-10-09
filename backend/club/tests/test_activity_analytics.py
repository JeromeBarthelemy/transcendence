import csv
from datetime import date, datetime, time
from io import StringIO
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from club.analytics.activity import _csv_label, summarize_activity
from club.gdpr import anonymize
from club.models import (
    Entry,
    EntryParticipant,
    Membership,
    Season,
    Team,
    TeamSeason,
    User,
    WorkItem,
)

PARIS = ZoneInfo("Europe/Paris")
WEDNESDAY = date(2026, 11, 18)


def at(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=PARIS)


def team_season(number: int = 12345) -> TeamSeason:
    season, _ = Season.objects.get_or_create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=number, name=f"Équipe {number}")
    return TeamSeason.objects.create(team=team, season=season)


def user(name: str, role: str = User.ClubRole.STUDENT) -> User:
    return User.objects.create_user(
        f"{name}@example.org", name, club_role=role, contact_email=f"{name}@example.org"
    )


def member_of(team: TeamSeason, name: str) -> User:
    person = user(name)
    Membership.objects.create(user=person, team_season=team)
    return person


def progress(
    team: TeamSeason,
    item: WorkItem,
    when: datetime,
    author: User,
    *participants: User,
    step: str | None = Entry.Step.BUILDING,
) -> Entry:
    entry = Entry.objects.create(
        team_season=team,
        work_item=item,
        author=author,
        type=Entry.Type.PROGRESS,
        step=step,
        occurred_at=when,
    )
    EntryParticipant.objects.bulk_create(
        [EntryParticipant(entry=entry, user=person) for person in participants]
    )
    return entry


def url(
    team: TeamSeason,
    since: str = "2026-11-18",
    until: str = "2026-11-18",
    representation: str | None = None,
    on_robot: str | None = None,
    report: str | None = None,
) -> str:
    return (
        f"/api/team-seasons/{team.id}/analytics/activity/?since={since}&until={until}"
        + (f"&format={representation}" if representation else "")
        + (f"&on_robot={on_robot}" if on_robot is not None else "")
        + (f"&report={report}" if report is not None else "")
    )


def by_value(rows: list[dict[str, Any]], key: str) -> dict[str, int]:
    return {str(row[key]): int(row["count"]) for row in rows}


@pytest.mark.parametrize("representation", [None, "csv"])
@pytest.mark.parametrize("on_robot", [None, "true", "false"])
def test_only_a_team_member_or_mentor_may_read_activity(
    client, representation, on_robot
):
    rouages = team_season()
    lina = member_of(rouages, "lina")

    path = url(rouages, representation=representation, on_robot=on_robot)
    assert client.get(path).status_code == 403

    client.force_login(member_of(team_season(67890), "tom"))
    response = client.get(path)
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "not_a_member"

    client.force_login(lina)
    assert client.get(path).status_code == 200

    client.force_login(user("paul", User.ClubRole.MENTOR))
    assert client.get(path).status_code == 200


@pytest.mark.parametrize("representation", [None, "csv"])
def test_the_period_is_required_valid_and_ordered(client, representation):
    rouages = team_season()
    client.force_login(member_of(rouages, "lina"))

    query = f"?format={representation}" if representation else ""
    assert client.get(url(rouages).split("?")[0] + query).status_code == 400
    assert (
        client.get(
            url(rouages, since="not-a-day", representation=representation)
        ).status_code
        == 400
    )
    response = client.get(
        url(
            rouages,
            since="2026-11-19",
            until="2026-11-18",
            representation=representation,
        )
    )

    assert response.status_code == 400
    assert response.json()["non_field_errors"][0]["code"] == "period_reversed"


def test_an_empty_team_has_a_complete_zero_snapshot(client):
    rouages = team_season()
    client.force_login(user("paul", User.ClubRole.MENTOR))

    data = client.get(url(rouages)).json()

    assert data["period"] == {"since": "2026-11-18", "until": "2026-11-18"}
    assert set(by_value(data["snapshot"]["work_items_by_status"], "status")) == {
        value for value, _label in WorkItem.Status.choices
    }
    assert all(
        count == 0
        for count in by_value(
            data["snapshot"]["work_items_by_status"], "status"
        ).values()
    )
    assert set(by_value(data["snapshot"]["work_items_by_step"], "step")) == {
        value for value, _label in Entry.Step.choices
    }
    assert data["snapshot"]["work_items_without_progress"] == 0
    assert data["activity_by_day"] == []
    assert data["members"] == []


def test_the_snapshot_uses_current_status_and_latest_progress_step(client):
    rouages = team_season()
    lina = member_of(rouages, "lina")
    WorkItem.objects.create(team_season=rouages, title="sans avancée")
    building = WorkItem.objects.create(
        team_season=rouages, title="intake", status=WorkItem.Status.OPEN
    )
    outreach = WorkItem.objects.create(
        team_season=rouages,
        title="stand",
        status=WorkItem.Status.DONE,
        on_robot=False,
    )
    progress(
        rouages,
        building,
        at(WEDNESDAY, 13),
        lina,
        lina,
        step=Entry.Step.PROTOTYPING,
    )
    progress(rouages, building, at(WEDNESDAY, 14), lina, lina)
    progress(rouages, outreach, at(WEDNESDAY, 15), lina, lina, step=None)
    client.force_login(lina)

    snapshot = client.get(url(rouages)).json()["snapshot"]
    statuses = by_value(snapshot["work_items_by_status"], "status")
    steps = by_value(snapshot["work_items_by_step"], "step")

    assert statuses == {"open": 2, "done": 1, "dropped": 0}
    assert steps["building"] == 1
    assert sum(steps.values()) == 1
    assert snapshot["work_items_without_progress"] == 1


def test_the_period_follows_the_four_am_workday_and_is_inclusive(client):
    rouages = team_season()
    lina = member_of(rouages, "lina")
    item = WorkItem.objects.create(team_season=rouages, title="intake")
    progress(rouages, item, at(WEDNESDAY, 3, 59), lina, lina)
    progress(rouages, item, at(WEDNESDAY, 4), lina, lina)
    progress(rouages, item, at(date(2026, 11, 19), 3, 59), lina, lina)
    progress(rouages, item, at(date(2026, 11, 19), 4), lina, lina)
    client.force_login(lina)

    data = client.get(url(rouages)).json()

    assert data["activity_by_day"] == [
        {"day": "2026-11-18", "progress_entries": 2, "active_members": 1}
    ]
    assert data["members"][0]["active_days"] == 1
    assert data["members"][0]["progress_entries"] == 2


def test_shared_progress_counts_once_for_the_team_and_once_per_participant(client):
    rouages = team_season()
    lina = member_of(rouages, "lina")
    tom = member_of(rouages, "tom")
    item = WorkItem.objects.create(team_season=rouages, title="intake")
    progress(rouages, item, at(WEDNESDAY, 14), lina, lina, tom)
    client.force_login(lina)

    data = client.get(url(rouages)).json()
    members = {row["display_name"]: row for row in data["members"]}

    assert data["activity_by_day"][0]["progress_entries"] == 1
    assert data["activity_by_day"][0]["active_members"] == 2
    assert members["lina"]["progress_entries"] == 1
    assert members["tom"]["progress_entries"] == 1


def test_mentors_do_not_count_as_participating_members(client):
    rouages = team_season()
    lina = member_of(rouages, "lina")
    mentor = user("paul", User.ClubRole.MENTOR)
    item = WorkItem.objects.create(team_season=rouages, title="intake")
    progress(rouages, item, at(WEDNESDAY, 14), mentor, mentor)
    client.force_login(lina)

    data = client.get(url(rouages)).json()

    assert data["activity_by_day"] == [
        {"day": "2026-11-18", "progress_entries": 1, "active_members": 0}
    ]
    assert [member["display_name"] for member in data["members"]] == ["lina"]
    assert data["members"][0]["progress_entries"] == 0


def test_member_counts_are_distinct_and_notes_and_decisions_do_not_count(client):
    rouages = team_season()
    lina = member_of(rouages, "lina")
    intake = WorkItem.objects.create(team_season=rouages, title="intake")
    arm = WorkItem.objects.create(team_season=rouages, title="bras")
    progress(rouages, intake, at(WEDNESDAY, 14), lina, lina)
    progress(rouages, intake, at(WEDNESDAY, 15), lina, lina)
    progress(rouages, arm, at(date(2026, 11, 19), 14), lina, lina)
    for entry_type in (Entry.Type.NOTE, Entry.Type.DECISION):
        entry = Entry.objects.create(
            team_season=rouages,
            author=lina,
            type=entry_type,
            occurred_at=at(WEDNESDAY, 16),
        )
        EntryParticipant.objects.create(entry=entry, user=lina)
    client.force_login(lina)

    data = client.get(url(rouages, until="2026-11-19")).json()
    [member] = data["members"]

    assert member["active_days"] == 2
    assert member["progress_entries"] == 3
    assert member["work_items"] == 2
    assert member["last_progress_day"] == "2026-11-19"
    assert sum(day["progress_entries"] for day in data["activity_by_day"]) == 3


def test_current_former_and_anonymized_participants_remain_distinguishable(client):
    rouages = team_season()
    current = member_of(rouages, "alice")
    former = member_of(rouages, "zoe")
    anonymous = member_of(rouages, "yann")
    item = WorkItem.objects.create(team_season=rouages, title="intake")
    progress(rouages, item, at(WEDNESDAY, 14), former, former)
    progress(rouages, item, at(WEDNESDAY, 15), anonymous, anonymous)
    Membership.objects.filter(user=former, team_season=rouages).delete()
    anonymize(anonymous)
    anonymous.refresh_from_db()
    client.force_login(current)

    members = {
        row["display_name"]: row for row in client.get(url(rouages)).json()["members"]
    }

    assert members["alice"]["is_current_member"] is True
    assert members["zoe"]["is_current_member"] is False
    assert members[f"Ancien membre {anonymous.id}"]["is_current_member"] is False
    assert members[f"Ancien membre {anonymous.id}"]["progress_entries"] == 1


def test_a_suspended_student_is_no_longer_a_current_member(client):
    rouages = team_season()
    current = member_of(rouages, "alice")
    suspended = member_of(rouages, "noe")
    item = WorkItem.objects.create(team_season=rouages, title="intake")
    progress(rouages, item, at(WEDNESDAY, 14), suspended, suspended)
    suspended.is_active = False
    suspended.save()
    client.force_login(current)

    members = {
        row["display_name"]: row for row in client.get(url(rouages)).json()["members"]
    }

    assert members["noe"]["is_current_member"] is False
    assert members["noe"]["progress_entries"] == 1


@pytest.mark.parametrize("on_robot", [None, True, False])
def test_activity_calculation_uses_a_fixed_number_of_queries(
    django_assert_num_queries, on_robot
):
    rouages = team_season()
    author = member_of(rouages, "alice")
    item = WorkItem.objects.create(
        team_season=rouages,
        title="intake",
        on_robot=on_robot if on_robot is not None else True,
    )
    people = [author, *(member_of(rouages, f"member-{index}") for index in range(12))]
    for index, person in enumerate(people):
        progress(rouages, item, at(WEDNESDAY, 10, index), author, person)

    with django_assert_num_queries(5):
        data = summarize_activity(rouages, WEDNESDAY, WEDNESDAY, on_robot=on_robot)

    assert len(data["members"]) == len(people)


def test_csv_download_matches_the_json_chart_and_workday_boundaries(client):
    rouages = team_season()
    lina = member_of(rouages, "lina")
    tom = member_of(rouages, "tom")
    item = WorkItem.objects.create(team_season=rouages, title="intake")
    progress(rouages, item, at(WEDNESDAY, 3, 59), lina, lina)
    progress(rouages, item, at(WEDNESDAY, 14), lina, lina, tom)
    progress(rouages, item, at(date(2026, 11, 19), 3, 59), lina, lina)
    progress(rouages, item, at(date(2026, 11, 19), 14), lina, tom)
    progress(rouages, item, at(date(2026, 11, 20), 4), lina, lina)
    other = team_season(67890)
    progress(
        other,
        WorkItem.objects.create(team_season=other, title="bras"),
        at(WEDNESDAY, 14),
        tom,
        tom,
    )
    client.force_login(lina)

    json_data = client.get(url(rouages, until="2026-11-19")).json()
    response = client.get(url(rouages, until="2026-11-19", representation="csv"))
    rows = list(csv.DictReader(StringIO(response.content.decode("utf-8"))))

    assert response.status_code == 200
    assert response["Content-Type"] == "text/csv; charset=utf-8"
    assert response["Content-Disposition"] == (
        'attachment; filename="activite-12345-2026-11-18-2026-11-19.csv"'
    )
    assert rows == [
        {"day": "2026-11-18", "progress_entries": "2", "active_members": "2"},
        {"day": "2026-11-19", "progress_entries": "1", "active_members": "1"},
    ]
    assert rows == [
        {key: str(value) for key, value in day.items()}
        for day in json_data["activity_by_day"]
    ]


def test_an_empty_period_exports_only_the_csv_header(client):
    rouages = team_season()
    client.force_login(member_of(rouages, "lina"))

    response = client.get(url(rouages, representation="csv"))

    assert response.status_code == 200
    assert response.content == b"day,progress_entries,active_members\r\n"


def test_json_remains_available_and_unknown_export_formats_are_refused(client):
    rouages = team_season()
    client.force_login(member_of(rouages, "lina"))

    assert (
        client.get(url(rouages, representation="json")).json()
        == client.get(url(rouages)).json()
    )
    refused = client.get(url(rouages, representation="pdf"))

    assert refused.status_code == 400
    assert refused.json()["format"][0]["code"] == "invalid_choice"


@pytest.mark.parametrize("on_robot", ["true", "false"])
def test_robot_filter_applies_to_snapshot_participation_daily_chart_and_csv(
    client, on_robot
):
    rouages = team_season()
    lina = member_of(rouages, "lina")
    tom = member_of(rouages, "tom")
    robot = WorkItem.objects.create(team_season=rouages, title="intake", on_robot=True)
    outreach = WorkItem.objects.create(
        team_season=rouages, title="stand", on_robot=False, status=WorkItem.Status.DONE
    )
    WorkItem.objects.create(team_season=rouages, title="bras", on_robot=True)
    WorkItem.objects.create(
        team_season=rouages,
        title="affiche",
        on_robot=False,
        status=WorkItem.Status.DROPPED,
    )
    progress(rouages, robot, at(WEDNESDAY, 14), lina, lina, tom)
    progress(
        rouages, outreach, at(WEDNESDAY, 15), lina, lina, step=Entry.Step.PROTOTYPING
    )
    progress(
        rouages,
        outreach,
        at(date(2026, 11, 19), 3, 59),
        lina,
        lina,
        step=Entry.Step.PROTOTYPING,
    )
    # The snapshot still uses the latest step, even outside the selected period.
    progress(
        rouages, robot, at(date(2026, 11, 19), 14), tom, tom, step=Entry.Step.TUNING
    )
    other = team_season(67890)
    progress(
        other,
        WorkItem.objects.create(team_season=other, title="pince", on_robot=True),
        at(WEDNESDAY, 14),
        tom,
        tom,
    )
    client.force_login(lina)

    data = client.get(url(rouages, on_robot=on_robot)).json()
    response = client.get(url(rouages, representation="csv", on_robot=on_robot))
    rows = list(csv.DictReader(StringIO(response.content.decode())))
    members = {row["display_name"]: row for row in data["members"]}
    robot_selected = on_robot == "true"
    suffix = "robot" if robot_selected else "hors-robot"
    assert data["summary"] == {
        "progress_entries": 1 if robot_selected else 2,
        "active_days": 1,
        "active_members": 2 if robot_selected else 1,
        "work_items": 1,
    }
    assert all(item["on_robot"] == robot_selected for item in data["work_items"])
    assert len(data["work_items"]) == 2
    assert (
        sum(item["progress_entries"] for item in data["work_items"])
        == data["summary"]["progress_entries"]
    )
    assert data["activity_by_week"] == [
        {
            "week_start": "2026-11-16",
            "progress_entries": 1 if robot_selected else 2,
            "active_members": 2 if robot_selected else 1,
            "active_days": 1,
        }
    ]
    assert data["activity_by_category"] == [
        {"on_robot": True, "progress_entries": 1 if robot_selected else 0},
        {"on_robot": False, "progress_entries": 0 if robot_selected else 2},
    ]
    assert response["Content-Disposition"] == (
        f'attachment; filename="activite-12345-2026-11-18-2026-11-18-{suffix}.csv"'
    )

    assert data["activity_by_day"] == [
        {
            "day": "2026-11-18",
            "progress_entries": 1 if robot_selected else 2,
            "active_members": 2 if robot_selected else 1,
        }
    ]
    assert rows == [
        {key: str(value) for key, value in day.items()}
        for day in data["activity_by_day"]
    ]
    assert by_value(data["snapshot"]["work_items_by_status"], "status") == (
        {"open": 2, "done": 0, "dropped": 0}
        if robot_selected
        else {"open": 0, "done": 1, "dropped": 1}
    )
    steps = by_value(data["snapshot"]["work_items_by_step"], "step")
    assert steps["tuning" if robot_selected else "prototyping"] == 1
    assert sum(steps.values()) == 1
    assert data["snapshot"]["work_items_without_progress"] == 1
    assert members["lina"]["progress_entries"] == (1 if robot_selected else 2)
    assert members["lina"]["active_days"] == 1
    assert members["lina"]["work_items"] == 1
    assert members["tom"]["progress_entries"] == (1 if robot_selected else 0)
    assert members["tom"]["is_current_member"] is True
    assert members["tom"]["last_progress_day"] == (
        "2026-11-18" if robot_selected else None
    )
    assert client.get(url(rouages)).json()["activity_by_day"] == [
        {
            "day": "2026-11-18",
            "progress_entries": 3,
            "active_members": 2,
        }
    ]


@pytest.mark.parametrize("representation", [None, "csv"])
def test_filter_with_no_matching_work_returns_an_empty_chart_and_export(
    client, representation
):
    rouages = team_season()
    lina = member_of(rouages, "lina")
    item = WorkItem.objects.create(team_season=rouages, title="intake", on_robot=True)
    progress(rouages, item, at(WEDNESDAY, 14), lina, lina)
    client.force_login(lina)

    response = client.get(url(rouages, representation=representation, on_robot="false"))

    assert response.status_code == 200
    if representation == "csv":
        assert response.content == b"day,progress_entries,active_members\r\n"
    else:
        data = response.json()
        assert data["activity_by_day"] == []
        assert data["members"][0]["progress_entries"] == 0
        assert not any(
            by_value(data["snapshot"]["work_items_by_status"], "status").values()
        )


@pytest.mark.parametrize("representation", [None, "csv"])
@pytest.mark.parametrize("on_robot", ["robot", "null", "2", ""])
def test_invalid_robot_filter_is_refused(client, representation, on_robot):
    rouages = team_season()
    client.force_login(member_of(rouages, "lina"))

    response = client.get(
        url(rouages, representation=representation, on_robot=on_robot)
    )

    assert response.status_code == 400
    assert response.json()["on_robot"][0]["code"] == "invalid"


@pytest.mark.parametrize("on_robot", ["true", "false"])
def test_filter_keeps_only_matching_former_participation_and_all_current_members(
    client, on_robot
):
    rouages = team_season()
    lina = member_of(rouages, "lina")
    for name, side in [("old_robot", True), ("old_outreach", False)]:
        former = member_of(rouages, name)
        item = WorkItem.objects.create(team_season=rouages, title=name, on_robot=side)
        progress(rouages, item, at(WEDNESDAY, 14), former, former)
        Membership.objects.filter(user=former, team_season=rouages).delete()
    client.force_login(lina)

    data = client.get(url(rouages, on_robot=on_robot)).json()
    members = {row["display_name"]: row for row in data["members"]}
    selected_name = "old_robot" if on_robot == "true" else "old_outreach"

    assert set(members) == {"lina", selected_name}
    assert members["lina"]["is_current_member"] is True
    assert members["lina"]["progress_entries"] == 0
    assert members[selected_name]["is_current_member"] is False
    assert members[selected_name]["progress_entries"] == 1


def test_period_summary_and_weeks_count_distinct_students_not_daily_sums(client):
    team = team_season()
    lina = member_of(team, "lina")
    tom = member_of(team, "tom")
    mentor = user("mentor", User.ClubRole.MENTOR)
    robot = WorkItem.objects.create(team_season=team, title="bras", on_robot=True)
    outreach = WorkItem.objects.create(team_season=team, title="stand", on_robot=False)
    untouched = WorkItem.objects.create(team_season=team, title="pince", on_robot=True)
    progress(team, robot, at(WEDNESDAY, 14), lina, lina, tom, mentor)
    progress(team, robot, at(date(2026, 11, 19), 14), lina, lina)
    # Monday before 04:00 belongs to Sunday, hence the previous week.
    progress(team, outreach, at(date(2026, 11, 23), 3, 59), tom, tom)
    progress(team, robot, at(date(2026, 11, 23), 4), lina, lina)
    # The current step may be newer than the last progress in this report.
    progress(
        team, robot, at(date(2026, 11, 24), 14), lina, lina, step=Entry.Step.TUNING
    )
    client.force_login(lina)

    data = client.get(url(team, since="2026-11-18", until="2026-11-23")).json()

    assert data["summary"] == {
        "progress_entries": 4,
        "active_days": 4,
        "active_members": 2,
        "work_items": 2,
    }
    assert data["activity_by_week"] == [
        {
            "week_start": "2026-11-16",
            "progress_entries": 3,
            "active_members": 2,
            "active_days": 3,
        },
        {
            "week_start": "2026-11-23",
            "progress_entries": 1,
            "active_members": 1,
            "active_days": 1,
        },
    ]
    assert data["activity_by_category"] == [
        {"on_robot": True, "progress_entries": 3},
        {"on_robot": False, "progress_entries": 1},
    ]
    items = {row["id"]: row for row in data["work_items"]}
    assert items[robot.id] == {
        "id": robot.id,
        "title": "bras",
        "on_robot": True,
        "status": "open",
        "current_step": "tuning",
        "progress_entries": 3,
        "active_days": 3,
        "active_members": 2,
        "last_progress_day": "2026-11-23",
    }
    assert items[outreach.id]["last_progress_day"] == "2026-11-22"
    assert items[untouched.id]["progress_entries"] == 0
    assert items[untouched.id]["active_members"] == 0
    assert items[untouched.id]["last_progress_day"] is None


@pytest.mark.parametrize("side", [None, "true", "false"])
def test_full_report_csv_matches_all_json_sections_and_scope(client, side):
    team = team_season()
    lina = member_of(team, "lina")
    for name, on_robot in [("bras", True), ("stand", False)]:
        item = WorkItem.objects.create(team_season=team, title=name, on_robot=on_robot)
        progress(team, item, at(WEDNESDAY, 14), lina, lina)
    client.force_login(lina)
    data = client.get(url(team, on_robot=side)).json()
    response = client.get(url(team, on_robot=side, representation="csv", report="full"))
    rows = list(csv.DictReader(StringIO(response.content.decode())))
    scope = "all" if side is None else "robot" if side == "true" else "off_robot"

    assert response.status_code == 200
    assert response["Content-Disposition"].endswith('-complet.csv"')
    assert all(
        row["since"] == "2026-11-18"
        and row["until"] == "2026-11-18"
        and row["scope"] == scope
        for row in rows
    )
    sections = {
        key: [row for row in rows if row["section"] == key]
        for key in {row["section"] for row in rows}
    }
    assert set(sections) == {
        "summary",
        "day",
        "week",
        "category",
        "work_item",
        "member",
        "status",
        "step",
        "snapshot",
    }
    assert {key: int(sections["summary"][0][key]) for key in data["summary"]} == data[
        "summary"
    ]
    assert [
        {
            "day": row["date"],
            "progress_entries": int(row["progress_entries"]),
            "active_members": int(row["active_members"]),
        }
        for row in sections["day"]
    ] == data["activity_by_day"]
    assert [
        {
            "week_start": row["date"],
            "progress_entries": int(row["progress_entries"]),
            "active_members": int(row["active_members"]),
            "active_days": int(row["active_days"]),
        }
        for row in sections["week"]
    ] == data["activity_by_week"]
    assert [
        {
            "on_robot": row["on_robot"] == "true",
            "progress_entries": int(row["progress_entries"]),
        }
        for row in sections["category"]
    ] == data["activity_by_category"]
    assert len(sections["work_item"]) == len(data["work_items"])
    for row, item in zip(sections["work_item"], data["work_items"], strict=True):
        assert int(row["id"]) == item["id"]
        assert row["label"] == item["title"]
        assert row["status"] == item["status"]
        assert row["step"] == item["current_step"]
        assert row["on_robot"] == str(item["on_robot"]).lower()
        for key in ("progress_entries", "active_members", "active_days"):
            assert int(row[key]) == item[key]
        assert row["last_progress_day"] == item["last_progress_day"]
    for row, member in zip(sections["member"], data["members"], strict=True):
        assert row["label"] == member["display_name"]
        for key in ("progress_entries", "active_days", "work_items"):
            assert int(row[key]) == member[key]
    assert by_value(sections["status"], "status") == by_value(
        data["snapshot"]["work_items_by_status"], "status"
    )
    assert by_value(sections["step"], "step") == by_value(
        data["snapshot"]["work_items_by_step"], "step"
    )
    assert (
        int(sections["snapshot"][0]["count"])
        == data["snapshot"]["work_items_without_progress"]
    )


def test_empty_period_full_report_keeps_zero_summary_roster_and_work_items(client):
    team = team_season()
    lina = member_of(team, "lina")
    WorkItem.objects.create(team_season=team, title="bras", on_robot=True)
    client.force_login(lina)
    data = client.get(url(team)).json()
    assert data["summary"] == {
        "progress_entries": 0,
        "active_days": 0,
        "active_members": 0,
        "work_items": 0,
    }
    assert data["activity_by_week"] == []
    rows = list(
        csv.DictReader(
            StringIO(
                client.get(
                    url(team, representation="csv", report="full")
                ).content.decode()
            )
        )
    )
    assert not any(row["section"] in {"day", "week"} for row in rows)
    assert (
        next(row for row in rows if row["section"] == "work_item")["progress_entries"]
        == "0"
    )
    assert (
        next(row for row in rows if row["section"] == "member")["progress_entries"]
        == "0"
    )


def test_full_csv_neutralizes_user_titles_that_spreadsheets_could_execute(client):
    team = team_season()
    client.force_login(member_of(team, "lina"))
    WorkItem.objects.create(
        team_season=team, title='=HYPERLINK("https://example.org")', on_robot=True
    )
    response = client.get(url(team, representation="csv", report="full"))
    row = next(
        row
        for row in csv.DictReader(StringIO(response.content.decode()))
        if row["section"] == "work_item"
    )
    assert row["label"].startswith("'=HYPERLINK")


@pytest.mark.parametrize(
    "label", ["=SUM(1,2)", "+cmd", "-cmd", "@cmd", "  =cmd", "\tcmd", "\ncmd", "\rcmd"]
)
def test_csv_labels_are_not_evaluated_as_formulas(label):
    assert _csv_label(label) == "'" + label
    assert _csv_label("Bras") == "Bras"


@pytest.mark.parametrize("representation", [None, "csv"])
def test_unknown_report_is_refused(client, representation):
    team = team_season()
    client.force_login(member_of(team, "lina"))
    response = client.get(url(team, representation=representation, report="unknown"))
    assert response.status_code == 400
    assert response.json()["report"][0]["code"] == "invalid_choice"
