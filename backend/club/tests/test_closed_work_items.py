"""A closed work item is read-only (#139): nothing moves it forward until
someone reopens it on purpose, but its history can still be put right."""

from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from club.api.serializers import NoteSerializer
from club.models import Entry, Membership, Season, Team, TeamSeason, User, WorkItem
from club.progress import WorkItemClosed, edit_progress, record_progress

CLOSED = [WorkItem.Status.DONE, WorkItem.Status.DROPPED]


def team_season():
    season, _ = Season.objects.get_or_create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=12345, name="Rouages")
    return TeamSeason.objects.create(team=team, season=season)


def member_of(team_season, name="lina"):
    user = User.objects.create_user(f"{name}@example.org", name)
    Membership.objects.create(user=user, team_season=team_season)
    return user


def mentor():
    return User.objects.create_user(
        "paul@example.org", "paul", club_role=User.ClubRole.MENTOR
    )


@pytest.fixture
def closed(db, request):
    """Outreach, with today's progress by Lina, then closed."""
    rouages = team_season()
    lina = member_of(rouages)
    outreach = WorkItem.objects.create(team_season=rouages, title="outreach")
    progress = record_progress(outreach, lina, "Stand monté.")
    WorkItem.objects.filter(pk=outreach.pk).update(status=request.param)
    outreach.refresh_from_db()
    return outreach, lina, progress


def refused(response):
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "work_item_closed"


@pytest.mark.parametrize("closed", CLOSED, indirect=True)
def test_a_progress_is_never_recorded_on_a_closed_work_item(closed):
    outreach, lina, _ = closed

    with pytest.raises(WorkItemClosed):
        record_progress(outreach, lina, "Finalement, on reprend.")

    outreach.refresh_from_db()
    assert outreach.status != WorkItem.Status.OPEN


@pytest.mark.parametrize("closed", CLOSED, indirect=True)
def test_ticking_a_closed_work_item_is_refused(client, closed):
    outreach, _, _ = closed
    client.force_login(member_of(outreach.team_season, "tom"))

    refused(
        client.post(
            f"/api/work-items/{outreach.id}/tick/", {}, content_type="application/json"
        )
    )


@pytest.mark.parametrize("closed", CLOSED, indirect=True)
def test_adding_to_the_progress_of_a_closed_work_item_is_refused(client, closed):
    # Seen on 4 October: a progress written twelve minutes after its work
    # item was dropped, which stayed dropped.
    _, lina, progress = closed
    client.force_login(lina)

    refused(
        client.patch(
            f"/api/entries/{progress.id}/",
            {"addition": "Flyers distribués."},
            content_type="application/json",
        )
    )
    progress.refresh_from_db()
    assert progress.body == "Stand monté."


@pytest.mark.parametrize("closed", CLOSED, indirect=True)
@pytest.mark.parametrize("kind", ["notes", "decisions"])
def test_a_note_or_decision_on_a_closed_work_item_is_refused(client, closed, kind):
    outreach, lina, _ = closed
    client.force_login(lina)

    refused(
        client.post(
            f"/api/team-seasons/{outreach.team_season_id}/{kind}/",
            {"body": "Une de plus.", "work_item": outreach.id},
            content_type="application/json",
        )
    )
    assert not Entry.objects.exclude(type=Entry.Type.PROGRESS).exists()


@pytest.mark.parametrize("closed", CLOSED, indirect=True)
def test_a_file_on_a_trace_of_a_closed_work_item_is_refused(
    client, closed, settings, tmp_path
):
    settings.MEDIA_ROOT = tmp_path
    _, lina, progress = closed
    client.force_login(lina)

    refused(
        client.post(
            f"/api/entries/{progress.id}/attachments/",
            {
                "file": SimpleUploadedFile("plan.pdf", b"%PDF-1.7\n1 0 obj\n"),
                "people_recognisable": "false",
            },
        )
    )
    assert not progress.attachments.exists()


@pytest.mark.parametrize("closed", CLOSED, indirect=True)
def test_a_closed_work_items_history_can_still_be_put_right(client, closed):
    # Correcting or removing a trace, or leaving a progress ticked by
    # mistake, repairs the record; it does not move the work forward.
    outreach, lina, progress = closed
    client.force_login(mentor())

    corrected = client.patch(
        f"/api/entries/{progress.id}/",
        {"body": "Stand monté et démonté.", "body_was": "Stand monté."},
        content_type="application/json",
    )
    client.force_login(lina)
    left = client.delete(f"/api/work-items/{outreach.id}/tick/")

    assert corrected.status_code == 200
    assert left.status_code == 204


# --- closed by someone else meanwhile: what counts is the database ---


@pytest.fixture
def open_item(db):
    rouages = team_season()
    lina = member_of(rouages)
    outreach = WorkItem.objects.create(team_season=rouages, title="outreach")
    return outreach, lina


def close_in_the_database(item):
    WorkItem.objects.filter(pk=item.pk).update(status=WorkItem.Status.DROPPED)


def test_progress_on_a_work_item_closed_since_it_was_loaded_is_refused(open_item):
    outreach, lina = open_item
    close_in_the_database(outreach)

    with pytest.raises(WorkItemClosed):
        record_progress(outreach, lina, "Stand monté.")

    assert not Entry.objects.exists()


def test_an_edit_on_a_work_item_closed_since_it_was_loaded_is_refused(open_item):
    outreach, lina = open_item
    progress = record_progress(outreach, lina, "Stand monté.")
    close_in_the_database(progress.work_item)

    with pytest.raises(WorkItemClosed):
        edit_progress(progress, lina, addition="Et démonté.")

    progress.refresh_from_db()
    assert progress.body == "Stand monté."


