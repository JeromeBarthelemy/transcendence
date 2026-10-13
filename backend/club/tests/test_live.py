"""Who hears of a change on a team season, and what they are told.

Each scenario runs whole under one `async_to_sync`: the consumer's database
calls then come back to the test's own thread, and see its SQLite database,
which other threads would not share (tests/races.py)."""

from types import SimpleNamespace

import pytest
from asgiref.sync import async_to_sync, sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from config.asgi import application
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import OperationalError
from django.test import Client
from django.utils import timezone

from club.models import (
    Attachment,
    Entry,
    EntryParticipant,
    Membership,
    Notification,
    Season,
    Team,
    TeamSeason,
    User,
    WorkItem,
)
from club.progress import join, record_progress
from club.workdays import workday


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


def connects_as_themselves(**kwargs):
    sent = headers(**kwargs)

    async def scenario():
        communicator = WebsocketCommunicator(application, "/ws/me/", sent)
        connected, _ = await communicator.connect()
        await communicator.disconnect()
        return connected

    return async_to_sync(scenario)()


def test_a_signed_in_member_connects_to_their_own_socket(db):
    assert connects_as_themselves(user=member_of(team_season()))


def test_an_anonymous_visitor_has_no_socket_of_their_own(db):
    assert not connects_as_themselves()


def test_a_socket_of_their_own_from_another_site_is_refused(db):
    assert not connects_as_themselves(
        user=member_of(team_season()), origin="https://evil.example"
    )


# --- what a team season is told ---


@pytest.fixture
def board(db, settings, tmp_path):
    """A team with a robot work item, today's progress and a file on it, a
    note written twice, an empty work item opened by mistake, and a dropped
    one. Tom took part in a progress on the robot work item and on the
    dropped one, so he follows both."""
    settings.MEDIA_ROOT = tmp_path
    rouages = team_season()
    lina = member_of(rouages)
    intake = WorkItem.objects.create(team_season=rouages, title="intake", on_robot=True)
    empty = WorkItem.objects.create(team_season=rouages, title="pince")
    progress = record_progress(intake, lina, "Galets montés.", handover="Tester.")
    duplicate = Entry.objects.create(
        team_season=rouages,
        author=lina,
        type=Entry.Type.NOTE,
        body="Doublon.",
        work_item=intake,
    )
    tom = member_of(rouages, "tom")
    join(progress, tom)
    dropped = WorkItem.objects.create(team_season=rouages, title="treuil")
    join(record_progress(dropped, lina, "Treuil essayé."), tom)
    dropped.status = WorkItem.Status.DROPPED
    dropped.closed_at = timezone.now()
    dropped.save()
    client = Client()
    client.force_login(lina)
    attachment = client.post(
        f"/api/entries/{progress.id}/attachments/",
        {"file": pdf(), "people_recognisable": "false"},
    ).json()
    return SimpleNamespace(
        team_season=rouages,
        lina=lina,
        tom=tom,
        client=client,
        intake=intake,
        empty=empty,
        dropped=dropped,
        progress=progress,
        duplicate=duplicate,
        attachment=attachment,
    )


def pdf():
    return SimpleUploadedFile("plan.pdf", b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n")


def as_mentor():
    client = Client()
    client.force_login(mentor())
    return client


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
        b.client.patch(
            f"/api/work-items/{b.intake.id}/",
            **as_json(status="dropped", reason="Trop lourd."),
        ),
        lambda response: b.intake.id,
    ),
    "reopen a work item": lambda b: (
        b.client.patch(f"/api/work-items/{b.dropped.id}/", **as_json(status="open")),
        lambda response: b.dropped.id,
    ),
    "delete a work item": lambda b: (
        b.client.delete(f"/api/work-items/{b.empty.id}/"),
        lambda response: b.empty.id,
    ),
    "tick": lambda b: (
        b.client.post(f"/api/work-items/{b.empty.id}/tick/", **as_json()),
        lambda response: b.empty.id,
    ),
    "tick at another step": lambda b: (
        b.client.post(
            f"/api/work-items/{b.intake.id}/tick/", **as_json(step="building")
        ),
        lambda response: b.intake.id,
    ),
    "leave today's progress": lambda b: (
        b.client.delete(f"/api/work-items/{b.intake.id}/tick/"),
        lambda response: b.intake.id,
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
    "remove a trace": lambda b: (
        b.client.delete(f"/api/entries/{b.duplicate.id}/"),
        lambda response: b.intake.id,
    ),
    "correct a trace": lambda b: (
        as_mentor().patch(
            f"/api/entries/{b.progress.id}/",
            **as_json(body="Galets montés et serrés.", body_was="Galets montés."),
        ),
        lambda response: b.intake.id,
    ),
    "remove a file": lambda b: (
        b.client.delete(f"/api/attachments/{b.attachment['id']}/"),
        lambda response: b.intake.id,
    ),
}


