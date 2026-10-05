from datetime import date, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

from club.analytics.activity import summarize_activity
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


def url(team: TeamSeason, since: str = "2026-11-18", until: str = "2026-11-18") -> str:
    return (
        f"/api/team-seasons/{team.id}/analytics/activity/?since={since}&until={until}"
    )


def by_value(rows: list[dict[str, Any]], key: str) -> dict[str, int]:
    return {str(row[key]): int(row["count"]) for row in rows}


def test_only_a_team_member_or_mentor_may_read_activity(client):
    rouages = team_season()
    lina = member_of(rouages, "lina")

    assert client.get(url(rouages)).status_code == 403

    client.force_login(member_of(team_season(67890), "tom"))
    response = client.get(url(rouages))
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "not_a_member"

    client.force_login(lina)
    assert client.get(url(rouages)).status_code == 200

    client.force_login(user("paul", User.ClubRole.MENTOR))
    assert client.get(url(rouages)).status_code == 200


def test_the_period_is_required_valid_and_ordered(client):
    rouages = team_season()
    client.force_login(member_of(rouages, "lina"))

    assert client.get(url(rouages).split("?")[0]).status_code == 400
    assert client.get(url(rouages, since="not-a-day")).status_code == 400
    response = client.get(url(rouages, since="2026-11-19", until="2026-11-18"))

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


def test_activity_calculation_uses_a_fixed_number_of_queries(
    django_assert_num_queries,
):
    rouages = team_season()
    author = member_of(rouages, "alice")
    item = WorkItem.objects.create(team_season=rouages, title="intake")
    people = [author, *(member_of(rouages, f"member-{index}") for index in range(12))]
    for index, person in enumerate(people):
        progress(rouages, item, at(WEDNESDAY, 10, index), author, person)

    with django_assert_num_queries(5):
        data = summarize_activity(rouages, WEDNESDAY, WEDNESDAY)

    assert len(data["members"]) == len(people)
