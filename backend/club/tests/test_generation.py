import json

import pytest

from club import generation
from club.generation import GenerationError, generate_answer
from club.models import Chunk, Document, Season

CHUNK_TEXT = "Climbing on ARENA elements is prohibited."


def chunk(reference="G102", text=CHUNK_TEXT):
    document = Document.objects.create(
        season=Season.objects.create(start_year=2026, game_name="BioBuzz"),
        source=Document.Source.GAME_MANUAL,
        authority=Document.Authority.BINDING,
        title="Manuel de jeu",
    )
    return Chunk.objects.create(
        document=document, ordinal=1, reference=reference, text=text
    )


def cited(ref="G102", explanation="Interdit."):
    return f"[{ref}] {explanation}"


class FakeResponse:
    def __init__(self, body: bytes):
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _content(text, done_reason="stop"):
    return FakeResponse(
        json.dumps({"message": {"content": text}, "done_reason": done_reason}).encode()
    )


def _is_relevance_call(request) -> bool:
    body = json.loads(request.data)
    return "Est-ce que ce passage répond" in body["messages"][0]["content"]


def mock_ollama(monkeypatch, answer, done_reason="stop", relevant=True):
    """Routes the main generation call to `answer` and any relevance
    check (a separate urlopen call `_relevant` makes for each citation,
    against the cited chunk's own stored text) to a fixed OUI/NON —
    tests that aren't about relevance itself don't need to know it
    runs."""

    def fake_urlopen(request, timeout):
        if _is_relevance_call(request):
            return _content("OUI" if relevant else "NON")
        return _content(answer, done_reason=done_reason)

    monkeypatch.setattr("club.generation.urlopen", fake_urlopen)


def test_generate_answer_reads_the_models_own_message(monkeypatch):
    captured = {}
    answer_text = f"  {cited(explanation='Oui, interdit.')}  "

    def fake_urlopen(request, timeout):
        if _is_relevance_call(request):
            return _content("OUI")
        captured["url"] = request.full_url
        captured["body"] = json.loads(request.data)
        captured["timeout"] = timeout
        return FakeResponse(json.dumps({"message": {"content": answer_text}}).encode())

    monkeypatch.setattr("club.generation.urlopen", fake_urlopen)

    answer = generate_answer("Peut-on grimper sur le terrain ?", [chunk()])

    assert answer == answer_text.strip()
    assert captured["url"] == "http://ollama:11434/api/chat"
    assert captured["body"]["model"] == "qwen2.5:3b"
    assert captured["body"]["stream"] is False
    assert (
        captured["body"]["options"]["num_predict"] == generation.GENERATION_MAX_TOKENS
    )
    assert captured["body"]["messages"][0]["role"] == "system"
    user_message = captured["body"]["messages"][1]["content"]
    assert f"[G102] {CHUNK_TEXT}" in user_message
    assert "Peut-on grimper sur le terrain ?" in user_message


def test_generate_answer_truncates_a_passage_longer_than_the_cap(monkeypatch):
    # A real passage runs past GENERATION_MAX_PASSAGE_CHARS more often than
    # not (club/rag.py: ~850 characters on average) — the prompt the model
    # actually reads is what this caps, not the citation shown underneath.
    long_text = "Mot " * 800
    captured = {}

    def fake_urlopen(request, timeout):
        if _is_relevance_call(request):
            return _content("OUI")
        captured["body"] = json.loads(request.data)
        return FakeResponse(json.dumps({"message": {"content": cited()}}).encode())

    monkeypatch.setattr("club.generation.urlopen", fake_urlopen)

    generate_answer("Une question ?", [chunk(text=long_text)])

    user_message = captured["body"]["messages"][1]["content"]
    assert long_text not in user_message
    assert len(user_message) < len(long_text)


