"""The rulebook RAG: ingesting a source into passages, and answering a
question against them, ranked by how much the source may be trusted
(docs/fieldnotes.html, "Le RAG règlement").

No vector database: a manual is a few thousand passages, and comparing
them by a plain dot product is a NumPy call, not an infrastructure
decision (docs/fieldnotes.html's own "plafond assumé" names exactly this:
"pgvector, sqlite-vec ou un tableau NumPy").

What *is* worth an infrastructure decision is the vector itself:
`intfloat/multilingual-e5-base`, run through `fastembed` (ONNX Runtime) —
a 278M-parameter, CPU-only, locally-cached model trained across 100+
languages including French and English, built specifically for retrieval
(its own card asks for the "query: "/"passage: " prefixes used below). A
word-hash cannot close two real gaps: a plural the manual writes one way
and a question the other ("robots" and "ROBOT" hash to different buckets,
not the same word), and a question asked in French about a manual FIRST
publishes only in English, where a real answer shares no token with its
source at all — both are gaps of *meaning*, which only a real embedding
closes. It runs once per ingestion and once per question, entirely
offline after its one-time download — nothing about the club's "tout
tourne en local" posture changes, only what `embed()` does inside.
"""

import json
import logging
import re
import struct
from collections.abc import Callable
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import numpy as np
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from fastembed import TextEmbedding
from fastembed.common.model_description import ModelSource, PoolingType

from .generation import GenerationError, generate_answer
from .models import (
    Chunk,
    Document,
    GlossaryTerm,
    QueryCitation,
    RuleQuery,
    Season,
    User,
)

# fastembed does not carry multilingual-e5-base in its own catalogue (only
# the larger e5-large) — this registers the same model as a custom one,
# pointing at a third-party ONNX export rather than intfloat's own repo,
# which only publishes PyTorch weights.
#
# fp32 (`model.onnx`), not the same export's int8-quantized file: measured
# against the real manual and the same question set MIN_SCORE below is
# calibrated on, quantized answers measurably fewer real questions and
# blocks fewer off-topic ones — a real accuracy cost, not a rounding
# difference.
#
# Unpinned: `ModelSource` below takes only a repo id, and fastembed does
# not accept or forward a revision through to its own HuggingFace download
# either, so a fresh install always resolves to whatever this repo is at
# install time. If it changes or disappears, ingestion either fails
# outright or silently answers from a different model than the one
# MIN_SCORE was calibrated on.
MODEL_NAME = "nixiesearch/multilingual-e5-base-onnx"
# Registration is a class-level side effect, not a per-instance one — a
# second call for the same name raises, which a module reimported more
# than once in the same process (an autoreloader, a test collector) would
# otherwise hit.
if MODEL_NAME not in {m["model"] for m in TextEmbedding.list_supported_models()}:
    TextEmbedding.add_custom_model(
        model=MODEL_NAME,
        pooling=PoolingType.MEAN,
        normalization=True,
        sources=ModelSource(hf=MODEL_NAME),
        dim=768,
        model_file="model.onnx",
    )
# fastembed defaults to a temp directory, gone on the next reboot — not
# "downloaded once", the whole point of caching it at all.
FASTEMBED_CACHE_DIR = str(Path(settings.BASE_DIR) / ".cache" / "fastembed")
DIMENSIONS = 768
# How many passages a question keeps. A narrower cut (tried down to 1,
# then 3) saves real time but costs something worse: with only the top
# few candidates, the right passage sometimes isn't among them, and the
# model answers fluently from whatever it got anyway — a wrong-content
# answer with a technically real citation, which a reference check alone
# cannot catch, because nothing about the reference is wrong. 10 keeps
# that risk low. GENERATION_MAX_PASSAGE_CHARS (club/generation.py) does
# not cut what reaches the model short for this either: a cut passage,
# not the prompt's length, was behind some of the worst wrong-content
# answers, and correctness is worth more here than speed.
TOP_K = 10
# How weak a match may be and still count as one — cosine similarity
# between two unit vectors, bounded in [-1, 1]. Calibrated against the
# real BioBuzz manual, chunked by `chunk_manual` from FIRST's own HTML
# export (364 passages, TU02) on 90 real questions spanning every section
# plus 10 off-topic controls: real questions scored 0.808-0.919, the 10
# off-topic controls 0.738-0.808. 0.81 is the first threshold, scanning up
# from 0.70, where all 10 off-topic controls fall below it, at the cost of
# one real question out of 90.
#
# The ranges are not comfortably separated, they overlap at the boundary:
# the weakest real question and the strongest off-topic one both score
# 0.808 — tied to the thousandth. Read 89/90 as what held on this one
# question set, not as a robust guarantee: a different off-topic phrasing
# scoring 0.809 would slip through, and re-chunking the source alone has
# moved this boundary before, even when the threshold value didn't.
MIN_SCORE = 0.81

