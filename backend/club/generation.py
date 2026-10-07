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
# A real manual's passage runs ~850 characters on average, some past 2000
# (club/rag.py's docstring) — most of a rule's own substance is in its
# first sentences, the rest mostly examples and edge cases. Cut well short
# of that: the prompt this builds is what the model actually has to read
# before writing anything, and it dominates generation time more than the
# answer's own length does.
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

# A citation is only ever trusted when it names a reference `ask` actually
# retrieved — never the model's word for it (see `generate_answer`).
_CITATION_RE = re.compile(r"\[([A-Za-z0-9.]+)\]")
_SENTENCE_ENDS = (".", "!", "?")


class GenerationError(Exception):
    """The model could not be reached, timed out, or answered with
    something unreadable. The caller falls back to showing the citations
    alone — never to inventing a sentence to fill the gap."""


def _complete_sentences(answer: str) -> str:
    """`GENERATION_MAX_TOKENS` can cut the model off mid-word: trimmed back
    to its last full sentence, a shorter answer still reads as finished
    rather than broken. No sentence at all — the cap bit before the model
    said anything worth keeping — refuses rather than show a fragment."""
    if answer.endswith(_SENTENCE_ENDS):
        return answer
    cut = max(answer.rfind(end) for end in _SENTENCE_ENDS)
    if cut == -1:
        raise GenerationError("réponse coupée avant la moindre phrase complète")
    return answer[: cut + 1]


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
    answer = _complete_sentences(answer.strip())

    known = {chunk.reference for chunk in chunks if chunk.reference}
    stray = set(_CITATION_RE.findall(answer)) - known
    if stray:
        raise GenerationError(
            f"référence non retrouvée citée : {', '.join(sorted(stray))}"
        )
    return answer
