"""The rulebook RAG: ingesting a source into passages, and answering a
question against them, ranked by how much the source may be trusted
(docs/fieldnotes.html, "Le RAG règlement").

No vector database: a manual is a few thousand passages, and comparing
them by a plain dot product is a NumPy call, not an infrastructure
decision (docs/fieldnotes.html's own "plafond assumé" names exactly this:
"pgvector, sqlite-vec ou un tableau NumPy").

What *is* worth an infrastructure decision is the vector itself. A first
version hashed a bag-of-words and ranked it with Okapi BM25 — cheap, and
close enough when a question quotes the manual's own words. It could not
close two real gaps: a plural the manual writes one way and a question
the other ("robots" and "ROBOT" hash to different buckets, not the same
word), and a question asked in French about a manual FIRST publishes only
in English, where a real answer shares no token with its source at all.
Both are gaps of *meaning*, and no amount of retuning a word-hash closes
them. `intfloat/multilingual-e5-base` does: a 278M-parameter, CPU-only,
locally-cached model trained across 100+ languages including French and
English, built specifically for retrieval (its own card asks for the
"query: "/"passage: " prefixes used below). It runs once per ingestion
and once per question, entirely offline after its one-time download —
nothing about the club's "tout tourne en local" posture changes, only
what `embed()` does inside.

Run through `fastembed` (ONNX Runtime) rather than `sentence-transformers`
(PyTorch): measured on the same 100 questions against the real manual,
identical answers to the third decimal place — the runtime changed, not
the arithmetic — for roughly a third the latency per question (measured:
~21ms against ~72ms) and without PyTorch's own ~550MB of installed
weight (fastembed's own runtime, ONNX Runtime, is tens of MB). The one
place it is not a clean win: ingesting the full manual took about twice
as long (measured: ~72s against ~37s for the same 397 passages) — ONNX
Runtime's CPU provider favours short sequences over throughput on long
ones, the opposite of what `ask()` needs but exactly what a rare,
one-off ingestion does not.

Sized up from the smaller `e5-small` after calibration showed the real
gap: 0.82 was the first threshold blocking every off-topic control on
`e5-small`, at the cost of 10/90 real questions refused (11%). `e5-base`
is not a differently-tuned threshold on the same curve — it is a better
curve: it separates real questions from off-topic ones more cleanly,
recalibrated below at 0.81 for 1/90 refused (1%) at the same 100%
off-topic guarantee. Larger still (`e5-large`) was tried too; see the
commit that landed this for why it wasn't worth its extra weight.
"""

import re
import struct
from pathlib import Path
from typing import Any

import numpy as np
from django.conf import settings
from django.db import transaction
from fastembed import TextEmbedding
from fastembed.common.model_description import ModelSource, PoolingType

from .models import Chunk, Document, QueryCitation, RuleQuery, Season, User

# fastembed does not carry multilingual-e5-base in its own catalogue (only
# the larger e5-large) — this registers the same model as a custom one,
# pointing at a third-party ONNX export rather than intfloat's own repo,
# which only publishes PyTorch weights.
#
# fp32, not the same export's int8-quantized file: quantized scored the
# same 90 real / 10 off-topic questions measurably worse (at MIN_SCORE
# unchanged, 74/90 real questions answered and only 8/10 off-topic
# blocked, against 89/90 and 10/10 below) — a real accuracy cost, not a
# rounding difference. fp32 ONNX, run through fastembed rather than
# sentence-transformers, scored these same 100 questions identically to
# the third decimal place: the runtime changed, not the arithmetic. Kept
# here as the one still worth shipping — 3x faster than
# sentence-transformers per question in the same measurement, and without
# torch's ~550MB (fastembed's own runtime, onnxruntime, is tens of MB) —
# for exactly the same answers.
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
# How weak a match may be and still count as one. Cosine similarity
# between two unit vectors (both `embed()` outputs are normalised) is
# bounded in [-1, 1] with a natural centre at 0, unlike BM25's raw score,
# which had no scale of its own to draw a line on (see git history,
# `MIN_SCORE = 9.0`).
#
# Recalibrated against the real BioBuzz manual chunked by rule rather than
# by word window (397 passages), on the same 90 real questions spanning
# every section plus 10 off-topic controls: real questions scored
# 0.805-0.911, the 10 off-topic controls 0.753-0.806 — a far tighter
# separation than the word-window chunking ever gave, with only a hair's
# width of overlap at the very top of the off-topic range. 0.81 is the
# first threshold, scanning up from 0.70, where all 10 off-topic controls
# fall below it; it costs exactly one real question out of 90.
MIN_SCORE = 0.81

AUTHORITY_OF: dict[str, str] = {
    Document.Source.GAME_MANUAL: Document.Authority.BINDING,
    Document.Source.OFFICIAL_QA: Document.Authority.RULING,
    Document.Source.FORUM: Document.Authority.COMMUNITY,
}
AUTHORITATIVE = {Document.Authority.BINDING, Document.Authority.RULING}

# Read by whoever asks, when no binding or ruling passage backs an answer:
# the system's own refusal, not a guess dressed up as one.
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


