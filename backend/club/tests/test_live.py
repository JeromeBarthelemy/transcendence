"""Who may listen to a team season, and what it is told.

Each scenario runs whole under one `async_to_sync`: the consumer's database
calls then come back to the test's own thread, and see its SQLite database,
which other threads would not share (tests/races.py)."""

from types import SimpleNamespace

import pytest
from asgiref.sync import async_to_sync, sync_to_async
from channels.testing import WebsocketCommunicator
from config.asgi import application
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client

from club.models import Membership, Season, Team, TeamSeason, User, WorkItem
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


# An origin from the settings' ALLOWED_HOSTS, not "testserver": the validator
# reads the list once, when asgi.py is imported, before the test run adds it.
def headers(user=None, origin="http://localhost"):
    sent = [(b"origin", origin.encode())]
    if user is not None:
        client = Client()
        client.force_login(user)
        session = client.cookies["sessionid"].value
        sent.append((b"cookie", f"sessionid={session}".encode()))
    return sent


def connects(team_season, **kwargs):
    sent = headers(**kwargs)

    async def scenario():
        communicator = WebsocketCommunicator(
            application, f"/ws/team-seasons/{team_season.id}/", sent
        )
        connected, _ = await communicator.connect()
        await communicator.disconnect()
        return connected

    return async_to_sync(scenario)()


def test_a_member_connects_to_their_team_season(db):
    rouages = team_season()

    assert connects(rouages, user=member_of(rouages))


def test_a_mentor_connects_to_any_team_season(db):
    assert connects(team_season(), user=mentor())


def test_a_student_of_another_team_is_refused(db):
    other = team_season(67890)

    assert not connects(team_season(), user=member_of(other))


def test_an_anonymous_visitor_is_refused(db):
    assert not connects(team_season())


def test_a_connection_from_another_site_is_refused(db):
    rouages = team_season()

    assert not connects(rouages, user=member_of(rouages), origin="https://evil.example")


# --- what a team season is told ---


@pytest.fixture
def board(db, settings, tmp_path):
    """A team with a robot work item, today's progress and a file on it, and
    an empty work item opened by mistake."""
    settings.MEDIA_ROOT = tmp_path
    rouages = team_season()
    lina = member_of(rouages)
    intake = WorkItem.objects.create(team_season=rouages, title="intake", on_robot=True)
    empty = WorkItem.objects.create(team_season=rouages, title="pince")
    progress = record_progress(intake, lina, "Galets montés.", handover="Tester.")
    client = Client()
    client.force_login(lina)
    attachment = client.post(
        f"/api/entries/{progress.id}/attachments/",
        {"file": pdf(), "people_recognisable": "false"},
    ).json()
    return SimpleNamespace(
        team_season=rouages,
        lina=lina,
        client=client,
        intake=intake,
        empty=empty,
        progress=progress,
        attachment=attachment,
    )


def pdf():
    return SimpleUploadedFile("plan.pdf", b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n")


def as_json(**body):
    return {"data": body, "content_type": "application/json"}


# Each write on the board, and the work item its message names.
WRITES = {
    "open a work item": lambda b: (
        b.client.post(
            f"/api/team-seasons/{b.team_season.id}/work-items/",
            **as_json(title="châssis", on_robot=True),
        ),
        lambda response: response.json()["id"],
    ),
    "close a work item": lambda b: (
        b.client.patch(f"/api/work-items/{b.intake.id}/", **as_json(status="dropped")),
        lambda response: b.intake.id,
    ),
    "delete a work item": lambda b: (
        b.client.delete(f"/api/work-items/{b.empty.id}/"),
        lambda response: b.empty.id,
    ),
    "tick": lambda b: (
        b.client.post(f"/api/work-items/{b.empty.id}/tick/", **as_json()),
        lambda response: b.empty.id,
    ),
    "add to a progress": lambda b: (
        b.client.patch(
            f"/api/entries/{b.progress.id}/", **as_json(addition="Courroie tendue.")
        ),
        lambda response: b.intake.id,
    ),
    "write a note on a work item": lambda b: (
        b.client.post(
            f"/api/team-seasons/{b.team_season.id}/notes/",
            **as_json(body="Perceuse HS.", work_item=b.intake.id),
        ),
        lambda response: b.intake.id,
    ),
    "write a note to the whole team": lambda b: (
        b.client.post(
            f"/api/team-seasons/{b.team_season.id}/notes/",
            **as_json(body="Atelier fermé vendredi."),
        ),
        lambda response: None,
    ),
    "record a decision": lambda b: (
        b.client.post(
            f"/api/team-seasons/{b.team_season.id}/decisions/",
            **as_json(body="Pince à deux doigts.", work_item=b.intake.id),
        ),
        lambda response: b.intake.id,
    ),
    "attach a file": lambda b: (
        b.client.post(
            f"/api/entries/{b.progress.id}/attachments/",
            {"file": pdf(), "people_recognisable": "false"},
        ),
        lambda response: b.intake.id,
    ),
    "remove a file": lambda b: (
        b.client.delete(f"/api/attachments/{b.attachment['id']}/"),
        lambda response: b.intake.id,
    ),
}


def listen(team_season, user, write, django_capture_on_commit_callbacks):
    """What the team season's listeners hear while `write` runs, its
    commit callbacks executed as a real commit would. None if nothing."""
    sent = headers(user=user)

    def committed():
        with django_capture_on_commit_callbacks(execute=True):
            return write()

    async def scenario():
        communicator = WebsocketCommunicator(
            application, f"/ws/team-seasons/{team_season.id}/", sent
        )
        await communicator.connect()
        result = await sync_to_async(committed)()
        heard = (
            None
            if await communicator.receive_nothing(timeout=0.2)
            else await communicator.receive_json_from()
        )
        await communicator.disconnect()
        return result, heard

    return async_to_sync(scenario)()


@pytest.mark.parametrize("write", WRITES.values(), ids=WRITES.keys())
def test_every_write_on_the_board_notifies_its_team_season(
    board, write, django_capture_on_commit_callbacks
):
    outcome = {}

    def run():
        response, expected = write(board)
        outcome["status"] = response.status_code
        outcome["work_item"] = expected(response)

    _, heard = listen(
        board.team_season, board.lina, run, django_capture_on_commit_callbacks
    )

    assert outcome["status"] < 300
    assert heard == {"work_item": outcome["work_item"]}


def test_a_change_is_not_sent_to_another_team_season(
    board, django_capture_on_commit_callbacks
):
    other = team_season(67890)
    sam = member_of(other, "sam")

    _, heard = listen(
        other,
        sam,
        lambda: board.client.patch(
            f"/api/entries/{board.progress.id}/", **as_json(addition="Rien.")
        ),
        django_capture_on_commit_callbacks,
    )

    assert heard is None


def test_a_refused_write_notifies_nobody(board, django_capture_on_commit_callbacks):
    response, heard = listen(
        board.team_season,
        board.lina,
        lambda: board.client.patch(
            f"/api/entries/{board.progress.id}/",
            **as_json(handover="Régler le PID.", handover_was="Pas ça."),
        ),
        django_capture_on_commit_callbacks,
    )

    assert response.status_code == 409
    assert heard is None