AUTHORITY_OF: dict[str, str] = {
    Document.Source.GAME_MANUAL: Document.Authority.BINDING,
    Document.Source.OFFICIAL_QA: Document.Authority.RULING,
}

# Read by whoever asks, when nothing clears MIN_SCORE: the system's own
# refusal, not a guess dressed up as one.
NO_ANSWER = (
    "Le manuel et le Q&A officiel ne disent rien d'assez sûr sur cette "
    "question. Consultez le Q&A officiel de FIRST pour une réponse engageante."
)

# Read when something *did* clear MIN_SCORE but generate_answer still
# couldn't produce a sentence — a silent "" here would leave citations
# on screen with nothing explaining why no sentence sits above them. The
# passages below answer either way; this only says why no sentence does
# this time, same as NO_ANSWER does for the no-passage case.
GENERATION_UNAVAILABLE = (
    "La réponse rédigée n'a pas pu être produite cette fois. Les passages "
    "ci-dessous répondent tout de même à la question."
)

logger = logging.getLogger(__name__)

_model: TextEmbedding | None = None


def _get_model() -> TextEmbedding:
    """Loaded once per process, not per call: construction reads the model
    off disk (or downloads it once, the only time this module needs a
    network), which every question and every ingested passage would
    otherwise pay for again."""
    global _model
    if _model is None:
        _model = TextEmbedding(model_name=MODEL_NAME, cache_dir=FASTEMBED_CACHE_DIR)
    return _model


def embed(text: str, *, is_query: bool = False) -> bytes:
    """A fixed-size vector, packed — what gets stored, and what a question
    is turned into to compare against what's stored. E5 is asymmetric by
    design: a question and the passage that answers it are encoded
    differently (its own model card asks for these exact prefixes), so the
    same call cannot serve both without saying which one this text is."""
    return _embed_many([text], is_query=is_query)[0]


def _embed_many(texts: list[str], *, is_query: bool) -> list[bytes]:
    """Batched: one forward pass for every passage in a document rather
    than one per passage, which is what makes ingesting a 173-page manual
    take seconds instead of minutes on a CPU."""
    model = _get_model()
    prefix = "query" if is_query else "passage"
    vectors = model.embed([f"{prefix}: {text}" for text in texts])
    return [
        struct.pack(f"{DIMENSIONS}f", *vector.astype(np.float32)) for vector in vectors
    ]


def _unpack(blob: bytes | memoryview) -> np.ndarray:
    """A zero-copy read on SQLite, which is what `BinaryField` always hands
    back here: `embed` packs native `float`s, the same layout a NumPy
    `float32` array already is, so this is a reinterpretation of the bytes
    already in memory, not a conversion. `bytes(blob)` only copies on the
    other backend Django's stub allows for, never taken here."""
    return np.frombuffer(bytes(blob), dtype=np.float32)