# A running header FIRST repeats on every page ("Section 11 Game Rules (G)
# V1 99 of 173"), never a rule or a section of its own — dropped before
# either pattern below gets a chance to misread it.
_RUNNING_HEADER = re.compile(r"^Section \d+ .+ V\d+ \d+ of \d+$")
# The table of contents lists every section in the same "number, title"
# shape a real heading has — what tells the two apart is the dot leader
# pypdf keeps between a ToC title and its page number, never present in a
# real heading in the body.
_TOC_LEADER = re.compile(r"\.{5,}")
# A rule ID: the letter names its section (I, E, A, G, R, T, L, C — the
# manual's own key, §1.7.1), always three digits, always followed by a
# space and the headline's own capital ("G420 *Do not tip or entangle.").
# A bare cross-reference to the same rule mid-sentence ("...violation of
# G410.") has no space before its punctuation, so it never matches here.
_RULE_REFERENCE = re.compile(r"^([IEAGRTLC]\d{3})\s+\*?[A-Z]")
# A numbered section heading for the prose around the rules ("10.6.4
# Violation Details", "9.7 FLOWER") — one to four levels deep.
_SECTION_REFERENCE = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){0,3})\s+[A-Z]")
# e5-base reads at most 512 tokens; a word runs close enough to a token in
# this manual's plain English that a rule this long — a handful, mostly in
# Motors & Actuators and Power Distribution — is re-split by word count
# rather than measured token by token.
MAX_WORDS_PER_PASSAGE = 350


def chunk_rules(text: str) -> list[tuple[str, str]]:
    """One passage per rule or numbered section, not a sliding word window:
    the manual is built on these, every rule opens a line naming its own
    ID, and a word window cut across them — a passage could carry the end
    of one rule and the start of the next, and a citation couldn't say
    which rule it was. Runs on the manual's own structure, recognising
    only what FIRST's own numbering already promises.

    Returns `(reference, passage)` pairs; `reference` is "" for whatever
    precedes the first recognised rule or section — front matter, kept
    rather than guessed at or dropped."""
    open_chunks: list[tuple[str, list[str]]] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or _RUNNING_HEADER.match(line) or _TOC_LEADER.search(line):
            continue
        rule_match = _RULE_REFERENCE.match(line)
        section_match = _SECTION_REFERENCE.match(line)
        reference = rule_match.group(1) if rule_match else None
        if reference is None and section_match:
            reference = section_match.group(1)
        if reference is not None:
            open_chunks.append((reference, [line]))
        elif open_chunks:
            open_chunks[-1][1].append(line)
        else:
            open_chunks.append(("", [line]))

    passages: list[tuple[str, str]] = []
    for reference, lines in open_chunks:
        words = " ".join(lines).split()
        for start in range(0, len(words), MAX_WORDS_PER_PASSAGE):
            passages.append(
                (reference, " ".join(words[start : start + MAX_WORDS_PER_PASSAGE]))
            )
    return passages


@transaction.atomic
def ingest_document(
    *, season: Season, source: str, title: str, text: str, url: str = ""
) -> Document:
    """All or nothing: a document without its passages would never be
    found, and passages without their document would cite nothing.

    `authority` is read off `source`, never asked for on its own — a forum
    thread can otherwise be filed as binding by nothing more than a typo."""
    document = Document.objects.create(
        season=season,
        source=source,
        authority=AUTHORITY_OF[source],
        title=title,
        url=url,
    )
    passages = chunk_rules(text)
    embeddings = _embed_many([passage for _, passage in passages], is_query=False)
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
# passage is always quoted ahead of a ruling or community one that merely
# scored higher, and score only breaks ties within the same authority.
_AUTHORITY_RANK: dict[str, int] = {
    Document.Authority.BINDING: 0,
    Document.Authority.RULING: 1,
    Document.Authority.COMMUNITY: 2,
}


@transaction.atomic
def ask(question: str, season: Season, asker: User) -> RuleQuery:
    """The passages closest to the question, for this season only — the
    game changes every year, and a rule from last season's manual is not a
    rule. `answer` stays empty when the citations speak for themselves, and
    only ever says something when none of them may be trusted to.

    Only the latest `Document` per (season, source) is searched: FIRST
    republishes the manual with every Team Update (§1.7.3), and citing an
    amended rule alongside its own superseded predecessor would leave a
    student unsure which to trust — until proper versioning settles that,
    the old one is simply not searched.

    Atomic end to end: a failure between creating the query and its
    citations must never leave an "answered" query with nothing behind
    it."""
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
        order = np.argsort(-scores)[:TOP_K]
        matches = sorted(
            (
                (float(scores[index]), chunks[index])
                for index in order
                if scores[index] >= MIN_SCORE
            ),
            key=lambda pair: (_AUTHORITY_RANK[pair[1].document.authority], -pair[0]),
        )
    trusted = any(chunk.document.authority in AUTHORITATIVE for _, chunk in matches)

    query = RuleQuery.objects.create(
        asker=asker, question=question, answer="" if trusted else NO_ANSWER
    )
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
