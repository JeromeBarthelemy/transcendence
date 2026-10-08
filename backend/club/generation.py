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
import unicodedata
from urllib.error import URLError
from urllib.request import Request, urlopen

from django.conf import settings

from .models import Chunk

# The hard ceiling on how long a question may wait — past this, urlopen's
# own timeout fires (a plain OSError, already caught below) and the
# question falls back to its citations alone, same path as a bad citation
# or an unreachable server. Raised well past what #207's own review first
# shipped (10s): read by hand, a cut-short passage or a narrowed TOP_K
# produced wrong answers as often as a slow one was ever actually a
# problem — a club member asking a rules question is not latency-
# sensitive the way gameplay is, and a correct answer worth waiting 30s
# for beats a fast, confident, wrong one every time.
GENERATION_TIMEOUT_SECONDS = 90
# Room enough that a longer answer, or a model partway through
# enumerating a passage's own lettered list (A., B., C., …), finishes
# rather than being cut mid-item — #207's own review found exactly that:
# cut at "D." with nothing after, which the old, narrower token budget
# made the everyday case rather than the rare one.
GENERATION_MAX_TOKENS = 500
# A real passage runs 653 characters at the median, some past 2000.
# Cutting it — at 150 chars or even 700 — means the model answers from a
# fragment rather than the passage, which #207's own review measured as a
# real, repeated cause of a correct citation next to wrong content. Set
# high enough that no real passage in this manual is ever actually cut;
# this is a ceiling against a pathological one, not a lever tuned for
# speed any more now that speed is not what's being tuned for.
GENERATION_MAX_PASSAGE_CHARS = 3000
# The model is not deterministic: the same question against the same
# passages sampled again can cite the right reference where the first
# draft cited an unrelated one, or the other way round (#207's own
# review, read by hand — the NECTAR question's own answer went from a
# confidently wrong citation to a correct one on a second sample, same
# inputs both times). One bad sample used to mean a refusal; now it
# means another sample, since nothing here is checking a clock anymore.
GENERATION_MAX_ATTEMPTS = 3

SYSTEM_PROMPT = (
    "Tu es Fieldbot, l'assistant du cahier de bord d'un club de robotique "
    "FIRST. Réponds uniquement à partir des passages du règlement fournis "
    "ci-dessous, en trois phrases maximum. Pour chaque affirmation que tu "
    "fais, cite d'abord la référence exacte du passage (reproduis-la à "
    "l'identique, par exemple [G102] ou [11.3.4] — jamais raccourcie, "
    "jamais approximée, jamais inventée, et jamais omise), puis "
    "l'extrait exact du passage qui la justifie, sans le traduire ni le "
    "modifier, entre guillemets anglais ; explique-le ensuite en "
    'français. Exemple : [G102] "exact quote copied word for word from '
    "the passage\" — explication en français. N'invente jamais un "
    "extrait : s'il n'y a pas de passage qui justifie une affirmation, "
    "ne fais pas cette affirmation. Ton explication en français ne doit "
    "contenir aucun chiffre, condition ou exception qui n'apparaît pas "
    "déjà dans l'extrait cité juste avant. En cas de contradiction, le "
    "manuel de jeu fait autorité sur le Q&A officiel. Si les passages "
    "fournis ne permettent pas de répondre avec certitude, dis-le "
    "clairement au lieu d'inventer une réponse."
)

# The system prompt asks for a reference inside [brackets] and nothing
# else, so any token found inside one is trusted to be an attempted
# citation — same as the old, narrower check. (parentheses), unasked for,
# get a model's ordinary French aside as often as a drifted citation; only
# a token carrying a digit is trusted there (every real reference in this
# manual does — G102, 11.3.4, Q45 — a bare word never does), which is what
# keeps "(sauf exception)" from being misread as one. A citation is only
# ever trusted when it names a reference `ask` actually retrieved *and*
# carries a verbatim excerpt that checks out against it (`_QUOTE_RE`
# below) — never the model's word for either (see `generate_answer`).
_BRACKET_GROUP_RE = re.compile(r"\[([^\]]*)\]")
_PAREN_GROUP_RE = re.compile(r"\(([^)]*)\)")
_TOKEN_RE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9.\-]*[A-Za-z0-9])?")
# A sentence ends on its own line, or `.`/`!`/`?` followed by whitespace or
# the end of the text — not just the character anywhere, which a dotted
# reference like [6.1.2] would otherwise be mistaken for mid-citation.
_SENTENCE_END_RE = re.compile(r"[.!?](?=\s|$)")
# A lone letter right before the stop ("A.", "D.") is a passage's own
# lettered list running out of room, not a sentence of its own (#207's
# own review: trimming stopped at exactly this and showed "…D." with
# nothing after it, read back as if it were the answer's last word).
_LIST_MARKER_RE = re.compile(r"(?:^|\s)[A-Za-z]\.$")
# #207's own review, reading real generated answers by hand: a 3B model
# asked for French sometimes answers in English instead — not a typo in
# one word, the *whole* passage copied verbatim. Requiring a French word
# to be *present* flagged real, terse, jargon-heavy answers that happen
# to have none ("AUTO dure 30 secondes [6.1.2]", "Vrai.") — this instead
# requires *both* a common English word and the absence of a French one,
# which only the actual failure (a whole passage copied as-is) manages:
# a French sentence, however short, essentially never contains "the" or
# "and" at all, English or not.
_FRENCH_WORD_RE = re.compile(
    r"\b(?:le|la|les|de|du|des|un|une|est|sont|dans|pour|avec|sur|pas|"
    r"ne|que|qui|cette|ces|son|sa|ses|et|en|selon)\b",
    re.IGNORECASE,
)
_ENGLISH_WORD_RE = re.compile(
    r"\b(?:the|and|with|from|is|are|this|that|must|shall|not|of|to)\b",
    re.IGNORECASE,
)
# A citation's own reference check can only ever confirm the reference is
# real; it has no way to tell a genuine quote from an invented one
# attached to it. Asking for a verbatim excerpt alongside each citation
# — checked below against the actual retrieved text, not trusted on the
# model's word — closes that: a real quote that doesn't exist in the
# passage is exactly as refusable as a reference that doesn't. Doesn't
# catch an invented detail in the French explanation *around* a genuine
# quote (a number or exception the quote itself doesn't carry) — the
# system prompt asks the model not to add one, but nothing here verifies
# that it didn't.
_QUOTE_RE = re.compile(r'\[([A-Za-z0-9.\-]+)\]\s*["“]([^"“”]{15,})["”]')
_QUOTE_CHARS = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'"})