def hears(user, write, django_capture_on_commit_callbacks):
    """What `user` hears on their own socket while `write` runs, its commit
    callbacks executed as a real commit would. None if nothing."""
    sent = headers(user=user)

    def committed():
        with django_capture_on_commit_callbacks(execute=True):
            return write()

    async def scenario():
        communicator = WebsocketCommunicator(application, "/ws/me/", sent)
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


def add_to_progress(board):
    return board.client.patch(
        f"/api/entries/{board.progress.id}/", **as_json(addition="Rien.")
    )


@pytest.mark.parametrize("write", WRITES.keys())
def test_every_write_on_the_board_reaches_its_members_on_their_own_socket(
    board, write, django_capture_on_commit_callbacks
):
    outcome = {}

    def run():
        response, expected = WRITES[write](board)
        outcome["status"] = response.status_code
        outcome["work_item"] = expected(response)

    _, heard = hears(board.lina, run, django_capture_on_commit_callbacks)

    assert outcome["status"] < 300
    # Said so that no screen reads the deleted work item again: a 404.
    assert heard == {
        "team_season": board.team_season.id,
        "work_item": outcome["work_item"],
        "deleted": write == "delete a work item",
    }


def test_a_student_of_another_team_hears_nothing_of_it(
    board, django_capture_on_commit_callbacks
):
    sam = member_of(team_season(67890), "sam")

    _, heard = hears(
        sam, lambda: add_to_progress(board), django_capture_on_commit_callbacks
    )

    assert heard is None


def test_a_mentor_hears_every_team(board, django_capture_on_commit_callbacks):
    _, heard = hears(
        mentor(), lambda: add_to_progress(board), django_capture_on_commit_callbacks
    )

    assert heard == {
        "team_season": board.team_season.id,
        "work_item": board.intake.id,
        "deleted": False,
    }


def test_a_member_taken_off_the_team_hears_nothing_more_of_it(
    board, django_capture_on_commit_callbacks
):
    def taken_off_then_written():
        Membership.objects.filter(user=board.tom).delete()
        return add_to_progress(board)

    _, heard = hears(
        board.tom, taken_off_then_written, django_capture_on_commit_callbacks
    )

    assert heard is None


def test_a_deactivated_member_hears_nothing_more(
    board, django_capture_on_commit_callbacks
):
    def deactivated_then_written():
        User.objects.filter(pk=board.tom.pk).update(is_active=False)
        return add_to_progress(board)

    _, heard = hears(
        board.tom, deactivated_then_written, django_capture_on_commit_callbacks
    )

    assert heard is None


def test_a_refused_write_notifies_nobody(board, django_capture_on_commit_callbacks):
    response, heard = hears(
        board.lina,
        lambda: board.client.patch(
            f"/api/entries/{board.progress.id}/",
            **as_json(handover="Régler le PID.", handover_was="Pas ça."),
        ),
        django_capture_on_commit_callbacks,
    )

    assert response.status_code == 409
    assert heard is None


def test_a_notification_that_fails_does_not_fail_the_write(
    board, monkeypatch, django_capture_on_commit_callbacks
):
    async def unreachable(group, message):
        raise OSError("channel layer unreachable")

    monkeypatch.setattr(get_channel_layer(), "group_send", unreachable)

    with django_capture_on_commit_callbacks(execute=True):
        response = board.client.post(
            f"/api/team-seasons/{board.team_season.id}/notes/",
            **as_json(body="Perceuse HS."),
        )

    assert response.status_code == 201


