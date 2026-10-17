"""Keeping the rulebook's copy of the game manual current.

A check fetches each source page and compares it with the copy the RAG
searches. A changed page is never swapped in silently: it becomes a
`SourceUpdate` that an admin accepts, and `ask` keeps searching the current
copy until then (club/api/views.py, RuleSourcesView).
"""

import difflib
import hashlib
import re
from dataclasses import dataclass
from http.client import InvalidURL
from pathlib import Path
from typing import TypedDict
from urllib.error import URLError
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, build_opener

from django.core.files.uploadedfile import UploadedFile
from django.utils import timezone

from .models import Document, Season, SourceUpdate
from .rag import _CHUNKER_OF, ingest_document

FETCH_TIMEOUT_SECONDS = 30
MAX_SOURCE_BYTES = 5 * 1024 * 1024
# A change list longer than this is summarised, not enumerated in full.
REFERENCES_SHOWN = 20

# The manual's pages declare windows-1252 in their own markup, and the copy
# already ingested was read that way too: decoding differently would make
# every page look changed. The Q&A board is a different site entirely, and
# declares utf-8 (its own `<meta charset>`). Public: `ingest_document.py`
# reads the same mapping to decode a file read straight off disk the same
# way a fetched page is.
PAGE_ENCODING_OF: dict[str, str] = {
    Document.Source.GAME_MANUAL: "cp1252",
    Document.Source.OFFICIAL_QA: "utf-8",
}


class ChangeSummary(TypedDict):
    added: int
    removed: int
    changed: int
    references: list[str]
    references_total: int


# Only FIRST's own page for that source is read: an administrator's URL is
# otherwise a way to make the server fetch any address it can reach, or to
# file one source's document under the other's host.
_HOST_OF: dict[str, str] = {
    Document.Source.GAME_MANUAL: "ftc-resources.firstinspires.org",
    Document.Source.OFFICIAL_QA: "game-qa.firstinspires.org",
}
ALLOWED_HOSTS = frozenset(_HOST_OF.values())


def check_source_url(url: str, source: str) -> str:
    """The URL when it points at `source`'s own site, else the reason it does not."""
    parts = urlsplit(url)
    if parts.scheme != "https":
        raise ValueError("L'adresse doit commencer par https://.")
    if parts.hostname != _HOST_OF[source]:
        raise ValueError("Cette adresse ne correspond pas à cette source.")
    return url


class _FirstRedirects(HTTPRedirectHandler):
    """Every hop is held to its source's own host, not only the URL the
    administrator gave: a permitted page can otherwise redirect the server
    anywhere, or onto the other source's site."""

    def __init__(self, source: str) -> None:
        super().__init__()
        self._source = source

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_source_url(newurl, self._source)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_page(url: str, source: str) -> str:
    opener = build_opener(_FirstRedirects(source))
    with opener.open(url, timeout=FETCH_TIMEOUT_SECONDS) as response:
        return response.read().decode(PAGE_ENCODING_OF[source])


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def summarize(
    current: list[tuple[str, str]], candidate: list[tuple[str, str]]
) -> ChangeSummary:
    """What changed between two lists of `(reference, passage)`, counted in
    passages, with the references of every passage touched. Deterministic on
    purpose: an admin reads it, and no model is asked to guess at it."""
    matcher = difflib.SequenceMatcher(
        a=[passage for _, passage in current],
        b=[passage for _, passage in candidate],
        autojunk=False,
    )
    added = removed = changed = 0
    references: list[str] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if tag == "insert":
            added += j2 - j1
        elif tag == "delete":
            removed += i2 - i1
        else:
            changed += max(i2 - i1, j2 - j1)
        for reference, _ in [*current[i1:i2], *candidate[j1:j2]]:
            if reference and reference not in references:
                references.append(reference)
    return {
        "added": added,
        "removed": removed,
        "changed": changed,
        "references": references[:REFERENCES_SHOWN],
        "references_total": len(references),
    }


def _is_empty(summary: ChangeSummary) -> bool:
    return not (summary["added"] or summary["removed"] or summary["changed"])


def latest_documents() -> list[Document]:
    """The copy `ask` searches, per season and source, and only those with a
    page to check against — the manual and the Q&A board alike."""
    latest: dict[tuple[int, str], Document] = {}
    documents = Document.objects.all()
    for document in documents.order_by("-fetched_at", "-id"):
        latest.setdefault((document.season_id, document.source), document)
    # An uploaded replacement without a URL must not resurrect checks of
    # an older copy's page, which could overwrite the uploaded version.
    return [document for document in latest.values() if document.url]


@dataclass(frozen=True)
class CheckOutcome:
    document: Document
    status: str  # "unchanged", "pending" or "error"
    detail: str = ""


