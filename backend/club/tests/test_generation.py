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
