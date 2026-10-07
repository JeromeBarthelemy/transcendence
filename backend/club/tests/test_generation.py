import json

import pytest

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
    assert captured["body"]["options"]["num_predict"] == 200
    assert captured["body"]["messages"][0]["role"] == "system"
    user_message = captured["body"]["messages"][1]["content"]
    assert "[G102] Climbing on ARENA elements is prohibited." in user_message
    assert "Peut-on grimper sur le terrain ?" in user_message


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


def test_generate_answer_trims_a_token_cut_answer_to_its_last_full_sentence(
    monkeypatch,
):
    # GENERATION_MAX_TOKENS can stop the model mid-word; the answer still
    # reads as finished once trimmed back to the sentence before the cut.
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: FakeResponse(
            json.dumps(
                {"message": {"content": "Interdit, selon [G102]. Autre chose non ter"}}
            ).encode()
        ),
    )

    assert generate_answer("Une question ?", [chunk()]) == "Interdit, selon [G102]."


def test_generate_answer_refuses_an_answer_cut_before_any_full_sentence(monkeypatch):
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: FakeResponse(
            json.dumps(
                {"message": {"content": "Selon [G102], il est permis de"}}
            ).encode()
        ),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])


def test_generate_answer_refuses_a_citation_shortened_to_its_bare_number(monkeypatch):
    monkeypatch.setattr(
        "club.generation.urlopen",
        lambda request, timeout: FakeResponse(
            json.dumps({"message": {"content": "Interdit, selon [102]."}}).encode()
        ),
    )

    with pytest.raises(GenerationError):
        generate_answer("Une question ?", [chunk()])