def _forget_pending(document: Document) -> None:
    """The page is back to what is searched: a change waiting from before is
    no longer a change, and must not be accepted over the current copy."""
    SourceUpdate.objects.filter(season=document.season, source=document.source).delete()


def check_document(document: Document) -> CheckOutcome:
    try:
        page = fetch_page(document.url, document.source)
    except (URLError, OSError, ValueError, InvalidURL) as error:
        return CheckOutcome(document, "error", str(error))

    digest = content_hash(page)
    now = timezone.now()
    if digest == document.content_hash:
        Document.objects.filter(pk=document.pk).update(checked_at=now)
        _forget_pending(document)
        return CheckOutcome(document, "unchanged")

    text = page
    chunked = _CHUNKER_OF[document.source](text)
    if not chunked:
        return CheckOutcome(
            document, "error", "la page ne contient aucun passage à indexer"
        )
    # The anchor plays no part in this diff: it says where a passage links
    # to, not whether its own content changed.
    candidate = [(reference, passage) for reference, _, passage in chunked]
    current = list(document.chunks.values_list("reference", "text"))
    summary = summarize(current, candidate)
    if _is_empty(summary):
        # The bytes changed, the rulebook did not: adopt the new hash and move on.
        Document.objects.filter(pk=document.pk).update(
            content_hash=digest, checked_at=now
        )
        _forget_pending(document)
        return CheckOutcome(document, "unchanged")

    SourceUpdate.objects.update_or_create(
        season=document.season,
        source=document.source,
        defaults={
            "url": document.url,
            "content_hash": digest,
            "candidate_text": text,
            "summary": summary,
            "detected_at": now,
        },
    )
    Document.objects.filter(pk=document.pk).update(checked_at=now)
    return CheckOutcome(document, "pending")


def check_all(documents: list[Document]) -> list[CheckOutcome]:
    return [check_document(document) for document in documents]


def accept_update(update: SourceUpdate) -> Document:
    """Ingests the fetched text as the new copy. `ask` searches the newest
    `Document` per source, so the previous one is no longer searched, but its
    passages stay in place for the citations already given."""
    previous = (
        Document.objects.filter(season=update.season, source=update.source)
        .order_by("-fetched_at", "-id")
        .first()
    )
    document = ingest_document(
        season=update.season,
        source=update.source,
        title=previous.title if previous else update.get_source_display(),
        text=update.candidate_text,
        url=update.url,
        content_hash=update.content_hash,
    )
    update.delete()
    return document


class NoPassage(ValueError):
    pass


def read_source_upload(file: UploadedFile, source: str) -> str:
    """Read HTML as data, never serve or execute it. UTF-8 exports and the
    manual's original Windows-1252 copy both occur on administrators' disks."""
    data = file.read(MAX_SOURCE_BYTES + 1)
    if len(data) > MAX_SOURCE_BYTES:
        raise ValueError("Le fichier ne doit pas dépasser 5 Mio.")
    if data.lstrip().startswith(b"%PDF-"):
        raise ValueError("Choisissez le HTML officiel, pas un PDF renommé.")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = data.decode(PAGE_ENCODING_OF[source])
        except UnicodeDecodeError as error:
            raise ValueError("Le fichier HTML est illisible.") from error
    if "\x00" in text or not re.search(
        r"<(?:html|body|p|div|script|h[1-6])\b", text, re.IGNORECASE
    ):
        raise ValueError("Le fichier doit contenir une page HTML officielle.")
    return text


def upload_source(
    *,
    season: Season,
    source: str,
    file: UploadedFile,
    text: str,
    title: str = "",
    url: str = "",
) -> Document:
    if not _CHUNKER_OF[source](text):
        raise NoPassage("le fichier ne contient aucun passage à indexer")
    return ingest_document(
        season=season,
        source=source,
        title=title or Path(file.name or "document.html").stem[:200],
        text=text,
        url=url,
        content_hash=content_hash(text),
        # Supplying a citation URL does not mean we fetched/checked it.
        checked=False,
    )


def add_source(*, season: Season, source: str, url: str, title: str = "") -> Document:
    """A new copy of the manual or the Q&A board, from its page. Its URL is
    kept, so the automatic checks follow it from now on."""
    page = fetch_page(url, source)
    if not _CHUNKER_OF[source](page):
        raise NoPassage("la page ne contient aucun passage à indexer")
    title = (
        title
        or Path(unquote(urlsplit(url).path)).stem[:200]
        or Document.Source(source).label
    )
    return ingest_document(
        season=season,
        source=source,
        title=title,
        text=page,
        url=url,
        content_hash=content_hash(page),
    )
