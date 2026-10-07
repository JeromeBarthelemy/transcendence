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
from .models import Chunk, Document, QueryCitation, RuleQuery, Season, User

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
# How many passages a question keeps.
TOP_K = 5
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
# scoring 0.809 would slip through, and this same question set scored the
# boundary at 0.805/0.806 against the PDF-chunked manual (see the commit
# that replaced it) — re-chunking the source moves this line even when the
# threshold value doesn't change.
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


# A running header FIRST repeats on every page of a PDF export ("Section 11
# Game Rules (G) V1 99 of 173"), never part of a Q&A entry itself — dropped
# before `_QA_REFERENCE` gets a chance to misread it.
_RUNNING_HEADER = re.compile(r"^Section \d+ .+ V\d+ \d+ of \d+$")
# A table of contents lists entries in the same "number, title" shape a
# real heading has — what tells them apart in a PDF export is the dot
# leader pypdf keeps between a title and its page number.
_TOC_LEADER = re.compile(r"\.{5,}")
# A Q&A entry, opening a line the same way a rule does ("Q44 Blue robot
# over their gate...", never "...as settled in Q44." mid-sentence, which
# has no space before its punctuation) — FIRST's own public Q&A summary
# (ftc-docs.firstinspires.org/.../ftcqa.html, no login needed; only asking
# a *new* question requires a team account) numbers every entry this way.
_QA_REFERENCE = re.compile(r"^(Q\d{1,4})\s+\*?[A-Z]")

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


def _finalize_chunks(open_chunks: list[tuple[str, list[str]]]) -> list[tuple[str, str]]:
    """Shared by chunk_rules and chunk_qa: a chunk longer than the word
    budget is re-split under the same reference rather than truncated."""
    passages: list[tuple[str, str]] = []
    for reference, lines in open_chunks:
        words = " ".join(lines).split()
        for start in range(0, len(words), MAX_WORDS_PER_PASSAGE):
            passages.append(
                (reference, " ".join(words[start : start + MAX_WORDS_PER_PASSAGE]))
            )
    return passages


class _ManualParser(HTMLParser):
    """Walks FIRST's own HTML export of the manual (a filtered Word
    document, ftc-resources.firstinspires.org/ftc/game/cm-html/...) into
    `(reference, text)` blocks in reading order. Nothing here guesses at a
    reference from wrapped plain text the way the PDF version had to: a
    rule's own anchor, or a heading's own tag, says outright where one
    passage ends and the next begins (see `chunk_manual`)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[tuple[str | None, str]] = []
        self._skip_depth = 0
        self._heading_depth = 0
        self._in_block = False
        self._block_ref: str | None = None
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
        text = re.sub(r"\s+", " ", "".join(self._buffer).replace("\xa0", " ")).strip()
        self._buffer = []
        if text:
            if self._heading_depth:
                match = _SECTION_NUMBER.match(text)
                reference = match.group(1) if match else None
            else:
                reference = self._block_ref
            self.blocks.append((reference, text))
        self._block_ref = None

    def close(self) -> None:
        self._flush()
        super().close()


def chunk_manual(html_text: str) -> list[tuple[str, str]]:
    """One passage per rule or numbered section, not a sliding word window
    over extracted text: the manual is built on these, and a passage cut
    across them couldn't say which one it was quoting.

    Reads FIRST's own HTML export rather than the PDF pypdf used to read:
    the PDF flattens the page into plain lines wherever it happens to wrap,
    and anything shaped like "number, capital letter" at the start of one
    of those lines was misread as a new section — a wrapped table row, a
    cross-reference split across two lines, or a rule ID exported with a
    stray space after its own asterisk all produced a wrong or missing
    citation on the real manual, and each Team Update could reflow the page
    differently. The HTML export needs none of this guessing: every rule
    carries its own anchor, planted nowhere else in the document, and every
    heading already is a real `<h1>`-`<h3>`, never confused with the table
    of contents (its own, differently tagged, paragraphs) — see
    `_ManualParser`.

    Returns `(reference, passage)` pairs; `reference` is "" for whatever
    precedes the first recognised rule or section — front matter, kept
    rather than guessed at or dropped."""
    parser = _ManualParser()
    parser.feed(html_text)
    parser.close()

    open_chunks: list[tuple[str, list[str]]] = []
    for reference, text in parser.blocks:
        if reference is not None:
            open_chunks.append((reference, [text]))
        elif open_chunks:
            open_chunks[-1][1].append(text)
        else:
            open_chunks.append(("", [text]))

    return _finalize_chunks(open_chunks)


def chunk_qa(text: str) -> list[tuple[str, str]]:
    """One passage per Q&A entry, not run through `chunk_manual`: an answer
    references a rule mid-sentence ("this would violate G410"), a shape
    `chunk_manual` would read as a *new* rule opening — reusing it here
    would slice a single entry apart at every rule it happens to mention.
    Runs on the Q&A summary's own numbering instead.

    Returns `(reference, passage)` pairs exactly like `chunk_manual`, so a
    citation is shown the same way regardless of source — "Q44" alongside
    "G420" — rather than adding a field only one source's citations would
    ever use."""
    open_chunks: list[tuple[str, list[str]]] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or _RUNNING_HEADER.match(line) or _TOC_LEADER.search(line):
            continue
        match = _QA_REFERENCE.match(line)
        if match:
            open_chunks.append((match.group(1), [line]))
        elif open_chunks:
            open_chunks[-1][1].append(line)
        else:
            open_chunks.append(("", [line]))

    return _finalize_chunks(open_chunks)


# Dispatched on ingestion: a Q&A document and a manual are structured
# differently enough (§ above) that neither chunker reads the other's
# source correctly. `chunk_manual` also only reads HTML, never a PDF (see
# its own docstring) — `ingest_document.py` refuses a PDF for the manual
# rather than let this dispatch feed it one silently.
_CHUNKER_OF: dict[str, Callable[[str], list[tuple[str, str]]]] = {
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
    a manual and a Q&A summary are structured too differently for one
    chunker to read both correctly (see `chunk_manual`, `chunk_qa`)."""
    passages = _CHUNKER_OF[source](text)
    embeddings = _embed_many([passage for _, passage in passages], is_query=False)
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
                text=passage,
                embedding=embedding,
            )
            for ordinal, ((reference, passage), embedding) in enumerate(
                zip(passages, embeddings), start=1
            )
        )
    return document


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
    game changes every year, and a rule from last season's manual is not a
    rule — and a French answer written only from them. `answer` holds the
    system's own refusal when none cleared `MIN_SCORE`, and nothing is
    generated for that case: with only the manual and the Q&A left as
    sources, a citation existing at all already means it came from one of
    the two, but no citation means there is nothing to write from either.
    A model that cannot be reached, or answers with nothing readable,
    leaves `answer` empty instead of failing the question: the citations
    still stand on their own under it.

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
        except GenerationError:
            answer = ""

    with transaction.atomic():
        query = RuleQuery.objects.create(asker=asker, question=question, answer=answer)
        QueryCitation.objects.bulk_create(
            QueryCitation(query=query, chunk=chunk, rank=rank)
            for rank, (_, chunk) in enumerate(matches, start=1)
        )
    return query


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
            }
            for citation in query.citations.select_related("chunk__document")
        ],
    }
