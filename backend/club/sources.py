"""Keeping the rulebook's copy of the game manual current.

A check fetches each source page and compares it with the copy the RAG
searches. A changed page is never swapped in silently: it becomes a
`SourceUpdate` that an admin accepts, and `ask` keeps searching the current
copy until then (club/api/views.py, RuleSourcesView).
"""

import difflib
import hashlib
from dataclasses import dataclass
from typing import TypedDict
from urllib.error import URLError
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, build_opener

from django.utils import timezone

from .models import Document, Season, SourceUpdate
from .rag import _CHUNKER_OF, ingest_document

FETCH_TIMEOUT_SECONDS = 30
# A change list longer than this is summarised, not enumerated in full.
REFERENCES_SHOWN = 20

# FIRST's pages declare windows-1252 in their own markup, and the copy already
# ingested was read that way too: decoding differently would make every page
# look changed.
_PAGE_ENCODING = "cp1252"

_BLOCK_TAGS = frozenset({"p", "h1", "h2", "h3", "h4", "tr", "li", "div", "br"})
_SKIP_TAGS = frozenset({"style", "script", "head"})


class ChangeSummary(TypedDict):
    added: int
    removed: int
    changed: int
    references: list[str]
    references_total: int


# Only FIRST's own export is read: an administrator's URL is otherwise a way
# to make the server fetch any address it can reach.
ALLOWED_HOSTS = frozenset({"ftc-resources.firstinspires.org"})


def check_source_url(url: str) -> str:
    """The URL when it points at FIRST's own rulebook, else the reason it does not."""
    parts = urlsplit(url)
    if parts.scheme != "https":
        raise ValueError("L'adresse doit commencer par https://.")
    if parts.hostname not in ALLOWED_HOSTS:
        raise ValueError("Seules les pages de FIRST sont acceptées.")
    return url


class _FirstRedirects(HTTPRedirectHandler):
    """Every hop is held to the allow-list, not only the URL the administrator
    gave: a permitted page can otherwise redirect the server anywhere."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_source_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OPENER = build_opener(_FirstRedirects)


def fetch_page(url: str) -> str:
    with _OPENER.open(url, timeout=FETCH_TIMEOUT_SECONDS) as response:
        return response.read().decode(_PAGE_ENCODING)


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
    page to check against."""
    latest: dict[tuple[int, str], Document] = {}
    manuals = Document.objects.filter(url__gt="", source=Document.Source.GAME_MANUAL)
    for document in manuals.order_by("-fetched_at", "-id"):
        latest.setdefault((document.season_id, document.source), document)
    return list(latest.values())


@dataclass(frozen=True)
class CheckOutcome:
    document: Document
    status: str  # "unchanged", "pending" or "error"
    detail: str = ""


def check_document(document: Document) -> CheckOutcome:
    try:
        page = fetch_page(document.url)
    except (URLError, OSError, ValueError) as error:
        return CheckOutcome(document, "error", str(error))

    digest = content_hash(page)
    now = timezone.now()
    if digest == document.content_hash:
        Document.objects.filter(pk=document.pk).update(checked_at=now)
        return CheckOutcome(document, "unchanged")

    text = page
    candidate = _CHUNKER_OF[document.source](text)
    if not candidate:
        return CheckOutcome(
            document, "error", "la page ne contient aucun passage à indexer"
        )
    current = list(document.chunks.values_list("reference", "text"))
    summary = summarize(current, candidate)
    if _is_empty(summary):
        # The bytes changed, the rulebook did not: adopt the new hash and move on.
        Document.objects.filter(pk=document.pk).update(
            content_hash=digest, checked_at=now
        )
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


def add_source(*, season: Season, source: str, url: str) -> Document:
    """A new copy of the manual, from its page. Its URL is kept, so the
    automatic checks follow it from now on."""
    page = fetch_page(url)
    if not _CHUNKER_OF[source](page):
        raise NoPassage("la page ne contient aucun passage à indexer")
    title = unquote(urlsplit(url).path.rsplit("/", 1)[-1]).removesuffix(".htm")
    return ingest_document(
        season=season,
        source=source,
        title=title,
        text=page,
        url=url,
        content_hash=content_hash(page),
    )
