from datetime import timedelta

import pytest
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.db import IntegrityError
from django.utils import timezone

from club.models import Attachment, Entry, Season, Team, TeamSeason, User, WorkItem
from club.progress import (
    ProgressChanged,
    edit_progress,
    join,
    leave_todays_progress,
    record_progress,
)

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
        edit_progress(entry, student("tom"), addition="Deux idées, en fait.")


def test_a_participant_adds_to_the_progress_text():
    entry = record_progress(work_item(), student(), "Trois idées de rouleaux.")
    tom = student("tom")
    join(entry, tom)

    edit_progress(entry, tom, addition="  Une imprimée en TPU.  ")

    entry.refresh_from_db()
    assert entry.body == "Trois idées de rouleaux.\n\nUne imprimée en TPU."
    assert entry.updated_by == tom
    assert entry.updated_at is not None


def test_the_first_addition_becomes_the_text():
    marie = student()
    entry = record_progress(work_item(), marie, "")

    edit_progress(entry, marie, addition="Trois idées de rouleaux.")

    entry.refresh_from_db()
    assert entry.body == "Trois idées de rouleaux."


def test_two_additions_both_stay():
    marie, tom = student(), student("tom")
    entry = record_progress(work_item(), marie, "")
    join(entry, tom)

    edit_progress(entry, marie, addition="Rouleaux montés.")
    edit_progress(entry, tom, addition="Moteur testé.")

    entry.refresh_from_db()
    assert entry.body == "Rouleaux montés.\n\nMoteur testé."


def test_a_mentor_adds_to_a_progress_without_joining_it():
    entry = record_progress(work_item(), student(), "Trois idées de rouleaux.")
    paul = mentor()

    edit_progress(entry, paul, addition="Retenir celle en TPU.")

    assert not entry.participants.filter(pk=paul.pk).exists()
    entry.refresh_from_db()
    assert entry.body == "Trois idées de rouleaux.\n\nRetenir celle en TPU."
    assert entry.updated_by == paul


def test_an_edit_cannot_put_a_step_off_the_robot():
    entry = record_progress(work_item(on_robot=False), student(), "Relance.")

    with pytest.raises(ValidationError):
        edit_progress(entry, mentor(), step=Step.BUILDING)


def test_a_note_is_not_edited_as_a_progress():
    intake = work_item()
    note = Entry.objects.create(
        team_season=intake.team_season, author=student(), type=Entry.Type.NOTE
    )

    with pytest.raises(ValidationError):
        edit_progress(note, mentor(), addition="Perceuse HS.")


def test_a_progress_leaves_the_handover_shown_on_its_work_item():
    intake = work_item()
    sam = student("sam")

    entry = record_progress(
        intake, sam, "Galets montés.", handover="Ne pas resserrer la courroie."
    )

    assert intake.last_handover == entry
    assert entry.handover == "Ne pas resserrer la courroie."


def test_a_progress_with_nothing_to_hand_over_keeps_the_previous_handover():
    intake = work_item()
    sam = student("sam")
    left = record_progress(intake, sam, "Galets montés.", handover="Tester à 12 V.")

    record_progress(intake, student("tom"), "Rien de neuf.")

    assert intake.last_handover == left


def test_a_newer_handover_is_shown_and_the_older_one_stays_in_its_progress():
    intake = work_item()
    marie = student()
    first = record_progress(intake, marie, "Monté.", handover="Tester à 12 V.")

    second = record_progress(intake, marie, "Testé.", handover="Régler le PID.")

    assert intake.last_handover == second
    first.refresh_from_db()
    assert first.handover == "Tester à 12 V."


def test_a_work_item_nobody_handed_over_has_no_handover():
    intake = work_item()
    record_progress(intake, student(), "Maquette carton.")

    assert intake.last_handover is None


def test_a_participant_corrects_the_handover_of_a_progress():
    marie = student()
    entry = record_progress(work_item(), marie, "Monté.", handover="Tester à 21 V.")

    edit_progress(
        entry, marie, handover="Tester à 12 V.", handover_was="Tester à 21 V."
    )

    entry.refresh_from_db()
    assert entry.handover == "Tester à 12 V."