def test_a_note_is_refused_when_its_work_item_closes_during_validation(
    client, open_item
):
    outreach, lina = open_item
    client.force_login(lina)

    def closed_meanwhile(serializer, value):
        close_in_the_database(value)
        return value

    with mock.patch.object(NoteSerializer, "validate_work_item", closed_meanwhile):
        response = client.post(
            f"/api/team-seasons/{outreach.team_season_id}/notes/",
            {"body": "Une de plus.", "work_item": outreach.id},
            content_type="application/json",
        )

    refused(response)
    assert not Entry.objects.exists()


# --- closing, with its reason, and reopening on purpose ---


def change(client, item, **body):
    return client.patch(
        f"/api/work-items/{item.id}/", body, content_type="application/json"
    )


def notes_on(item):
    return list(
        Entry.objects.filter(work_item=item, type=Entry.Type.NOTE).values_list(
            "author__display_name", "body"
        )
    )


def test_dropping_a_work_item_asks_why(client, db):
    rouages = team_season()
    client.force_login(member_of(rouages))
    pince = WorkItem.objects.create(team_season=rouages, title="pince", on_robot=True)

    response = change(client, pince, status="dropped")

    assert response.status_code == 400
    assert response.json()["reason"][0]["code"] == "reason_required"
    pince.refresh_from_db()
    assert pince.status == WorkItem.Status.OPEN


def test_why_it_was_dropped_stays_in_its_history_as_a_note(client, db):
    # What a judge looks for in an engineering notebook: why a lead was left.
    rouages = team_season()
    client.force_login(member_of(rouages))
    pince = WorkItem.objects.create(team_season=rouages, title="pince", on_robot=True)

    response = change(
        client, pince, status="dropped", reason="Trop lourde pour le bras."
    )

    assert response.status_code == 200
    pince.refresh_from_db()
    assert pince.status == WorkItem.Status.DROPPED
    assert notes_on(pince) == [("lina", "Trop lourde pour le bras.")]


@pytest.mark.parametrize("reason", [None, "Dossier envoyé."])
def test_finishing_may_say_why_or_not(client, db, reason):
    rouages = team_season()
    client.force_login(member_of(rouages))
    sponsoring = WorkItem.objects.create(team_season=rouages, title="sponsoring")
    body = {"status": "done"} | ({"reason": reason} if reason else {})

    response = change(client, sponsoring, **body)

    assert response.status_code == 200
    assert notes_on(sponsoring) == ([("lina", reason)] if reason else [])


def test_a_refused_closing_leaves_no_note_behind(client, db):
    rouages = team_season()
    client.force_login(member_of(rouages))
    intake = WorkItem.objects.create(team_season=rouages, title="intake", on_robot=True)

    response = change(client, intake, status="done", reason="Fini !")

    assert response.json()["status"][0]["code"] == "done_on_robot"
    assert notes_on(intake) == []


@pytest.mark.parametrize("closed", CLOSED, indirect=True)
def test_a_member_reopens_a_closed_work_item_on_purpose(client, closed):
    outreach, lina, _ = closed
    client.force_login(lina)

    response = change(client, outreach, status="open")

    assert response.status_code == 200
    outreach.refresh_from_db()
    assert outreach.status == WorkItem.Status.OPEN
    assert outreach.closed_at is None
    # Open again, it takes work again.
    assert (
        client.post(
            f"/api/work-items/{outreach.id}/tick/", {}, content_type="application/json"
        ).status_code
        == 200
    )


@pytest.mark.parametrize("closed", CLOSED, indirect=True)
def test_reopening_may_say_why(client, closed):
    outreach, lina, _ = closed
    client.force_login(lina)

    change(client, outreach, status="open", reason="Nouveau salon en mars.")

    assert notes_on(outreach) == [("lina", "Nouveau salon en mars.")]


@pytest.mark.parametrize("closed", CLOSED, indirect=True)
def test_a_closed_work_item_is_reopened_before_it_is_closed_again(client, closed):
    outreach, lina, _ = closed
    client.force_login(lina)

    refused(change(client, outreach, status="dropped", reason="Finalement non."))
    assert notes_on(outreach) == []


@pytest.mark.parametrize("closed", CLOSED, indirect=True)
def test_a_closed_work_item_says_so_before_asking_why(client, closed):
    outreach, lina, _ = closed
    client.force_login(lina)

    # Typing a reason would only lead to the refusal.
    refused(change(client, outreach, status="dropped"))


def test_reopening_an_open_work_item_is_refused(client, db):
    rouages = team_season()
    client.force_login(member_of(rouages))
    pince = WorkItem.objects.create(team_season=rouages, title="pince")

    response = change(client, pince, status="open", reason="Pour voir.")

    assert response.json()["status"][0]["code"] == "already_open"
    assert notes_on(pince) == []


def test_a_work_item_says_when_it_was_closed_and_forgets_it_once_reopened(client, db):
    # The screen says "dropped on 2 October" above the read-only page.
    rouages = team_season()
    client.force_login(member_of(rouages))
    pince = WorkItem.objects.create(team_season=rouages, title="pince")

    dropped = change(client, pince, status="dropped", reason="Trop lourde.").json()
    reopened = change(client, pince, status="open").json()

    assert dropped["closed_at"] is not None
    assert reopened["closed_at"] is None