def _normalized(text: str) -> str:
    """Case, accents and smart quotes aside, this is the same excerpt or
    it isn't — none of those make a quote any less verbatim."""
    text = text.translate(_QUOTE_CHARS)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", text.lower()).strip()


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
    for match in reversed(list(_SENTENCE_END_RE.finditer(answer))):
        candidate = answer[: match.end()]
        if _LIST_MARKER_RE.search(candidate):
            continue
        return candidate
    raise GenerationError("réponse coupée avant la moindre phrase complète")


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


def _sample(question: str, chunks: list[Chunk]) -> str:
    """One draft from the model — reaching it, reading its message, and
    trimming a token-cut one back to its last full sentence. Never
    retried on its own: a server that cannot be reached or answers with
    something unreadable is a reason to stop, not to ask again."""
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
    return answer


def _checked(answer: str, chunks: list[Chunk]) -> str:
    """The ways of being wrong that reading real answers by hand found
    (#207's own review), none of which a check on the reference alone
    could ever catch: answering in English because the source passage
    was, answering with no citation at all — not a wrong one, just none
    — a citation the model gets wrong — shortened, misspelled, made up
    outright — and, the one a bare reference can never rule out, a
    citation that's real sitting next to a quote that isn't. Measured
    on the real manual (100 questions, #135's own review): about one
    matched answer in five cited something that was not in `chunks`. A
    looser check (fuzzy match, drop the bad reference and keep the
    rest) would still let a wrong one through sometimes; refusing
    outright is the only guarantee strict enough for a rule a robot
    could be disqualified over."""
    explanation = _QUOTE_RE.sub(" ", answer)
    if _ENGLISH_WORD_RE.search(explanation) and not _FRENCH_WORD_RE.search(explanation):
        raise GenerationError("réponse qui ne semble pas être en français")

    cited = _cited_references(answer)
    if not cited:
        raise GenerationError("réponse sans aucune référence citée")
    known = {chunk.reference: chunk for chunk in chunks if chunk.reference}
    stray = cited - known.keys()
    if stray:
        raise GenerationError(
            f"référence non retrouvée citée : {', '.join(sorted(stray))}"
        )

    quoted_refs = set()
    for ref, quote in _QUOTE_RE.findall(answer):
        chunk = known.get(ref)
        if chunk is None or _normalized(quote) not in _normalized(chunk.text):
            raise GenerationError(f"extrait non retrouvé tel quel pour [{ref}]")
        quoted_refs.add(ref)
    unquoted = cited - quoted_refs
    if unquoted:
        raise GenerationError(
            f"référence citée sans extrait à l'appui : {', '.join(sorted(unquoted))}"
        )
    return answer


def generate_answer(question: str, chunks: list[Chunk]) -> str:
    """A few sentences grounded in `chunks` alone, naming the references
    relied on. `chunks` is `ask`'s own `matches`, already above `MIN_SCORE`
    and ordered by authority then score — the order the model reads them
    in is the order the manual is meant to be trusted in.

    The model is not deterministic: read by hand against this manual,
    the same question against the same passages sampled again drew a
    correct citation where the first draft drew an unrelated one (#207's
    own review). `GENERATION_MAX_ATTEMPTS` asks again rather than
    settling for the first draft's bad luck — `ask`'s caller still has a
    clean fallback once every attempt fails the same way: the citations
    below stand on their own, same as any other `GenerationError`."""
    last_error: GenerationError | None = None
    for _ in range(GENERATION_MAX_ATTEMPTS):
        answer = _sample(question, chunks)
        try:
            return _checked(answer, chunks)
        except GenerationError as error:
            last_error = error
    assert last_error is not None
    raise last_error
