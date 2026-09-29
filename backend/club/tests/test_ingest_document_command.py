import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from club.models import Document, Season


def season(start_year=2026, game_name="BioBuzz"):
    return Season.objects.create(start_year=start_year, game_name=game_name)


def test_ingesting_a_text_file(tmp_path):
    season(2026, "BioBuzz")
    path = tmp_path / "manual.txt"
    path.write_text(
        "Le robot ne doit jamais dépasser dix-huit pouces.", encoding="utf-8"
    )

    call_command(
        "ingest_document",
        str(path),
        "--season",
        "2026",
        "--source",
        "game_manual",
        "--title",
        "Manuel BioBuzz",
    )

    document = Document.objects.get(title="Manuel BioBuzz")
    assert document.authority == Document.Authority.BINDING
    assert document.chunks.exists()


def test_ingesting_a_missing_file_is_refused(tmp_path):
    season(2026, "BioBuzz")

    with pytest.raises(CommandError, match="introuvable"):
        call_command(
            "ingest_document",
            str(tmp_path / "absent.txt"),
            "--season",
            "2026",
            "--source",
            "game_manual",
            "--title",
            "Manuel",
        )


def test_ingesting_for_an_unknown_season_is_refused(tmp_path):
    path = tmp_path / "manual.txt"
    path.write_text("Un texte quelconque.")

    with pytest.raises(CommandError, match="2099"):
        call_command(
            "ingest_document",
            str(path),
            "--season",
            "2099",
            "--source",
            "game_manual",
            "--title",
            "Manuel",
        )


def test_ingesting_an_empty_file_is_refused(tmp_path):
    season(2026, "BioBuzz")
    path = tmp_path / "empty.txt"
    path.write_text("   \n  ")

    with pytest.raises(CommandError, match="lisible"):
        call_command(
            "ingest_document",
            str(path),
            "--season",
            "2026",
            "--source",
            "game_manual",
            "--title",
            "Manuel",
        )