def test_generate_answer_refuses_when_the_server_cannot_be_reached(monkeypatch):
    from urllib.error import URLError

    def fake_urlopen(request, timeout):
        raise URLError("connection refused")

    monkeypatch.setattr("club.generation.urlopen", fake_urlopen)

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_refuses_an_unreadable_payload(monkeypatch):
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: FakeResponse(b"not json"),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_refuses_a_message_with_no_content_field(monkeypatch):
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: FakeResponse(json.dumps({"message": {}}).encode()),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_refuses_a_blank_answer(monkeypatch):
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: FakeResponse(
            json.dumps({"message": {"content": "   "}}).encode()
        ),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_accepts_a_citation_that_was_actually_retrieved(monkeypatch):
    answer_text = cited()
    mock_ollama(monkeypatch, answer_text)

    assert generate_answer("Une question ?", [chunk()]) == answer_text


def test_generate_answer_refuses_a_citation_whose_passage_is_not_relevant(
    monkeypatch,
):
    # #207's own review, reading real answers against the real manual: a
    # citation can name a reference that was genuinely retrieved while
    # the passage behind it simply does not answer the question — the
    # model cited a real passage about match timing structure for a
    # question about when NECTAR scoring is allowed. Neither the
    # reference check nor anything about the citation's own formatting
    # can catch this; checking the cited passage's own stored text
    # against the question, separately, can.
    mock_ollama(monkeypatch, cited(), relevant=False)

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_refuses_a_citation_that_was_never_retrieved(monkeypatch):
    # #135's own 100-question review, run against the real manual: about one
    # matched answer in five cited a reference `ask` never retrieved — a
    # shortened one (G102 -> 102), a misspelled one, or, once, a reference
    # that does not exist anywhere in the manual. A wrong citation reads as
    # checkable and is not, which is worse than none: the whole answer is
    # refused rather than trusting it with one bad reference quietly kept.
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: _content(cited() + " [UNDISCLOSED] aussi."),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_trims_a_token_cut_answer_to_its_last_full_sentence(
    monkeypatch,
):
    # GENERATION_MAX_TOKENS can stop the model mid-word; the answer still
    # reads as finished once trimmed back to the sentence before the cut.
    # Ollama's own done_reason ("length") is what says a cut actually
    # happened — without it, trimming never runs at all.
    mock_ollama(monkeypatch, cited() + " Autre chose non ter", done_reason="length")

    assert generate_answer("Une question ?", [chunk()]) == cited()


def test_generate_answer_refuses_an_answer_cut_before_any_full_sentence(monkeypatch):
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: _content(
            "[G102] il est permis de", done_reason="length"
        ),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_does_not_trim_an_answer_that_finished_on_its_own(monkeypatch):
    # #207's own review: a model ending right on its citation, with no
    # final full stop, is a common and legitimate way to finish — not a
    # sign of a cut. done_reason "stop" (or anything but "length") must
    # leave it alone rather than go looking for a sentence to "complete".
    answer_text = "Interdit, selon [6.1.2]"
    mock_ollama(monkeypatch, answer_text, done_reason="stop")

    assert generate_answer("Une question ?", [chunk(reference="6.1.2")]) == answer_text


def test_generate_answer_trims_without_mistaking_a_dotted_reference_for_the_cut(
    monkeypatch,
):
    # #207's own review: the old cut-at-the-last-dot logic found the dots
    # inside [11.3.4] itself and sliced the citation in half. The real
    # sentence boundary is the one after "Vrai.", not inside the
    # reference's own dots.
    kept = "Vrai, selon [11.3.4]."
    mock_ollama(
        monkeypatch, kept + " Autre chose non complète apre", done_reason="length"
    )

    assert generate_answer("Une question ?", [chunk(reference="11.3.4")]) == kept


