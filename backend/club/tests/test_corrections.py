import pytest

from club.corrections import (
    EntryChanged,
    can_correct,
    can_remove,
    can_remove_attachment,
    correct,
)
from club.models import Attachment, Entry, Season, Team, TeamSeason, User, WorkItem
from club.progress import edit_progress, join, record_progress


def work_item():
    season = Season.objects.create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=12345, name="Rouages & Cie")
    team_season = TeamSeason.objects.create(team=team, season=season)
    return WorkItem.objects.create(
        team_season=team_season, title="intake", on_robot=True
    )


def student(name="marie"):
    return User.objects.create_user(f"{name}@example.org", name)


def mentor():
    return User.objects.create_user(
        "paul@example.org", "paul", club_role=User.ClubRole.MENTOR
    )


def trace(intake, author, type):
    return Entry.objects.create(
        team_season=intake.team_season,
        work_item=intake,
        author=author,
        type=type,
        body="Perceuse HS.",
    )


@pytest.mark.parametrize("type", [Entry.Type.NOTE, Entry.Type.DECISION])
def test_an_author_removes_their_own_note_or_decision(db, type):
    marie = student()

    assert can_remove(trace(work_item(), marie, type), marie)


def test_a_student_cannot_remove_someone_elses_note(db):
    note = trace(work_item(), student(), Entry.Type.NOTE)

    assert not can_remove(note, student("tom"))


def test_a_student_cannot_remove_a_progress_even_their_own(db):
    marie = student()

    assert not can_remove(record_progress(work_item(), marie, "Monté."), marie)


def test_a_mentor_removes_any_trace(db):
    intake, paul = work_item(), mentor()

    assert can_remove(record_progress(intake, student(), "Monté."), paul)
    assert can_remove(trace(intake, student("tom"), Entry.Type.DECISION), paul)


def test_the_uploader_or_a_mentor_removes_a_file_and_nobody_else(db):
    marie = student()
    entry = record_progress(work_item(), marie, "Monté.")
    attachment = Attachment(entry=entry, uploaded_by=marie, name="plan.pdf")

    assert can_remove_attachment(attachment, marie)
    assert can_remove_attachment(attachment, mentor())
    assert not can_remove_attachment(attachment, student("tom"))


def test_only_a_mentor_corrects_a_trace(db):
    marie = student()
    note = trace(work_item(), marie, Entry.Type.NOTE)

    assert can_correct(note, mentor())
    assert not can_correct(note, marie)


def test_a_mentor_corrects_any_trace(db):
    note = trace(work_item(), student(), Entry.Type.NOTE)
    paul = mentor()

    correct(note, paul, body="Perceuse à changer.", body_was="Perceuse HS.")

    note.refresh_from_db()
    assert note.body == "Perceuse à changer."
    assert note.updated_by == paul


def test_a_correction_over_a_newer_text_is_refused(db):
    marie, tom = student(), student("tom")
    entry = record_progress(work_item(), marie, "Rouleaux montés.")
    join(entry, tom)
    edit_progress(entry, tom, addition="Moteur testé.")

    with pytest.raises(EntryChanged):
        correct(entry, mentor(), body="Rouleaux.", body_was="Rouleaux montés.")

    entry.refresh_from_db()
    assert entry.body == "Rouleaux montés.\n\nMoteur testé."
