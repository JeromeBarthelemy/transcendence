import pytest
from django.core.exceptions import ValidationError

from club.models import Entry, Season, Team, TeamSeason, User, WorkItem
from club.progress import record_progress

Step = Entry.Step


def work_item(on_robot=True, status=WorkItem.Status.OPEN):
    season = Season.objects.create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=12345, name="Rouages & Cie")
    team_season = TeamSeason.objects.create(team=team, season=season)
    return WorkItem.objects.create(
        team_season=team_season, title="intake", on_robot=on_robot, status=status
    )


def student():
    return User.objects.create_user("marie@example.org", "marie")


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
