from datetime import date, datetime, time
from zoneinfo import ZoneInfo

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
NOVEMBER = date(2026, 11, 18)


def at(day, hour=18):
    return datetime.combine(day, time(hour), tzinfo=PARIS)


def team_season(number=1796):
    season, _ = Season.objects.get_or_create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=number, name=f"Équipe {number}")
    return TeamSeason.objects.create(team=team, season=season)


def member(name, team=None, role=User.ClubRole.STUDENT):
    user = User.objects.create_user(f"{name}@example.org", name, club_role=role)
    if team is not None:
        Membership.objects.create(user=user, team_season=team)
    return user


def work_item(team, title, on_robot=True):
    return WorkItem.objects.create(team_season=team, title=title, on_robot=on_robot)


def trace(team, author, *, item=None, kind=Entry.Type.PROGRESS, when=None, **fields):
    entry = Entry.objects.create(
        team_season=team,
        author=author,
        work_item=item,
        type=kind,
        occurred_at=when or at(NOVEMBER),
        **fields,
    )
    if kind == Entry.Type.PROGRESS:
        EntryParticipant.objects.create(entry=entry, user=author)
    return entry


def search(client, team, **params):
    response = client.get(f"/api/team-seasons/{team.id}/search/", params)
    assert response.status_code == 200, response.json()
    return response.json()


def ids(body):
    return [entry["id"] for entry in body["results"]]


def scene(client):
    """A team, its member signed in, and an intake to write about."""
    team = team_season()
    lina = member("Lina", team)
    client.force_login(lina)
    return team, lina, work_item(team, "Intake")


# --- text ---


def test_text_ignores_case_and_accents_on_both_sides(client):
    team, lina, intake = scene(client)
    found = trace(team, lina, item=intake, body="Réglé la DÉRIVE de l'élévateur")
    trace(team, lina, item=intake, body="Rien à signaler")

    assert ids(search(client, team, q="derive ELEVATEUR")) == [found.id]
    assert ids(search(client, team, q="Dérive")) == [found.id]


def test_every_word_must_appear_but_in_any_field(client):
    team, lina, intake = scene(client)
    both = trace(team, lina, item=intake, body="moteur", handover="courroie")
    trace(team, lina, item=intake, body="moteur seul")

    assert ids(search(client, team, q="courroie moteur")) == [both.id]


def test_text_finds_a_work_item_by_its_title(client):
    team, lina, intake = scene(client)
    found = trace(team, lina, item=intake, body="Les roues tournent")
    trace(team, lina, item=work_item(team, "Châssis"), body="Les roues aussi")

    assert ids(search(client, team, q="intake")) == [found.id]
    assert ids(search(client, team, q="chassis")) != [found.id]


def test_percent_and_underscore_are_matched_literally(client):
    team, lina, intake = scene(client)
    found = trace(team, lina, item=intake, body="Batterie à 100%")
    trace(team, lina, item=intake, body="Batterie pleine")

    assert ids(search(client, team, q="100%")) == [found.id]
    assert ids(search(client, team, q="_")) == []


# --- the other filters ---


def test_filters_by_work_item_side_step_and_type(client):
    team, lina, intake = scene(client)
    sponsoring = work_item(team, "Sponsoring", on_robot=False)
    built = trace(team, lina, item=intake, step=Entry.Step.BUILDING)
    tested = trace(team, lina, item=intake, step=Entry.Step.DRY_TESTS)
    letter = trace(team, lina, item=sponsoring, step=Entry.Step.BRAINSTORMING)
    note = trace(team, lina, item=intake, kind=Entry.Type.NOTE, body="Vis")

    assert set(ids(search(client, team, work_item=intake.id))) == {
        built.id,
        tested.id,
        note.id,
    }
    assert ids(search(client, team, on_robot="false")) == [letter.id]
    assert ids(search(client, team, step="dry_tests")) == [tested.id]
    assert ids(search(client, team, type="note")) == [note.id]


