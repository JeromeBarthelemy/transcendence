"""The HTTP import indexes real HTML without downloading an embedding model.

Only the embedding calculation is stubbed: decoding, chunking, glossary,
permissions, database writes and pending-update handling run normally.
"""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client

from club.models import Document, Season, SourceUpdate, User
from club.rag import DIMENSIONS, ingest_document
from club.sources import MAX_SOURCE_BYTES, content_hash, latest_documents

from .test_rag import REAL_HTML_EXCERPT, REAL_QA_BOARD_EXCERPT

URL = "https://ftc-resources.firstinspires.org/ftc/game/cm-html/manual.htm"
ENDPOINT = "/api/rules/sources/"


@pytest.fixture(autouse=True)
def embeddings(monkeypatch):
    monkeypatch.setattr(
        "club.rag._embed_many",
        lambda texts, **kwargs: [bytes(DIMENSIONS * 4) for _ in texts],
    )


@pytest.fixture
def admin(client):
    user = User.objects.create_user(
        "admin@club.fr", "Paul", club_role="mentor", is_club_admin=True
    )
    client.force_login(user)
    return user


@pytest.fixture
def season():
    return Season.objects.create(start_year=2026, game_name="BioBuzz")


def html(text=REAL_HTML_EXCERPT, name="manual.html", encoding="utf-8"):
    return SimpleUploadedFile(name, text.encode(encoding), content_type="text/html")


@pytest.mark.parametrize(
    ("source", "text", "encoding", "name"),
    [
        ("game_manual", REAL_HTML_EXCERPT, "cp1252", "manual.HTM"),
        (
            "game_manual",
            "<p>Règle : vérifier l'équipe.</p>",
            "utf-8-sig",
            "manuel.html",
        ),
        ("official_qa", REAL_QA_BOARD_EXCERPT, "utf-8", "qa.html"),
    ],
)
def test_an_admin_uploads_html_and_passages_are_stored(
    client, admin, season, source, text, encoding, name
):
    response = client.post(
        ENDPOINT,
        {
            "source": source,
            "title": "Document officiel",
            "file": html(text, name, encoding),
        },
    )

    assert response.status_code == 201
    document = Document.objects.get()
    assert document.season == season
    assert document.title == "Document officiel"
    assert document.source == source
    assert document.authority == ("binding" if source == "game_manual" else "ruling")
    assert document.chunks.exists()
    assert document.content_hash == content_hash(text)
    assert document.checked_at is None
    assert document.url == ""
    assert latest_documents() == []
    if "Règle" in text:
        assert "Règle : vérifier l'équipe." in document.chunks.get().text
    if source == "official_qa":
        assert all(chunk.reference.startswith("Q") for chunk in document.chunks.all())


def test_upload_with_a_url_does_not_fetch_it_but_enables_future_checks(
    client, admin, season, monkeypatch
):
    def unexpected_fetch(*args):
        pytest.fail("Uploading a file must not fetch its optional citation URL")

    monkeypatch.setattr("club.sources.fetch_page", unexpected_fetch)
    response = client.post(
        ENDPOINT, {"source": "game_manual", "file": html(), "url": URL}
    )

    assert response.status_code == 201
    document = Document.objects.get()
    assert document.title == "manual"
    assert document.url == URL
    assert document.checked_at is None
    assert latest_documents() == [document]


@pytest.mark.parametrize("authenticated", [False, True])
def test_only_an_admin_can_upload(client, season, authenticated):
    if authenticated:
        client.force_login(User.objects.create_user("lina@club.fr", "Lina"))
    response = client.post(ENDPOINT, {"source": "game_manual", "file": html()})

    assert response.status_code == 403
    assert not Document.objects.exists()


def test_upload_requires_csrf(admin, season):
    client = Client(enforce_csrf_checks=True)
    client.force_login(admin)

    response = client.post(ENDPOINT, {"source": "game_manual", "file": html()})

    assert response.status_code == 403
    assert not Document.objects.exists()


