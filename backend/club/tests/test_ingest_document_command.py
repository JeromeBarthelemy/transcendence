import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from club.models import Document, Season


def season(start_year=2026, game_name="BioBuzz"):
    return Season.objects.create(start_year=start_year, game_name=game_name)


def test_ingesting_an_html_manual_creates_its_chunks(tmp_path):
    season(2026, "BioBuzz")
    path = tmp_path / "manual.htm"
    path.write_text(
        "<p class=RuleNumber-Game><a name=G101></a><b>G101</b> "
        "*Humans, stay off the FIELD during the MATCH.</p>",
        encoding="cp1252",
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


def test_ingesting_a_non_html_manual_is_refused(tmp_path):
    # chunk_manual reads HTML tags, not extracted text: a PDF or a plain
    # .txt would silently ingest as zero chunks (no anchor or heading for
    # it to find) rather than fail loudly, so this is refused up front.
    season(2026, "BioBuzz")
    path = tmp_path / "manual.pdf"
    path.write_bytes(b"%PDF-1.4 not a real pdf, only the extension matters here")

    with pytest.raises(CommandError, match="HTML"):
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


def test_ingesting_a_qa_text_file_is_not_refused(tmp_path):
    # The HTML-only constraint is specific to game_manual (chunk_manual) —
    # official_qa still reads plain text (chunk_qa).
    season(2026, "BioBuzz")
    path = tmp_path / "qa.txt"
    path.write_text("Q1 A question? Ruling: Yes.", encoding="utf-8")

    call_command(
        "ingest_document",
        str(path),
        "--season",
        "2026",
        "--source",
        "official_qa",
        "--title",
        "Q&A officiel",
    )

    document = Document.objects.get(title="Q&A officiel")
    assert document.chunks.exists()


def test_ingesting_a_missing_file_is_refused(tmp_path):
    season(2026, "BioBuzz")

    with pytest.raises(CommandError, match="introuvable"):
        call_command(
            "ingest_document",
            str(tmp_path / "absent.htm"),
            "--season",
            "2026",
            "--source",
            "game_manual",
            "--title",
            "Manuel",
        )


def test_ingesting_for_an_unknown_season_is_refused(tmp_path):
    path = tmp_path / "manual.htm"
    path.write_text("<p>Un texte quelconque.</p>")

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
    path = tmp_path / "empty.htm"
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