def test_a_participant_is_who_took_part_or_who_wrote(client):
    team, lina, intake = scene(client)
    tom = member("Tom", team)
    with_tom = trace(team, lina, item=intake, when=at(NOVEMBER, 15))
    EntryParticipant.objects.create(entry=with_tom, user=tom)
    by_tom = trace(team, tom, item=intake, kind=Entry.Type.NOTE, body="Vu")
    trace(team, lina, item=intake, when=at(NOVEMBER, 14))

    assert set(ids(search(client, team, participant=tom.id))) == {
        with_tom.id,
        by_tom.id,
    }


def test_a_period_counts_in_workdays_both_ends_included(client):
    team, lina, intake = scene(client)
    # Two in the morning on the 19th is still the 18th's session.
    late = trace(team, lina, item=intake, when=at(date(2026, 11, 19), 2))
    trace(team, lina, item=intake, when=at(date(2026, 11, 17)))
    trace(team, lina, item=intake, when=at(date(2026, 11, 19), 5))

    body = search(client, team, since="2026-11-18", until="2026-11-18")

    assert ids(body) == [late.id]
    assert body["results"][0]["day"] == "2026-11-18"


def test_filters_combine(client):
    team, lina, intake = scene(client)
    match = trace(team, lina, item=intake, body="capteur", step="building")
    trace(team, lina, item=intake, body="capteur", step="dry_tests")
    trace(team, lina, item=work_item(team, "Bras"), body="capteur", step="building")

    assert ids(
        search(client, team, q="capteur", work_item=intake.id, step="building")
    ) == [match.id]


# --- order and pages ---


def test_sorts_by_date_either_way_and_pages_with_a_total(client):
    team, lina, intake = scene(client)
    made = [
        trace(team, lina, item=intake, when=at(date(2026, 11, day)))
        for day in range(1, 6)
    ]

    newest = search(client, team, page_size=2)
    oldest = search(client, team, order="oldest", page_size=2, page=3)

    assert newest["count"] == 5
    assert ids(newest) == [made[4].id, made[3].id]
    assert oldest["count"] == 5
    assert ids(oldest) == [made[4].id]
    assert ids(search(client, team, page=4, page_size=2)) == []


def test_refuses_a_page_size_beyond_fifty(client):
    team, _, _ = scene(client)

    response = client.get(f"/api/team-seasons/{team.id}/search/", {"page_size": 51})

    assert response.status_code == 400


def test_refuses_a_reversed_period(client):
    team, _, _ = scene(client)

    response = client.get(
        f"/api/team-seasons/{team.id}/search/",
        {"since": "2026-11-20", "until": "2026-11-18"},
    )

    assert response.status_code == 400
    assert response.json()["non_field_errors"][0]["code"] == "period_reversed"


# --- who searches what ---


def test_searches_only_the_team_asked_for(client):
    team, lina, intake = scene(client)
    other = team_season(6543)
    trace(other, member("Noé", other), item=work_item(other, "Intake"), body="x")
    mine = trace(team, lina, item=intake, body="x")

    assert ids(search(client, team, q="x")) == [mine.id]


def test_a_member_cannot_search_another_team(client):
    _, _, _ = scene(client)
    other = team_season(6543)

    response = client.get(f"/api/team-seasons/{other.id}/search/")

    assert response.status_code == 403


def test_a_mentor_searches_any_team(client):
    team = team_season()
    trace(team, member("Lina", team), item=work_item(team, "Intake"))
    client.force_login(member("Claire", role=User.ClubRole.MENTOR))

    assert search(client, team)["count"] == 1


def test_refuses_another_teams_work_item(client):
    team, _, _ = scene(client)
    other = team_season(6543)

    response = client.get(
        f"/api/team-seasons/{team.id}/search/",
        {"work_item": work_item(other, "Bras").id},
    )

    assert response.status_code == 400
    assert response.json()["work_item"][0]["code"] == "work_item_not_in_team"


def test_offers_members_and_whoever_left_a_trace(client):
    team, lina, intake = scene(client)
    claire = member("Claire", role=User.ClubRole.MENTOR)
    entry = trace(team, lina, item=intake)
    EntryParticipant.objects.create(entry=entry, user=claire)
    member("Inconnu", team_season(6543))

    people = search(client, team)["people"]

    assert [person["display_name"] for person in people] == ["Claire", "Lina"]
    assert people[1]["id"] == lina.id
