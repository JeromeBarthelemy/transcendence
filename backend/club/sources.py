"""Keeping the rulebook's copies of the manual and the Q&A current.

A check fetches each source page and compares it with the copy the RAG
searches. A changed page is never swapped in silently: it becomes a
`SourceUpdate` that an admin accepts, and `ask` keeps searching the current
copy until then (club/api/views.py, RuleSourcesView).
"""

import difflib
import hashlib
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import TypedDict
from urllib.error import URLError
from urllib.request import urlopen

from django.utils import timezone

from .models import Document, SourceUpdate
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


class _LinesParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lines: list[str] = []
        self._current: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIP_TAGS:
            self._skip += 1
        elif tag in _BLOCK_TAGS:
            self._break_line()

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
        elif tag in _BLOCK_TAGS:
            self._break_line()

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self._current.append(data)

    def _break_line(self) -> None:
        line = " ".join("".join(self._current).split())
        if line:
            self.lines.append(line)
        self._current = []

    def text(self) -> str:
        self._break_line()
        return "\n".join(self.lines)


def fetch_page(url: str) -> str:
    with urlopen(url, timeout=FETCH_TIMEOUT_SECONDS) as response:
        return response.read().decode(_PAGE_ENCODING)


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _chunkable(source: str, page: str) -> str:
    """The manual is chunked from its HTML markup; the Q&A is chunked from
    plain lines, so its page is reduced to them first."""
    if source == Document.Source.OFFICIAL_QA:
        parser = _LinesParser()
        parser.feed(page)
        return parser.text()
    return page


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
    for document in Document.objects.filter(url__gt="").order_by("-fetched_at", "-id"):
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

    text = _chunkable(document.source, page)
    candidate = _CHUNKER_OF[document.source](text)
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
