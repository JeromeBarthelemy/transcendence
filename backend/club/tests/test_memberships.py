import pytest
from django.db import IntegrityError

from club.models import Membership, Season, Team, TeamSeason, User


def team_season(number=12345, start_year=2026, game_name="BioBuzz"):
    return TeamSeason.objects.create(
        team=Team.objects.create(number=number, name=f"Équipe {number}"),
        season=Season.objects.create(start_year=start_year, game_name=game_name),
    )


def member(email="ada@club.fr", display_name="Ada"):
    return User.objects.create_user(email, display_name)


def test_a_member_is_assigned_to_a_team_season_only_once():
    ada, rouages = member(), team_season()
    Membership.objects.create(user=ada, team_season=rouages)

    with pytest.raises(IntegrityError):
        Membership.objects.create(user=ada, team_season=rouages)


def test_a_member_can_be_assigned_to_two_team_seasons():
    ada = member()

    Membership.objects.create(user=ada, team_season=team_season())
    Membership.objects.create(user=ada, team_season=team_season(12346, 2027, "Rebound"))

    assert ada.memberships.count() == 2


def test_deleting_an_account_takes_its_assignments_with_it():
    ada = member()
    Membership.objects.create(user=ada, team_season=team_season())

    ada.delete()

    assert not Membership.objects.exists()


def test_deleting_a_team_season_takes_its_assignments_with_it():
    rouages = team_season()
    Membership.objects.create(user=member(), team_season=rouages)

    rouages.delete()

    assert not Membership.objects.exists()
