import pytest
from django.db import IntegrityError

from club.models import Season


def test_two_seasons_cannot_share_a_start_year():
    Season.objects.create(start_year=2026, game_name="BioBuzz")

    with pytest.raises(IntegrityError):
        Season.objects.create(start_year=2026, game_name="Another game")


def test_two_seasons_cannot_share_a_game_name():
    # FIRST never reuses a game name: a duplicate is the same season entered twice.
    Season.objects.create(start_year=2026, game_name="BioBuzz")

    with pytest.raises(IntegrityError):
        Season.objects.create(start_year=2027, game_name="BioBuzz")


def test_seasons_come_out_newest_first():
    Season.objects.create(start_year=2025, game_name="Into the Deep")
    Season.objects.create(start_year=2026, game_name="BioBuzz")
    Season.objects.create(start_year=2024, game_name="Centerstage")

    assert [season.start_year for season in Season.objects.all()] == [2026, 2025, 2024]
