import json

import pytest

from club import generation
from club.generation import GenerationError, generate_answer
from club.models import Chunk, Document, Season


def chunk(reference="G102", text="Climbing on ARENA elements is prohibited."):
    document = Document.objects.create(
        season=Season.objects.create(start_year=2026, game_name="BioBuzz"),
        source=Document.Source.GAME_MANUAL,
        authority=Document.Authority.BINDING,
        title="Manuel de jeu",
    )
    return Chunk.objects.create(
        document=document, ordinal=1, reference=reference, text=text
    )


class FakeResponse:
    def __init__(self, body: bytes):
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_generate_answer_reads_the_models_own_message(monkeypatch):
    captured = {}

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["body"] = json.loads(request.data)
        captured["timeout"] = timeout
        return FakeResponse(
            json.dumps({"message": {"content": "  Oui, selon [G102].  "}}).encode()
        )

    monkeypatch.setattr("club.generation.urlopen", fake_urlopen)

    answer = generate_answer("Peut-on grimper sur le terrain ?", [chunk()])

    assert answer == "Oui, selon [G102]."
    assert captured["url"] == "http://ollama:11434/api/chat"
    assert captured["body"]["model"] == "qwen2.5:3b"
    assert captured["body"]["stream"] is False
    assert (
        captured["body"]["options"]["num_predict"] == generation.GENERATION_MAX_TOKENS
    )
    assert captured["body"]["messages"][0]["role"] == "system"
    user_message = captured["body"]["messages"][1]["content"]
    assert "[G102] Climbing on ARENA elements is prohibited." in user_message
    assert "Peut-on grimper sur le terrain ?" in user_message


def test_generate_answer_truncates_a_passage_longer_than_the_cap(monkeypatch):
    # A real passage runs past GENERATION_MAX_PASSAGE_CHARS more often than
    # not (club/rag.py: ~850 characters on average) — the prompt the model
    # actually reads is what this caps, not the citation shown underneath.
    long_text = "Mot " * 100
    captured = {}

    def fake_urlopen(request, timeout):
        captured["body"] = json.loads(request.data)
        return FakeResponse(json.dumps({"message": {"content": "Oui."}}).encode())

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
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: FakeResponse(
            json.dumps({"message": {"content": "Interdit, selon [G102]."}}).encode()
        ),
    )

    assert generate_answer("Une question ?", [chunk()]) == "Interdit, selon [G102]."


def test_generate_answer_refuses_a_citation_that_was_never_retrieved(monkeypatch):
    # #135's own 100-question review, run against the real manual: about one
    # matched answer in five cited a reference `ask` never retrieved — a
    # shortened one (G102 -> 102), a misspelled one, or, once, a reference
    # that does not exist anywhere in the manual. A wrong citation reads as
    # checkable and is not, which is worse than none: the whole answer is
    # refused rather than trusting it with one bad reference quietly kept.
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: FakeResponse(
            json.dumps(
                {"message": {"content": "Interdit, selon [G102] et [UNDISCLOSED]."}}
            ).encode()
        ),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def _content(text, done_reason="stop"):
    return FakeResponse(
        json.dumps({"message": {"content": text}, "done_reason": done_reason}).encode()
    )


def test_generate_answer_trims_a_token_cut_answer_to_its_last_full_sentence(
    monkeypatch,
):
    # GENERATION_MAX_TOKENS can stop the model mid-word; the answer still
    # reads as finished once trimmed back to the sentence before the cut.
    # Ollama's own done_reason ("length") is what says a cut actually
    # happened — without it, trimming never runs at all.
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: _content(
            "Interdit, selon [G102]. Autre chose non ter", done_reason="length"
        ),
    )

    assert generate_answer("Une question ?", [chunk()]) == "Interdit, selon [G102]."


def test_generate_answer_refuses_an_answer_cut_before_any_full_sentence(monkeypatch):
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: _content(
            "Selon [G102], il est permis de", done_reason="length"
        ),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_does_not_trim_an_answer_that_finished_on_its_own(monkeypatch):
    # #207's own review: a model ending right on its citation, with no
    # final full stop, is a common and legitimate way to finish — not a
    # sign of a cut. done_reason "stop" (or anything but "length") must
    # leave it alone rather than go looking for a sentence to "complete".
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: _content(
            "AUTO dure 30 secondes [6.1.2]", done_reason="stop"
        ),
    )

    assert (
        generate_answer("Une question ?", [chunk(reference="6.1.2")])
        == "AUTO dure 30 secondes [6.1.2]"
    )


def test_generate_answer_trims_without_mistaking_a_dotted_reference_for_the_cut(
    monkeypatch,
):
    # #207's own review: the old cut-at-the-last-dot logic found the dots
    # inside [11.3.4] itself and sliced the citation in half. The real
    # sentence boundary is the one after "Vrai.", not inside a reference.
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: _content(
            "Vrai. Selon la règle [11.3.4] les robo", done_reason="length"
        ),
    )

    assert generate_answer("Une question ?", [chunk(reference="11.3.4")]) == "Vrai."


def test_generate_answer_refuses_a_citation_shortened_to_its_bare_number(monkeypatch):
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: _content("Interdit, selon [102]."),
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
        lambda request, timeout: _content("Selon la (règle 9.9.9)."),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_refuses_a_hyphenated_reference_not_retrieved(monkeypatch):
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: _content("Interdit, selon [G-102]."),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_does_not_mistake_an_ordinary_parenthetical_for_a_citation(
    monkeypatch,
):
    # No digit, no reference: an aside in parentheses must not be read as
    # an attempted citation and refused for failing to match one.
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: _content("Interdit (sauf exception), selon [G102]."),
    )

    assert (
        generate_answer("Une question ?", [chunk()])
        == "Interdit (sauf exception), selon [G102]."
    )