# The manual's own rule anchor, planted by Word's HTML export exactly once,
# at the paragraph where the rule opens ("<a name=G101></a><b>G101 ...") —
# a cross-reference to the same rule mid-sentence gets a different markup
# instead (`<span class=CrossRefChar>G410</span>`, no anchor), and Word
# bookmark names are unique, so this can never fire twice for one rule.
_RULE_ANCHOR = re.compile(r"^[IEAGRTLC]\d{3}$")
# A section heading's own number ("11.1 Personal Safety", "11 Game Rules
# (G)") — unlike in a PDF, nothing here needs telling apart from a table of
# contents: the export gives the ToC its own paragraph style, never a real
# <h1>-<h3>, so anything reaching this pattern already is a real heading.
_SECTION_NUMBER = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){0,3})(?:\s|$)")
# What a heading actually jumps to (#134): Word plants several of these in
# a row right before a heading's own text, one of them wrapping it — a
# cross-reference bookmark (`_Ref…`) sits among them too, but only `_Toc…`
# ones are ever a real jump target. Any one found is as good as another;
# the first is kept, since a later Team Update is more likely to add a new
# one than to remove the first.
_TOC_ANCHOR = re.compile(r"^_Toc\d+$")
# The glossary is always the manual's own last chapter (#136) — FIRST
# renumbers every chapter each season, but never its title, so this reads
# the chapter by that rather than by a number that moves.
_GLOSSARY_HEADING = "Glossary"
# Word never opens a new passage anywhere but one of these four tags —
# everything else (`div`, `span`, `table`, `b`...) is transparent, its text
# still collected, just under whichever of these last opened.
_HTML_BLOCK_TAGS = frozenset({"p", "h1", "h2", "h3", "tr", "li"})
_HTML_SKIP_TAGS = frozenset({"style", "script", "head"})
# e5-base reads at most 512 tokens; a word runs close enough to a token in
# this manual's plain English that a rule this long — a handful, mostly in
# Motors & Actuators and Power Distribution — is re-split by word count
# rather than measured token by token.
MAX_WORDS_PER_PASSAGE = 350


def _collapse_whitespace(parts: list[str]) -> str:
    """Word's own export wraps at arbitrary points and pads with
    non-breaking spaces — shared by every parser below so one passage's
    whitespace never tells it apart from another's."""
    return re.sub(r"\s+", " ", "".join(parts).replace("\xa0", " ")).strip()


def _finalize_chunks(
    open_chunks: list[tuple[str, str, list[str]]],
) -> list[tuple[str, str, str]]:
    """Shared by chunk_rules and chunk_qa: a chunk longer than the word
    budget is re-split under the same reference and anchor rather than
    truncated."""
    passages: list[tuple[str, str, str]] = []
    for reference, anchor, lines in open_chunks:
        words = " ".join(lines).split()
        for start in range(0, len(words), MAX_WORDS_PER_PASSAGE):
            passages.append(
                (
                    reference,
                    anchor,
                    " ".join(words[start : start + MAX_WORDS_PER_PASSAGE]),
                )
            )
    return passages