def test_ticking_again_changes_nothing_and_notifies_nobody(
    board, django_capture_on_commit_callbacks
):
    response, heard = hears(
        board.lina,
        lambda: board.client.post(
            f"/api/work-items/{board.intake.id}/tick/", **as_json()
        ),
        django_capture_on_commit_callbacks,
    )

    assert response.status_code == 200
    assert heard is None


def test_another_members_progress_notifies_the_listener_and_updates_activity(
    board, django_capture_on_commit_callbacks
):
    ines = member_of(board.team_season, "ines")
    writer = Client()
    writer.force_login(ines)
    day = workday(board.progress.occurred_at)
    analytics_url = (
        f"/api/team-seasons/{board.team_season.id}/analytics/activity/"
        f"?since={day}&until={day}"
    )
    before = board.client.get(analytics_url).json()["activity_by_day"]

    response, heard = hears(
        board.lina,
        lambda: writer.post(f"/api/work-items/{board.empty.id}/tick/", **as_json()),
        django_capture_on_commit_callbacks,
    )
    after = board.client.get(analytics_url).json()["activity_by_day"]

    assert response.status_code == 201
    assert heard == {
        "team_season": board.team_season.id,
        "work_item": board.empty.id,
        "deleted": False,
    }
    assert before == [{"day": str(day), "progress_entries": 2, "active_members": 2}]
    assert after == [{"day": str(day), "progress_entries": 3, "active_members": 3}]


# What each write tells Tom, who follows the robot work item; None when it
# tells him nothing. Ticking or leaving a progress tells nobody: ten students
# ticking at the start of a session would bury the notices that matter.
TOLD_TO_TOM = {
    "open a work item": Notification.Verb.WORK_ITEM_OPENED,
    "close a work item": Notification.Verb.WORK_ITEM_DROPPED,
    "reopen a work item": Notification.Verb.WORK_ITEM_REOPENED,
    "delete a work item": Notification.Verb.WORK_ITEM_DELETED,
    "tick": None,
    "tick at another step": Notification.Verb.ENTRY_ADDED,
    "leave today's progress": None,
    "add to a progress": Notification.Verb.ENTRY_UPDATED,
    "write a note on a work item": Notification.Verb.ENTRY_ADDED,
    "write a note to the whole team": Notification.Verb.ENTRY_ADDED,
    "record a decision": Notification.Verb.ENTRY_ADDED,
    "remove a trace": Notification.Verb.ENTRY_REMOVED,
    "correct a trace": Notification.Verb.ENTRY_UPDATED,
    "attach a file": Notification.Verb.ENTRY_UPDATED,
    "remove a file": Notification.Verb.ENTRY_UPDATED,
}


@pytest.mark.parametrize("write", WRITES.keys())
def test_every_write_on_the_board_tells_those_who_follow_it(board, write):
    # The board's own file, attached through the API, told Tom already.
    Notification.objects.all().delete()

    response, _ = WRITES[write](board)

    told = Notification.objects.filter(recipient=board.tom)
    assert response.status_code < 300
    expected = TOLD_TO_TOM[write]
    assert [n.verb for n in told] == ([] if expected is None else [expected])


def board_state(board, media_root):
    return (
        [
            list(model.objects.order_by("pk").values())
            for model in (WorkItem, Entry, EntryParticipant, Attachment)
        ],
        sorted(path.name for path in media_root.rglob("*") if path.is_file()),
    )


@pytest.mark.parametrize(
    "write", [write for write, told in TOLD_TO_TOM.items() if told is not None]
)
def test_a_write_whose_notices_fail_is_not_kept(board, write, monkeypatch, tmp_path):
    """The failure answers 500, so the write must not stand: a retry would
    make it twice."""

    def locked(*args, **kwargs):
        raise OperationalError("database is locked")

    monkeypatch.setattr(Notification.objects, "bulk_create", locked)
    before = board_state(board, tmp_path)

    with pytest.raises(OperationalError):
        WRITES[write](board)

    assert board_state(board, tmp_path) == before
