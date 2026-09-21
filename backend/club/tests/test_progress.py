from datetime import timedelta

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.utils import timezone

from club.models import Entry, Season, Team, TeamSeason, User, WorkItem
from club.progress import edit_progress, join, record_progress

Step = Entry.Step


def work_item(on_robot=True, status=WorkItem.Status.OPEN):
    season = Season.objects.create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=12345, name="Rouages & Cie")
    team_season = TeamSeason.objects.create(team=team, season=season)
    return WorkItem.objects.create(
        team_season=team_season, title="intake", on_robot=on_robot, status=status
    )


def student(name="marie"):
    return User.objects.create_user(f"{name}@example.org", name)


def mentor():
    return User.objects.create_user(
        "paul@example.org", "paul", club_role=User.ClubRole.MENTOR
    )


def test_a_first_progress_starts_at_brainstorming():
    entry = record_progress(work_item(), student(), "Trois idées de rouleaux.")

    assert entry.step == Step.BRAINSTORMING


def test_a_progress_carries_on_at_its_work_items_previous_step():
    intake = work_item()
    marie = student()
    record_progress(intake, marie, "Rouleaux imprimés.", step=Step.PROTOTYPING)

    entry = record_progress(intake, marie, "Deuxième version.")

    assert entry.step == Step.PROTOTYPING


def test_a_work_item_can_move_back_a_step():
    # An iteration, not a bug: the trail keeps both.
    intake = work_item()
    marie = student()
    record_progress(intake, marie, "Monté.", step=Step.BUILDING)

    record_progress(
        intake, marie, "On repart sur un autre rouleau.", step=Step.PROTOTYPING
    )

    assert intake.current_step == Step.PROTOTYPING


def test_a_work_item_with_no_progress_has_no_current_step():
    assert work_item().current_step is None


def test_a_progress_off_the_robot_has_no_step():
    sponsoring = work_item(on_robot=False)

    entry = record_progress(
        sponsoring, student(), "Dossier envoyé à trois entreprises."
    )

    assert entry.step is None


def test_a_step_is_refused_off_the_robot():
    with pytest.raises(ValidationError):
        record_progress(
            work_item(on_robot=False), student(), "Relance.", step=Step.BUILDING
        )


def test_a_progress_belongs_to_its_work_items_team():
    intake = work_item()

    entry = record_progress(intake, student(), "Trois idées de rouleaux.")

    assert entry.team_season == intake.team_season


def test_a_first_progress_opens_a_suggested_work_item():
    intake = work_item(status=WorkItem.Status.SUGGESTED)

    record_progress(intake, student(), "On s'y met.")

    intake.refresh_from_db()
    assert intake.status == WorkItem.Status.OPEN
    assert intake.opened_at is not None


@pytest.mark.parametrize("status", [WorkItem.Status.DONE, WorkItem.Status.DROPPED])
def test_a_progress_reopens_a_closed_work_item(status):
    # A work item thought finished is reopened by working on it again.
    opened = timezone.now() - timedelta(days=30)
    intake = work_item(status=status)
    WorkItem.objects.filter(pk=intake.pk).update(
        opened_at=opened, closed_at=timezone.now()
    )

    record_progress(intake, student(), "Finalement, on reprend.")

    intake.refresh_from_db()
    assert intake.status == WorkItem.Status.OPEN
    assert intake.closed_at is None
    assert intake.opened_at == opened


def test_a_student_who_records_a_progress_is_signed_up_to_it():
    marie = student()

    entry = record_progress(work_item(), marie, "Trois idées de rouleaux.")

    assert list(entry.participants.all()) == [marie]


def test_a_mentor_who_records_a_progress_is_not_signed_up_to_it():
    # Writing up what the students forgot is not having been there.
    entry = record_progress(work_item(), mentor(), "Rouleaux montés mercredi.")

    assert not entry.participants.exists()


def test_a_member_joins_someone_elses_progress():
    entry = record_progress(work_item(), student(), "Trois idées de rouleaux.")
    tom = student("tom")

    join(entry, tom)

    assert tom in entry.participants.all()


def test_nobody_joins_the_same_progress_twice():
    marie = student()
    entry = record_progress(work_item(), marie, "Trois idées de rouleaux.")

    with pytest.raises(IntegrityError):
        join(entry, marie)


def test_nobody_joins_a_note():
    # Attendance is read off progress only.
    marie = student()
    intake = work_item()
    note = Entry.objects.create(
        team_season=intake.team_season, author=marie, type=Entry.Type.NOTE
    )

    with pytest.raises(ValidationError):
        join(note, student("tom"))


def test_a_student_who_has_not_joined_cannot_edit_a_progress():
    entry = record_progress(work_item(), student(), "Trois idées de rouleaux.")

    with pytest.raises(ValidationError):
        edit_progress(entry, student("tom"), "Deux idées, en fait.")


def test_a_participant_edits_a_progress():
    entry = record_progress(work_item(), student(), "Trois idées de rouleaux.")
    tom = student("tom")
    join(entry, tom)

    edit_progress(entry, tom, "Deux idées, en fait.")

    entry.refresh_from_db()
    assert entry.body == "Deux idées, en fait."
    assert entry.updated_by == tom
    assert entry.updated_at is not None


def test_a_mentor_edits_a_progress_without_joining_it():
    entry = record_progress(work_item(), student(), "rouleaux")
    paul = mentor()

    edit_progress(entry, paul, "Trois idées de rouleaux, dont une imprimée.")

    assert not entry.participants.filter(pk=paul.pk).exists()
    entry.refresh_from_db()
    assert entry.updated_by == paul


def test_an_edit_cannot_put_a_step_off_the_robot():
    entry = record_progress(work_item(on_robot=False), student(), "Relance.")

    with pytest.raises(ValidationError):
        edit_progress(entry, mentor(), "Relance.", step=Step.BUILDING)


def test_a_note_is_not_edited_as_a_progress():
    intake = work_item()
    note = Entry.objects.create(
        team_season=intake.team_season, author=student(), type=Entry.Type.NOTE
    )

    with pytest.raises(ValidationError):
        edit_progress(note, mentor(), "Perceuse HS.")
