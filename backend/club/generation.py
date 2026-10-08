"""Writing a French answer around the rulebook's cited passages (#135).

Retrieval (`rag.py`) stays the judge of what is cited: this module only
drafts the sentence around passages `ask` already decided are relevant,
and is never called when none cleared `MIN_SCORE` — there is nothing to
write from, and no model is asked to guess one up. The model itself runs
through Ollama (`compose.yml`'s `ollama` service), read from settings so
that trying another one is a `.env` change, `RAG_GENERATION_MODEL`, not a
code change.
"""

import json
import re
from urllib.error import URLError
from urllib.request import Request, urlopen

from django.conf import settings

from .models import Chunk

# The hard ceiling on how long a question may wait, enforced here rather
# than hoped for: past this, urlopen's own timeout fires (a plain OSError,
# already caught below) and the question falls back to its citations alone
# — same path as a bad citation or an unreachable server. A smaller, faster
# model answered within this reliably on #135's own 100-question review,
# but also got the *content* wrong more often where qwen2.5:3b (the
# default) did not — reference-citing is the only thing this module can
# check mechanically, so the choice leans toward the model proven right by
# hand, with this as its safety net against the rare slow outlier rather
# than the everyday case.
GENERATION_TIMEOUT_SECONDS = 10
# Three sentences rarely need more; a cap keeps a rambling answer from
# running past the timeout above on its own.
GENERATION_MAX_TOKENS = 120
# A real passage runs 653 characters at the median, some past 2000; this
# cuts 87% of them to roughly their first 25 words — short enough that
# the model is often writing from a fragment of a passage rather than the
# passage, the same wrong-content risk TOP_K went to 10 to avoid in the
# first place (#207's own review). Raising it was tried and measured back
# out: at TOP_K=10 the prompt is up to ten passages long, so each added
# character here is paid ten times over, and a real sweep against this
# manual (150 → 220 chars) already pushed the median past the 6-7s this
# model was chosen to hold and p95 past GENERATION_TIMEOUT_SECONDS. Fewer,
# more complete passages reaching the model — generation reading less of
# `ask`'s own TOP_K than it cites — would need its own measurement, not a
# number changed here on the strength of this alone.
GENERATION_MAX_PASSAGE_CHARS = 150

SYSTEM_PROMPT = (
    "Tu es Fieldbot, l'assistant du cahier de bord d'un club de robotique "
    "FIRST. Réponds uniquement à partir des passages du règlement fournis "
    "ci-dessous, en français, en trois phrases maximum. Chaque passage "
    "commence par sa référence entre crochets : reproduis-la à l'identique "
    "quand tu t'appuies dessus, lettres et points compris (par exemple "
    "[G102] ou [11.3.4]) — jamais raccourcie à son seul numéro, jamais "
    "approximée, jamais inventée. En cas de contradiction, le manuel de "
    "jeu fait autorité sur le Q&A officiel. Si les passages fournis ne "
    "permettent pas de répondre avec certitude, dis-le clairement au lieu "
    "d'inventer une réponse."
)

# The system prompt asks for a reference inside [brackets] and nothing
# else, so any token found inside one is trusted to be an attempted
# citation — same as the old, narrower check. (parentheses), unasked for,
# get a model's ordinary French aside as often as a drifted citation; only
# a token carrying a digit is trusted there (every real reference in this
# manual does — G102, 11.3.4, Q45 — a bare word never does), which is what
# keeps "(sauf exception)" from being misread as one. A citation is only
# ever trusted when it names a reference `ask` actually retrieved — never
# the model's word for it (see `generate_answer`).
_BRACKET_GROUP_RE = re.compile(r"\[([^\]]*)\]")
_PAREN_GROUP_RE = re.compile(r"\(([^)]*)\)")
_TOKEN_RE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9.\-]*[A-Za-z0-9])?")
# A sentence ends on its own line, or `.`/`!`/`?` followed by whitespace or
# the end of the text — not just the character anywhere, which a dotted
# reference like [6.1.2] would otherwise be mistaken for mid-citation.
_SENTENCE_END_RE = re.compile(r"[.!?](?=\s|$)")


