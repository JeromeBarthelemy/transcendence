import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.db.models import ProtectedError

from club.models import Season, Team, TeamSeason


def season(start_year=2026, game_name="BioBuzz"):
    return Season.objects.create(start_year=start_year, game_name=game_name)


def team(number=12345, name="Rouages & Cie"):
    return Team.objects.create(number=number, name=name)


def test_two_teams_cannot_share_a_number():
    team()

    with pytest.raises(IntegrityError):
        team(name="Une autre équipe")


def test_a_team_number_below_one_is_refused():
    # FIRST assigns the number, and it starts at 1: 0 is a forgotten field.
    with pytest.raises(ValidationError):
        Team(number=0, name="Rouages & Cie").full_clean()


def test_the_same_team_joins_one_season_only_once():
    this_year = season()
    rouages = team()
    TeamSeason.objects.create(team=rouages, season=this_year)

    with pytest.raises(IntegrityError):
        TeamSeason.objects.create(team=rouages, season=this_year)


def test_a_duplicate_team_season_reads_in_french_through_the_admin():
    # The Django admin calls full_clean() before saving — the one place
    # today this constraint is actually reachable (admin.site.register
    # includes TeamSeason), where it must read in French, not as the raw
    # IntegrityError test_the_same_team_joins_one_season_only_once covers.
    this_year = season()
    rouages = team()
    TeamSeason.objects.create(team=rouages, season=this_year)

    with pytest.raises(ValidationError) as raised:
        TeamSeason(team=rouages, season=this_year).full_clean()

    assert raised.value.error_dict["__all__"][0].code == "team_season_exists"


def test_the_same_team_carries_on_into_the_next_season():
    rouages = team()

    TeamSeason.objects.create(team=rouages, season=season(2026, "BioBuzz"))
    TeamSeason.objects.create(team=rouages, season=season(2027, "Rebound"))

    assert rouages.team_seasons.count() == 2


def test_a_team_that_carries_history_cannot_be_deleted():
    rouages = team()
    TeamSeason.objects.create(team=rouages, season=season())

    with pytest.raises(ProtectedError):
        rouages.delete()


def test_a_season_that_carries_history_cannot_be_deleted():
    this_year = season()
    TeamSeason.objects.create(team=team(), season=this_year)

    with pytest.raises(ProtectedError):
        this_year.delete()


def test_a_team_that_carries_nothing_can_be_deleted():
    team().delete()

    assert not Team.objects.exists()