class _ManualParser(HTMLParser):
    """Walks FIRST's own HTML export of the manual (a filtered Word
    document, ftc-resources.firstinspires.org/ftc/game/cm-html/...) into
    `(reference, anchor, is_heading, text)` blocks in reading order.
    Nothing here guesses at a reference from wrapped plain text the way
    the PDF version had to: a rule's own anchor, or a heading's own tag,
    says outright where one passage ends and the next begins (see
    `chunk_manual`)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[tuple[str | None, str, bool, str]] = []
        self._skip_depth = 0
        self._heading_depth = 0
        self._in_block = False
        self._block_ref: str | None = None
        self._block_anchor: str | None = None
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _HTML_SKIP_TAGS:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag == "a":
            name = dict(attrs).get("name") or ""
            if _RULE_ANCHOR.fullmatch(name):
                self._block_ref = name
            elif self._block_anchor is None and _TOC_ANCHOR.fullmatch(name):
                self._block_anchor = name
            return
        if tag in _HTML_BLOCK_TAGS:
            self._in_block = True
            self._buffer = []
        if tag in ("h1", "h2", "h3"):
            self._heading_depth += 1

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        if tag in _HTML_SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._skip_depth:
            return
        if tag in _HTML_BLOCK_TAGS:
            self._flush()
            self._in_block = False
        if tag in ("h1", "h2", "h3"):
            self._heading_depth = max(0, self._heading_depth - 1)

    def handle_data(self, data: str) -> None:
        if self._skip_depth or not self._in_block:
            return
        self._buffer.append(data)

    def _flush(self) -> None:
        text = _collapse_whitespace(self._buffer)
        self._buffer = []
        if text:
            is_heading = bool(self._heading_depth)
            if is_heading:
                match = _SECTION_NUMBER.match(text)
                reference = match.group(1) if match else None
                anchor = self._block_anchor or ""
            else:
                reference = self._block_ref
                anchor = reference or ""
            self.blocks.append((reference, anchor, is_heading, text))
        self._block_ref = None
        self._block_anchor = None

    def close(self) -> None:
        self._flush()
        super().close()


def chunk_manual(html_text: str) -> list[tuple[str, str, str]]:
    """One passage per rule or numbered section, not a sliding word window
    over extracted text: the manual is built on these, and a passage cut
    across them couldn't say which one it was quoting.

    Reads FIRST's own HTML export: every rule carries its own anchor,
    planted nowhere else in the document, and every heading already is a
    real `<h1>`-`<h3>`, never confused with the table of contents (its
    own, differently tagged, paragraphs) — see `_ManualParser`.

    Returns `(reference, anchor, passage)` triples; `reference` and
    `anchor` are both "" for whatever precedes the first recognised rule
    or section — front matter, kept rather than guessed at or dropped.

    A numbered heading with nothing of its own before the next one opens
    — "11.4.4 ROBOT", a subsection title and nothing else, 31 of 364 on
    the real manual (#134) — is dropped rather than kept as a citation
    that would only ever point to its own heading text: a student citing
    it would learn nothing a plain heading on the screen hadn't already
    said.

    Nothing from the glossary chapter onward becomes a chunk (#136): its
    table has no reference of its own, and `parse_glossary` reads it
    properly instead."""
    parser = _ManualParser()
    parser.feed(html_text)
    parser.close()

    blocks = parser.blocks
    for index, (_, _, is_heading, text) in enumerate(blocks):
        if is_heading and _GLOSSARY_HEADING in text:
            blocks = blocks[:index]
            break

    open_chunks: list[tuple[str, str, bool, list[str]]] = []
    for reference, anchor, is_heading, text in blocks:
        if reference is not None:
            open_chunks.append((reference, anchor, is_heading, [text]))
        elif open_chunks:
            open_chunks[-1][3].append(text)
        else:
            open_chunks.append(("", "", False, [text]))

    kept = [
        (reference, anchor, lines)
        for reference, anchor, is_heading, lines in open_chunks
        if not (is_heading and len(lines) == 1)
    ]
    return _finalize_chunks(kept)


class _GlossaryParser(HTMLParser):
    """Walks the manual's HTML export for its own glossary table (#136):
    a plain two-column (Term, Definition) table under a heading titled
    exactly "Glossary". `td` is a block of its own here, unlike in
    `_ManualParser` — reading a cell at a time is the only way to keep a
    term apart from its own definition, which the rest of this module
    has no reason to care about.

    Everything before that heading, and anything past its one table's
    own close, is ignored — including a nested table, if a future Team
    Update ever adds one: real as of this season, the table is flat."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.terms: list[tuple[str, str]] = []
        self._skip_depth = 0
        self._heading_depth = 0
        self._past_heading = False
        self._in_table = False
        self._done = False
        self._row_index = -1
        self._in_cell = False
        self._row_cells: list[str] = []
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _HTML_SKIP_TAGS:
            self._skip_depth += 1
            return
        if self._done or self._skip_depth:
            return
        if tag in ("h1", "h2", "h3"):
            self._heading_depth += 1
            self._buffer = []
        elif tag == "table" and self._past_heading and not self._in_table:
            self._in_table = True
            self._row_index = -1
        elif self._in_table and tag == "tr":
            self._row_index += 1
            self._row_cells = []
        elif self._in_table and tag == "td":
            self._in_cell = True
            self._buffer = []

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        if tag in _HTML_SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._done or self._skip_depth:
            return
        if tag in ("h1", "h2", "h3"):
            self._heading_depth = max(0, self._heading_depth - 1)
            text = _collapse_whitespace(self._buffer)
            self._buffer = []
            if _GLOSSARY_HEADING in text:
                self._past_heading = True
        elif self._in_table and tag == "td" and self._in_cell:
            self._row_cells.append(_collapse_whitespace(self._buffer))
            self._in_cell = False
            self._buffer = []
        elif self._in_table and tag == "tr":
            # Row 0 is always the table's own header ("Term", "Definition").
            if self._row_index > 0 and len(self._row_cells) == 2:
                term, definition = self._row_cells
                if term and definition:
                    self.terms.append((term, definition))
        elif self._in_table and tag == "table":
            self._in_table = False
            self._done = True

    def handle_data(self, data: str) -> None:
        if self._skip_depth or self._done:
            return
        if self._heading_depth or self._in_cell:
            self._buffer.append(data)


def parse_glossary(html_text: str) -> list[tuple[str, str]]:
    """The manual's own glossary (#136): `(term, definition)` pairs read
    straight off its table, in reading order — term and definition kept
    apart, with a clear boundary a citation could show, rather than
    folded into a passage built for rules, not for this. A student picks
    a term here by its own name, before they have a question's rest of
    the words yet."""
    parser = _GlossaryParser()
    parser.feed(html_text)
    parser.close()
    return parser.terms


# A board answer is written through a rich-text editor, which renders a
# paragraph, a list item or a line break as visibly separate text, never
# running two words at their own boundary together — dropping the tag
# without keeping that boundary as a space would glue them instead
# ("wall?Only its intake.").
_PLAIN_TEXT_BREAK_TAGS = frozenset({"p", "li", "div", "br"})


class _PlainText(HTMLParser):
    """Strips the tags from one rich-text fragment — a board question or
    answer, both written through the same editor — keeping only the
    words: neither carries a reference or a heading of its own to
    track, unlike the manual's own markup."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _PLAIN_TEXT_BREAK_TAGS:
            self._parts.append(" ")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        if tag in _PLAIN_TEXT_BREAK_TAGS:
            self._parts.append(" ")

    def handle_data(self, data: str) -> None:
        self._parts.append(data)

    def text(self) -> str:
        return _collapse_whitespace(self._parts)


def _plain_text(html_fragment: str) -> str:
    parser = _PlainText()
    parser.feed(html_fragment)
    parser.close()
    return parser.text()


_BOARD_DATA_MARKER = "Object.assign(window, "


def _board_data(html_text: str) -> dict[str, Any] | None:
    """The board hands its own page this way to its own script, not
    through a separate endpoint — reading it here needs no request of
    its own. `raw_decode` rather than a regex for the object's own
    extent: a `}` inside a question's or an answer's own rich text
    would otherwise end the match early."""
    start = html_text.find(_BOARD_DATA_MARKER)
    if start == -1:
        return None
    try:
        data, _ = json.JSONDecoder().raw_decode(
            html_text, start + len(_BOARD_DATA_MARKER)
        )
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def chunk_qa(html_text: str) -> list[tuple[str, str, str]]:
    """One passage per answered question on FIRST's own live Q&A board
    (game-qa.firstinspires.org). A question still waiting for one is
    shown on the board too, but cited from nothing yet, so it is never
    read into a passage here.

    Returns `(reference, anchor, passage)` triples exactly like
    `chunk_manual`, so a citation is shown the same way regardless of
    source — "Q44" alongside "G420". `anchor` is always "": a citation
    does not yet link anywhere of its own on the board, only to its
    text."""
    data = _board_data(html_text)
    if data is None:
        return []

    open_chunks: list[tuple[str, str, list[str]]] = []
    for question in data.get("questions", []):
        answer = question.get("answer")
        number = question.get("number")
        if question.get("status") != "ANSWERED" or not answer or number is None:
            continue
        reference = f"Q{number}"
        text = " ".join(
            part
            for part in (
                _plain_text(question.get("title", "")),
                _plain_text(question.get("content", "")),
                _plain_text(answer.get("content", "")),
            )
            if part
        )
        open_chunks.append((reference, "", [text]))

    return _finalize_chunks(open_chunks)


# Dispatched on ingestion: a manual and the Q&A board are structured
# differently enough (§ above) that neither chunker reads the other's
# source correctly — both read HTML only, never a PDF or plain text.
# `ingest_document.py` refuses anything else up front rather than let
# this dispatch feed one in silently.
_CHUNKER_OF: dict[str, Callable[[str], list[tuple[str, str, str]]]] = {
    Document.Source.GAME_MANUAL: chunk_manual,
    Document.Source.OFFICIAL_QA: chunk_qa,
}


def ingest_document(
    *,
    season: Season,
    source: str,
    title: str,
    text: str,
    url: str = "",
    content_hash: str = "",
) -> Document:
    """All or nothing where it counts: a document without its passages
    would never be found, and passages without their document would cite
    nothing — but chunking and embedding 397 passages takes tens of
    seconds, and `transaction_mode: "IMMEDIATE"` (config/settings.py)
    means an open transaction holds SQLite's write lock for as long as it
    stays open. Only the two writes below are wrapped in one; running this
    command during a workshop must not hold up everyone else's saves for
    the length of an ingestion.

    `authority` is read off `source`, never asked for on its own — a
    typo could otherwise file the Q&A as binding. Chunked by `_CHUNKER_OF`:
    a manual and the Q&A board are structured too differently for one
    chunker to read both correctly (see `chunk_manual`, `chunk_qa`). A
    manual also carries its own glossary (#136), read the same way, in
    the same transaction — not a `Chunk`, so not chunked or embedded."""
    passages = _CHUNKER_OF[source](text)
    embeddings = _embed_many([passage for _, _, passage in passages], is_query=False)
    glossary = parse_glossary(text) if source == Document.Source.GAME_MANUAL else []
    with transaction.atomic():
        document = Document.objects.create(
            season=season,
            source=source,
            authority=AUTHORITY_OF[source],
            title=title,
            url=url,
            content_hash=content_hash,
            checked_at=timezone.now() if content_hash else None,
        )
        Chunk.objects.bulk_create(
            Chunk(
                document=document,
                ordinal=ordinal,
                reference=reference,
                anchor=anchor,
                text=passage,
                embedding=embedding,
            )
            for ordinal, ((reference, anchor, passage), embedding) in enumerate(
                zip(passages, embeddings), start=1
            )
        )
        GlossaryTerm.objects.bulk_create(
            GlossaryTerm(
                document=document, ordinal=ordinal, term=term, definition=definition
            )
            for ordinal, (term, definition) in enumerate(glossary, start=1)
        )
    return document


def glossary_for(season: Season) -> list[GlossaryTerm]:
    """The current season's glossary (#136), read off its latest ingested
    manual — the same "latest document per source" `ask` itself
    searches, so a newer Team Update's terms replace the old ones the
    moment it is ingested, same as its passages do."""
    document = (
        Document.objects.filter(season=season, source=Document.Source.GAME_MANUAL)
        .order_by("-fetched_at", "-id")
        .first()
    )
    if document is None:
        return []
    return list(document.glossary_terms.order_by("ordinal"))


# Where a citation is quoted from, before how well it scored: the manual
# is explicit that it takes precedence over the Q&A (§1.7.4), so a binding
# passage is always quoted ahead of a ruling one that merely scored
# higher, and score only breaks ties within the same authority.
_AUTHORITY_RANK: dict[str, int] = {
    Document.Authority.BINDING: 0,
    Document.Authority.RULING: 1,
}


def ask(question: str, season: Season, asker: User) -> RuleQuery:
    """The passages closest to the question, for this season only — the
    game changes every year, and a rule from last season's manual is not
    a rule — and an answer, in English, written only from them. `answer`
    holds the system's own refusal when none cleared `MIN_SCORE`, and
    nothing is generated for that case: with only the manual and the Q&A
    left as sources, a citation existing at all already means it came
    from one of the two, but no citation means there is nothing to write
    from either. A model that cannot be reached, or answers with nothing
    readable, leaves `answer` as `GENERATION_UNAVAILABLE` instead of
    failing the question: the citations still stand on their own under
    it, with a sentence saying why no generated one sits above them this
    time — a silent "" here would leave a student reading only citations
    with no way to tell that apart from the question simply having a
    less certain source.

    Only the latest `Document` per (season, source) is searched: FIRST
    republishes the manual with every Team Update (§1.7.3), and citing an
    amended rule alongside its own superseded predecessor would leave a
    student unsure which to trust — until proper versioning settles that,
    the old one is simply not searched.

    Read, embedded and (when there is something to cite) generated before
    the transaction opens, not inside it: with `transaction_mode:
    "IMMEDIATE"` (config/settings.py), an open transaction holds SQLite's
    write lock for its whole duration, and a generation call alone can run
    into the tens of seconds — holding that lock for every other save in
    the app to wait behind the length of an answer. Only the two writes
    below need one.

    Every match above `MIN_SCORE` is kept and sorted by (authority, score)
    before being cut to `TOP_K` — never the reverse: cutting to the
    top-`TOP_K` by score first could drop a binding passage that scored
    lower than five Q&A ones, which is exactly what the manual's own
    precedence over the Q&A (§1.7.4) rules out."""
    documents = Document.objects.filter(season=season).order_by("-fetched_at", "-id")
    latest_by_source: dict[str, Document] = {}
    for document in documents:
        latest_by_source.setdefault(document.source, document)

    if not latest_by_source:
        # Distinct from NO_ANSWER on purpose: nothing has been searched at
        # all, so saying the manual "doesn't say" would blame a source
        # that was never given the chance to.
        return RuleQuery.objects.create(
            asker=asker,
            question=question,
            answer=f"Le manuel de la saison {season.label} n'est pas encore chargé.",
        )

    chunks = list(
        Chunk.objects.filter(document__in=latest_by_source.values()).select_related(
            "document"
        )
    )
    matches: list[tuple[float, Chunk]] = []
    if chunks:
        matrix = np.stack([_unpack(chunk.embedding) for chunk in chunks])
        query_vector = _unpack(embed(question, is_query=True))
        scores = matrix @ query_vector
        matches = sorted(
            (
                (float(score), chunk)
                for score, chunk in zip(scores, chunks)
                if score >= MIN_SCORE
            ),
            key=lambda pair: (_AUTHORITY_RANK[pair[1].document.authority], -pair[0]),
        )[:TOP_K]

    answer = NO_ANSWER
    if matches:
        try:
            answer = generate_answer(question, [chunk for _, chunk in matches])
        except GenerationError as error:
            logger.warning("rulebook generation failed: %s", error)
            answer = GENERATION_UNAVAILABLE

    with transaction.atomic():
        query = RuleQuery.objects.create(asker=asker, question=question, answer=answer)
        QueryCitation.objects.bulk_create(
            QueryCitation(query=query, chunk=chunk, rank=rank)
            for rank, (_, chunk) in enumerate(matches, start=1)
        )
    return query


def _citation_url(chunk: Chunk) -> str | None:
    """Where "Voir dans le manuel" opens (#134): FIRST's own page, at this
    passage's own spot — a rule's anchor is a real id on that page, a
    section's the Word-generated one its heading carries, neither any
    good without the page they're on (`Document.url`, set at ingestion
    by `--url`; blank for whatever was ingested from a bare file)."""
    document = chunk.document
    if not document.url or not chunk.anchor:
        return None
    return f"{document.url}#{chunk.anchor}"


def serialize(query: RuleQuery) -> dict[str, Any]:
    return {
        "question": query.question,
        "answer": query.answer,
        "citations": [
            {
                "rank": citation.rank,
                "reference": citation.chunk.reference,
                "text": citation.chunk.text,
                "source": citation.chunk.document.source,
                "authority": citation.chunk.document.authority,
                "document_title": citation.chunk.document.title,
                "url": _citation_url(citation.chunk),
            }
            for citation in query.citations.select_related("chunk__document")
        ],
    }
