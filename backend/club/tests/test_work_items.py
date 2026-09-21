import pytest
from django.db import IntegrityError
from django.db.models import ProtectedError

from club.models import Season, Team, TeamSeason, WorkItem


def team_season(number=12345):
    season, _ = Season.objects.get_or_create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=number, name=f"Équipe {number}")
    return TeamSeason.objects.create(team=team, season=season)


def test_a_team_cannot_open_two_work_items_with_the_same_title():
    # Two students picking "intake" at the same moment must not split its thread.
    rouages = team_season()
    WorkItem.objects.create(team_season=rouages, title="intake", on_robot=True)

    with pytest.raises(IntegrityError):
        WorkItem.objects.create(team_season=rouages, title="intake", on_robot=True)


@pytest.mark.parametrize(
    "first, second",
    [
        ("Dossier de sponsoring", "dossier de sponsoring"),
        ("Électronique", "electronique"),
        ("tournoi à domicile", " tournoi  à domicile"),
    ],
)
def test_titles_differing_only_in_case_accents_or_spaces_are_the_same(first, second):
    # Typed by hand off the robot, the same subject comes back written otherwise.
    rouages = team_season()
    WorkItem.objects.create(team_season=rouages, title=first)

    with pytest.raises(IntegrityError):
        WorkItem.objects.create(team_season=rouages, title=second)


def test_renaming_a_work_item_onto_a_taken_title_is_refused():
    rouages = team_season()
    WorkItem.objects.create(team_season=rouages, title="Intake")
    other = WorkItem.objects.create(team_season=rouages, title="lanceur")

    other.title = "intake"
    with pytest.raises(IntegrityError):
        other.save(update_fields=["title"])


def test_two_teams_can_each_open_a_work_item_with_the_same_title():
    WorkItem.objects.create(
        team_season=team_season(12345), title="intake", on_robot=True
    )
    WorkItem.objects.create(
        team_season=team_season(67890), title="intake", on_robot=True
    )

    assert WorkItem.objects.filter(title="intake").count() == 2


def test_a_team_season_that_carries_work_items_cannot_be_deleted():
    rouages = team_season()
    WorkItem.objects.create(team_season=rouages, title="dossier de sponsoring")

    with pytest.raises(ProtectedError):
        rouages.delete()