def test_a_handover_changed_since_is_not_overwritten():
    marie, tom = student(), student("tom")
    entry = record_progress(work_item(), marie, "Monté.", handover="Tester.")
    join(entry, tom)
    edit_progress(entry, marie, handover="Tester à 12 V.", handover_was="Tester.")

    with pytest.raises(ProgressChanged):
        edit_progress(entry, tom, handover="Régler le PID.", handover_was="Tester.")

    entry.refresh_from_db()
    assert entry.handover == "Tester à 12 V."


def test_someone_elses_addition_does_not_refuse_a_handover_change():
    marie, tom = student(), student("tom")
    entry = record_progress(work_item(), marie, "Monté.", handover="Tester.")
    join(entry, tom)
    edit_progress(entry, marie, addition="Courroie tendue.")

    edit_progress(entry, tom, handover="Tester à 12 V.", handover_was="Tester.")

    entry.refresh_from_db()
    assert entry.handover == "Tester à 12 V."


def test_a_refused_save_adds_nothing():
    marie, tom = student(), student("tom")
    entry = record_progress(work_item(), marie, "Monté.", handover="Tester.")
    join(entry, tom)
    edit_progress(entry, marie, handover="Tester à 12 V.", handover_was="Tester.")

    with pytest.raises(ProgressChanged):
        edit_progress(
            entry,
            tom,
            addition="Moteur testé.",
            handover="Régler le PID.",
            handover_was="Tester.",
        )

    entry.refresh_from_db()
    assert entry.body == "Monté."


def test_an_empty_save_leaves_the_progress_untouched():
    marie = student()
    entry = record_progress(work_item(), marie, "Monté.", handover="Tester.")

    edit_progress(entry, marie, addition="   ")

    entry.refresh_from_db()
    assert entry.updated_by is None
    assert entry.updated_at is None


# --- leaving today's progress ---


def test_a_member_leaves_todays_progress_and_the_others_stay_on_it():
    intake = work_item()
    marie, tom = student(), student("tom")
    entry = record_progress(intake, marie, "Rouleaux montés.")
    join(entry, tom)

    leave_todays_progress(intake, tom)

    assert list(entry.participants.all()) == [marie]


def test_the_last_to_leave_is_handed_the_progress_to_delete():
    intake = work_item()
    marie, tom = student(), student("tom")
    entry = record_progress(intake, marie, "Mauvais chantier.")
    join(entry, tom)

    assert leave_todays_progress(intake, tom) is None
    assert leave_todays_progress(intake, marie) == entry
    assert not entry.participants.exists()


def test_a_progress_holding_a_file_stays_once_everyone_has_left(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    intake = work_item()
    marie = student()
    entry = record_progress(intake, marie, "")
    Attachment.objects.create(
        entry=entry,
        uploaded_by=marie,
        file=ContentFile(b"%PDF-1.7", name="plan.pdf"),
        name="plan.pdf",
        content_type="application/pdf",
        people_recognisable=False,
    )

    assert leave_todays_progress(intake, marie) is None
    assert not entry.participants.exists()


def test_nobody_leaves_a_progress_they_are_not_on():
    intake = work_item()
    record_progress(intake, student(), "Rouleaux montés.")

    with pytest.raises(ValidationError) as refused:
        leave_todays_progress(intake, student("tom"))

    assert refused.value.code == "not_a_participant"


def test_a_past_progress_is_not_left():
    intake = work_item()
    marie = student()
    entry = record_progress(intake, marie, "Rouleaux montés.")
    Entry.objects.filter(pk=entry.pk).update(
        occurred_at=timezone.now() - timedelta(days=2)
    )

    with pytest.raises(ValidationError) as refused:
        leave_todays_progress(intake, marie)

    assert refused.value.code == "not_a_participant"
    assert entry.participants.filter(pk=marie.pk).exists()
