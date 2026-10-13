"""Writing an answer around the rulebook's cited passages (#135).

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

# The hard ceiling on how long a question may wait — past this, urlopen's
# own timeout fires (a plain OSError, already caught below) and the
# question falls back to its citations alone, same path as a bad citation
# or an unreachable server. Set well past a tight 10s budget: a cut-short
# passage or a narrowed TOP_K produced wrong answers as often as a slow
# one was ever actually a problem — a club member asking a rules question
# is not latency-sensitive the way gameplay is, and a correct answer
# worth waiting 30s for beats a fast, confident, wrong one every time.
GENERATION_TIMEOUT_SECONDS = 90
# Room enough that a longer answer, or a model partway through
# enumerating a passage's own lettered list (A., B., C., …), finishes
# rather than being cut mid-item — a narrower budget made that the
# everyday case rather than the rare one, cutting at "D." with nothing
# after it.
GENERATION_MAX_TOKENS = 500
# A real passage runs 653 characters at the median, some past 2000.
# Cutting it means the model answers from a fragment rather than the
# passage — a real, repeated cause of a correct citation next to wrong
# content. Set high enough that no real passage in this manual is ever
# actually cut; this is a ceiling against a pathological one, not a
# lever tuned for speed.
GENERATION_MAX_PASSAGE_CHARS = 3000
# The model is not deterministic: the same question against the same
# passages sampled again can cite the right reference where the first
# draft cited an unrelated one, or the other way round. One bad sample
# does not mean a refusal; it means another sample. `_relevant` alone
# measured a 75% false-refusal rate on one real, longer passage (G401,
# against this manual) against 25% on a shorter one (G410) — at 75%, 3
# attempts clear it only 58% of the time, 5 clear it 76% of the time.
GENERATION_MAX_ATTEMPTS = 5

SYSTEM_PROMPT = (
    "You are Fieldbot, the logbook assistant for a FIRST robotics club. "
    "Answer only from the rulebook passages given below, in English, in "
    "three sentences at most. For every claim you make, cite the exact "
    "reference of the passage that supports it (reproduce it exactly, "
    "for example [G102] or [11.3.4] — never shortened, never "
    "approximated, never invented, and never omitted). Do not add any "
    "number, condition or exception the cited passage does not itself "
    "mention. When they conflict, the game manual takes precedence over "
    "the official Q&A. If the passages given do not let you answer with "
    "certainty, say so plainly instead of making an answer up."
)

# The system prompt asks for a reference inside [brackets] and nothing
# else, so any token found inside one is trusted to be an attempted
# citation. (parentheses), unasked for, get a model's ordinary aside as
# often as a drifted citation; only a token carrying a digit is trusted
# there (every real reference in this manual does — G102, 11.3.4, Q45 —
# a bare word never does), which is what keeps "(except as noted)" from
# being misread as one. A citation is only ever trusted when it names a
# reference `ask` actually retrieved *and* clears `_relevant` against
# that reference's own stored text below — never the model's word for
# either (see `generate_answer`).
_BRACKET_GROUP_RE = re.compile(r"\[([^\]]*)\]")
_PAREN_GROUP_RE = re.compile(r"\(([^)]*)\)")
_TOKEN_RE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9.\-]*[A-Za-z0-9])?")
# A sentence ends on its own line, or `.`/`!`/`?` followed by whitespace or
# the end of the text — not just the character anywhere, which a dotted
# reference like [6.1.2] would otherwise be mistaken for mid-citation.
_SENTENCE_END_RE = re.compile(r"[.!?](?=\s|$)")
# A lone letter right before the stop ("A.", "D.") is a passage's own
# lettered list running out of room, not a sentence of its own —
# trimming back to the previous sentence would otherwise read "…D." back
# as if it were the answer's last word.
_LIST_MARKER_RE = re.compile(r"(?:^|\s)[A-Za-z]\.$")
# Reading real generated answers by hand: a 3B model asked for English
# sometimes answers in French instead — not a typo in one word, the
# *whole* passage copied verbatim in some cases. Requiring an English
# word to be *present* flagged real, terse, jargon-heavy answers that
# happen to have none ("AUTO lasts 30 seconds [6.1.2]", "True."); this
# instead requires *both* a common French word and the absence of an
# English one, which only the actual failure (a whole answer drifted
# into French) manages: an English sentence, however short, essentially
# never contains "le" or "de" at all, French or not.
_ENGLISH_WORD_RE = re.compile(
    r"\b(?:the|and|with|from|is|are|this|that|must|shall|not|of|to)\b",
    re.IGNORECASE,
)
_FRENCH_WORD_RE = re.compile(
    r"\b(?:le|la|les|de|du|des|un|une|est|sont|dans|pour|avec|sur|pas|"
    r"ne|que|qui|cette|ces|son|sa|ses|et|en|selon)\b",
    re.IGNORECASE,
)
# An answer can carry enough English words to clear the check above
# while part of it is written in a different script entirely — neither
# function-word check can catch that on its own. Covers the scripts
# actually seen drifted into (Cyrillic, Arabic, Devanagari, CJK,
# Hangul); Latin-script accents (French, or anything else) are untouched.
_NON_LATIN_RE = re.compile(r"[Ѐ-ӿ؀-ۿऀ-ॿ　-鿿가-퟿]")
# Checking relevance against the passage's own stored text, not the
# model's reproduction of it, drops a failure a verbatim-copy check
# would catch instead: a model that paraphrases a passage rather than
# quoting it exactly is not thereby wrong about whether it answers the
# question — read by hand, the NECTAR rule's own multi-sentence text was
# one the model kept paraphrasing, failing a check that had nothing to
# do with whether the answer was right. The citations panel already
# shows this season's own stored text for every reference regardless of
# what the model writes, so a visitor reading it gets the real passage
# either way. Measured against a known "cited a real but wrong passage"
# failure (a passage about match timing, cited for a scoring-window
# question it does not answer), a plain yes/no call never once passed
# the wrong passage (0/8) and passed the right one often but not always
# (6/8) — short of reliable alone, which is why `generate_answer`'s
# retry absorbs the miss rather than this blocking on one sample of it.
#
# The prompt's own wording matters as much as the check itself: asking
# the model to act as a strict verifier answered NO to a right passage
# as often as a wrong one, unable to tell them apart at all; a neutral
# yes/no question ("does this passage help answer this question?") told
# them apart reliably instead (24/24 yes on right pairs, 12/12 no on
# wrong ones, three samples each).
_RELEVANCE_PROMPT = (
    "Question: {question}\n\n"
    'Rulebook passage: "{passage}"\n\n'
    "Does the passage contain information that helps answer the "
    "question? Answer YES or NO."
)


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
    return f"Passages:\n{passages}\n\nQuestion: {question}"


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


def _relevant(question: str, passage: str) -> bool:
    """A fresh, separate call, out of the context that chose this
    citation in the first place — asking the same model that just cited
    a passage whether it stands by it, inside the same generation, would
    just read back its own pick. Checked against the passage's own
    stored text, not anything the model wrote, so a model that cites the
    right reference but garbles its own summary of it is judged on what
    the passage actually says. Fails open (treated as relevant) on
    anything but a clear "YES"/"NO": a server error here is not grounds
    to refuse an otherwise-real citation on its own."""
    body = json.dumps(
        {
            "model": settings.RAG_GENERATION_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": _RELEVANCE_PROMPT.format(
                        question=question, passage=passage
                    ),
                }
            ],
            "stream": False,
            "options": {"num_predict": 10},
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
        verdict = payload["message"]["content"]
    except (URLError, OSError, ValueError, KeyError, TypeError):
        return True
    if not isinstance(verdict, str):
        return True
    return not re.search(r"\bno\b", verdict, re.IGNORECASE)


def _checked(question: str, answer: str, chunks: list[Chunk]) -> str:
    """The ways of being wrong that reading real answers by hand found,
    none of which a check on the reference alone could ever catch:
    answering in French because a retrieved passage led the model that
    way, drifting into another script partway through, and a citation
    the model gets wrong — shortened, misspelled, made up outright. An
    answer naming no reference at all is not one of these: it is
    accepted once it clears the same relevance check a named citation
    would, against the top-ranked passage — most of these, read by
    hand, turned out correct anyway.

    Measured on the real manual (100 questions): about one matched
    answer in five cited something that was not in `chunks` — the one
    way of being wrong even a real reference cannot rule out on its
    own, a citation that's entirely genuine and simply not an answer to
    the question asked. A looser check (fuzzy match, drop the bad
    reference and keep the rest) would still let a wrong one through
    sometimes; refusing outright is the only guarantee strict enough
    for a rule a robot could be disqualified over."""
    if _NON_LATIN_RE.search(answer):
        raise GenerationError("réponse contenant une écriture inattendue")
    if _FRENCH_WORD_RE.search(answer) and not _ENGLISH_WORD_RE.search(answer):
        raise GenerationError("réponse qui ne semble pas être en anglais")

    cited = _cited_references(answer)
    if not cited:
        if not _relevant(question, chunks[0].text):
            raise GenerationError("réponse sans rapport avec la question")
        return answer
    known = {chunk.reference: chunk for chunk in chunks if chunk.reference}
    stray = cited - known.keys()
    if stray:
        raise GenerationError(
            f"référence non retrouvée citée : {', '.join(sorted(stray))}"
        )

    for ref in cited:
        if not _relevant(question, known[ref].text):
            raise GenerationError(f"passage sans rapport avec la question : [{ref}]")
    return answer


def generate_answer(question: str, chunks: list[Chunk]) -> str:
    """A few sentences grounded in `chunks` alone, naming the references
    relied on. `chunks` is `ask`'s own `matches`, already above `MIN_SCORE`
    and ordered by authority then score — the order the model reads them
    in is the order the manual is meant to be trusted in.

    The model is not deterministic: read by hand against this manual,
    the same question against the same passages sampled again drew a
    correct citation where the first draft drew an unrelated one.
    `GENERATION_MAX_ATTEMPTS` asks again rather than settling for the
    first draft's bad luck — `ask`'s caller still has a clean fallback
    once every attempt fails the same way: the citations below stand on
    their own, same as any other `GenerationError`."""
    last_error: GenerationError | None = None
    for _ in range(GENERATION_MAX_ATTEMPTS):
        answer = _sample(question, chunks)
        try:
            return _checked(question, answer, chunks)
        except GenerationError as error:
            last_error = error
    assert last_error is not None
    raise last_error