def test_generate_answer_refuses_a_citation_shortened_to_its_bare_number(monkeypatch):
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: _content(cited(ref="102")),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_refuses_several_references_packed_in_one_bracket(
    monkeypatch,
):
    # [chunk()] only retrieved G102: a model allowed to list several
    # references per bracket could smuggle an invented one past a check
    # that only reads the first token in each pair of brackets.
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: _content("Selon [G102, 9.9.9]."),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_refuses_a_reference_cited_in_parentheses(monkeypatch):
    # The system prompt asks for [brackets]; a model that drifts to
    # (parentheses) instead must not get a free pass for it.
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: _content(cited() + " (règle 9.9.9)"),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_refuses_a_hyphenated_reference_not_retrieved(monkeypatch):
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: _content(cited(ref="G-102")),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_does_not_mistake_an_ordinary_parenthetical_for_a_citation(
    monkeypatch,
):
    # No digit, no reference: an aside in parentheses must not be read as
    # an attempted citation and refused for failing to match one.
    answer_text = f"{cited()} (sauf exception)"
    mock_ollama(monkeypatch, answer_text)

    assert generate_answer("Une question ?", [chunk()]) == answer_text


def test_generate_answer_refuses_an_answer_with_no_citation_at_all(monkeypatch):
    # #207's own review, reading real answers: a correct, well-formed
    # French answer that simply never names a reference is just as
    # unchecked as a wrong one — Jerome's own "leads to measure" list
    # names this directly.
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: _content("C'est interdit selon le règlement."),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_refuses_an_english_copy_of_the_passage(monkeypatch):
    # #207's own review, reading real answers against the real manual:
    # a 3B model asked for French sometimes copies the English passage
    # verbatim instead — not a typo, the whole thing.
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: _content(
            f"[G102] {CHUNK_TEXT} and this is not allowed at all."
        ),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_does_not_mistake_a_terse_french_answer_for_english(
    monkeypatch,
):
    # A short, jargon-heavy answer ("AUTO", "ROBOT") can lack every common
    # French function word without being English — only answers that
    # also carry a positive sign of English (a word like "the" or "and")
    # are refused for it.
    answer_text = "AUTO dure 30 secondes [6.1.2]."
    mock_ollama(monkeypatch, answer_text)

    assert generate_answer("Une question ?", [chunk(reference="6.1.2")]) == answer_text


def test_generate_answer_refuses_a_list_cut_off_with_nothing_complete_before_it(
    monkeypatch,
):
    # #207's own review: the model was cut off mid-list ("…, D.") and the
    # old trim logic kept the lone letter as if it ended a sentence,
    # leaving a visibly broken answer ("…, D.") on screen. Each lettered
    # marker (A., B., D.) is its own false sentence end; with nothing
    # else to fall back to, this refuses rather than show any of it.
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: _content(
            "Il est interdit de faire : A. grimper, B. pendre, D.",
            done_reason="length",
        ),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_trims_a_cut_off_list_back_to_the_sentence_before_it(
    monkeypatch,
):
    # Same cut-off list, but with a complete, citable sentence ahead of
    # it this time — trimming drops the whole broken list rather than
    # salvage a lettered fragment of it, same as it would drop any other
    # incomplete sentence.
    mock_ollama(
        monkeypatch,
        cited() + " Précisément : A. grimper, B. pendre, D.",
        done_reason="length",
    )

    assert generate_answer("Une question ?", [chunk()]) == cited()


def test_generate_answer_retries_after_a_bad_sample(monkeypatch):
    # The model is not deterministic: a wrong citation on the first draft
    # is not necessarily a wrong citation on the next one, and time is no
    # longer the constraint it once was (#207's own review).
    attempts = []

    def fake_urlopen(request, timeout):
        if _is_relevance_call(request):
            return _content("OUI")
        attempts.append(1)
        content = cited(ref="UNDISCLOSED") if len(attempts) == 1 else cited()
        return _content(content)

    monkeypatch.setattr("club.generation.urlopen", fake_urlopen)

    assert generate_answer("Une question ?", [chunk()]) == cited()
    assert len(attempts) == 2


def test_generate_answer_gives_up_after_every_attempt_fails(monkeypatch):
    attempts = []

    def fake_urlopen(request, timeout):
        attempts.append(1)
        return _content(cited(ref="UNDISCLOSED"))

    monkeypatch.setattr("club.generation.urlopen", fake_urlopen)

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])
    assert len(attempts) == generation.GENERATION_MAX_ATTEMPTS