@pytest.mark.parametrize(
    ("name", "data", "code"),
    [
        ("manual.pdf", b"%PDF-1.7", "source_file_type"),
        ("manual.txt", b"plain text", "source_file_type"),
        ("manual.html", b"%PDF-1.7", "source_file_content"),
        ("manual.html", b"%PDF-1.7\n<p>Not HTML.</p>", "source_file_content"),
        ("manual.html", b"not an html page", "source_file_content"),
        ("manual.html", b"<p>binary\x00</p>", "source_file_content"),
        ("manual.html", b"<p>" + b"a" * MAX_SOURCE_BYTES, "source_file_size"),
    ],
)
def test_refuses_bad_files_before_indexing(client, admin, season, name, data, code):
    response = client.post(
        ENDPOINT,
        {"source": "game_manual", "file": SimpleUploadedFile(name, data)},
    )

    assert response.status_code == 400
    assert response.json()["file"][0]["code"] == code
    assert not Document.objects.exists()


@pytest.mark.parametrize(
    ("source", "text"),
    [
        ("game_manual", "<html><body></body></html>"),
        ("official_qa", "<p>No answers.</p>"),
    ],
)
def test_a_page_with_no_passages_does_not_replace_the_current_copy(
    client, admin, season, source, text
):
    previous = ingest_document(
        season=season,
        source=source,
        title="Previous",
        text=REAL_HTML_EXCERPT if source == "game_manual" else REAL_QA_BOARD_EXCERPT,
    )
    response = client.post(ENDPOINT, {"source": source, "file": html(text)})

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "no_passage"
    assert list(Document.objects.all()) == [previous]


@pytest.mark.parametrize(
    "url",
    [
        "https://attacker.example/manual.htm",
        "http://ftc-resources.firstinspires.org/manual.htm",
        "https://game-qa.firstinspires.org/boards/2027/FTC/QA",
    ],
)
def test_upload_citation_url_has_the_same_host_restrictions(client, admin, season, url):
    response = client.post(
        ENDPOINT, {"source": "game_manual", "file": html(), "url": url}
    )

    assert response.status_code == 400
    assert response.json()["url"][0]["code"] == "source_not_allowed"
    assert not Document.objects.exists()


def test_import_requires_a_file_or_url(client, admin, season):
    response = client.post(
        ENDPOINT, {"source": "game_manual"}, content_type="application/json"
    )

    assert response.status_code == 400
    assert response.json()["non_field_errors"][0]["code"] == "source_required"


def test_import_requires_a_season(client, admin):
    response = client.post(ENDPOINT, {"source": "game_manual", "file": html()})

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "no_season"


def test_new_copy_keeps_old_passages_but_discards_the_superseded_pending_update(
    client, admin, season
):
    previous = ingest_document(
        season=season,
        source="game_manual",
        title="Previous",
        text=REAL_HTML_EXCERPT,
        url=URL,
    )
    SourceUpdate.objects.create(
        season=season,
        source="game_manual",
        url=URL,
        content_hash="old",
        candidate_text=REAL_HTML_EXCERPT,
        summary={},
    )

    response = client.post(ENDPOINT, {"source": "game_manual", "file": html()})

    assert response.status_code == 201
    assert Document.objects.count() == 2
    assert previous.chunks.exists()
    assert not SourceUpdate.objects.exists()
    assert latest_documents() == []  # Never fall back to the previous copy's URL.
    assert response.json()[0]["pending"] is None
    assert client.post("/api/rules/sources/game_manual/accept/").status_code == 404


def test_failed_embedding_keeps_the_previous_copy_and_pending_update(
    client, admin, season, monkeypatch
):
    previous = ingest_document(
        season=season, source="game_manual", title="Previous", text=REAL_HTML_EXCERPT
    )
    pending = SourceUpdate.objects.create(
        season=season,
        source="game_manual",
        url=URL,
        content_hash="old",
        candidate_text=REAL_HTML_EXCERPT,
        summary={},
    )

    def unavailable(*args, **kwargs):
        raise OSError("embedding unavailable")

    monkeypatch.setattr("club.rag._embed_many", unavailable)
    response = client.post(ENDPOINT, {"source": "game_manual", "file": html()})

    assert response.status_code == 400
    assert list(Document.objects.all()) == [previous]
    assert SourceUpdate.objects.filter(pk=pending.pk).exists()
    assert response.json()["detail"]["code"] == "source_import_failed"