class GenerationError(Exception):
    """The model could not be reached, timed out, or answered with
    something unreadable. The caller falls back to showing the citations
    alone — never to inventing a sentence to fill the gap."""


def _cited_references(answer: str) -> set[str]:
    cited = set()
    for group in _BRACKET_GROUP_RE.finditer(answer):
        cited.update(_TOKEN_RE.findall(group.group(1)))
    for group in _PAREN_GROUP_RE.finditer(answer):
        for token in _TOKEN_RE.findall(group.group(1)):
            if any(char.isdigit() for char in token):
                cited.add(token)
    return cited


def _complete_sentences(answer: str) -> str:
    """Only called when Ollama's own `done_reason` says `num_predict` cut
    the model off, never on an answer that finished on its own — otherwise
    a complete answer ending right on a citation, with no sentence-ending
    punctuation after it, would lose that citation to this trying to
    "finish" something that was not broken. Trimmed back to its last full
    sentence, a shorter answer still reads as finished rather than broken.
    No sentence at all — the cap bit before the model said anything worth
    keeping — refuses rather than show a fragment."""
    matches = list(_SENTENCE_END_RE.finditer(answer))
    if not matches:
        raise GenerationError("réponse coupée avant la moindre phrase complète")
    return answer[: matches[-1].end()]


def _truncated(text: str) -> str:
    if len(text) <= GENERATION_MAX_PASSAGE_CHARS:
        return text
    cut = text.rfind(" ", 0, GENERATION_MAX_PASSAGE_CHARS)
    return text[: cut if cut > 0 else GENERATION_MAX_PASSAGE_CHARS] + "…"


def _prompt(question: str, chunks: list[Chunk]) -> str:
    passages = "\n\n".join(
        f"[{chunk.reference}] {_truncated(chunk.text)}" for chunk in chunks
    )
    return f"Passages :\n{passages}\n\nQuestion : {question}"


def generate_answer(question: str, chunks: list[Chunk]) -> str:
    """A few sentences grounded in `chunks` alone, naming the references
    relied on. `chunks` is `ask`'s own `matches`, already above `MIN_SCORE`
    and ordered by authority then score — the order the model reads them
    in is the order the manual is meant to be trusted in.

    A citation the model gets wrong — shortened, misspelled, made up
    outright — is worse than no citation: it reads as checkable and is
    not. Measured on the real manual (100 questions, #135's own review):
    about one matched answer in five cited something that was not in
    `chunks`. Refusing the whole answer the moment one citation does not
    match exactly is the only guarantee strict enough for a rule a robot
    could be disqualified over — a looser check (fuzzy match, drop the bad
    one and keep the rest) would still let a wrong reference through
    sometimes, and `ask`'s caller already has a clean fallback for this:
    the citations below stand on their own, same as any other
    `GenerationError`."""
    body = json.dumps(
        {
            "model": settings.RAG_GENERATION_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": _prompt(question, chunks)},
            ],
            "stream": False,
            "options": {"num_predict": GENERATION_MAX_TOKENS},
        }
    ).encode("utf-8")
    request = Request(
        f"{settings.RAG_OLLAMA_URL}/api/chat",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=GENERATION_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read())
    except (URLError, OSError, ValueError) as error:
        raise GenerationError(str(error)) from error
    try:
        answer = payload["message"]["content"]
    except (KeyError, TypeError) as error:
        raise GenerationError("réponse du modèle illisible") from error
    if not isinstance(answer, str) or not answer.strip():
        raise GenerationError("réponse du modèle vide")
    answer = answer.strip()
    if payload.get("done_reason") == "length":
        answer = _complete_sentences(answer)

    known = {chunk.reference for chunk in chunks if chunk.reference}
    stray = _cited_references(answer) - known
    if stray:
        raise GenerationError(
            f"référence non retrouvée citée : {', '.join(sorted(stray))}"
        )
    return answer
