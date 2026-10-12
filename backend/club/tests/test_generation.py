import json
from urllib.error import URLError

import pytest

from club.generation import Answer, GenerationError, generate_answer

RULES = [
    ("G102", "Climbing on ARENA elements is prohibited."),
    ("G101", "A team member may not enter the FIELD during a MATCH."),
]
QUESTION = "Can we climb on the arena?"


class FakeResponse:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode()

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def mock_ollama(monkeypatch, content, captured=None):
    """Ollama answering `content` as the model's message."""

    def fake_urlopen(request, timeout):
        if captured is not None:
            captured["url"] = request.full_url
            captured["body"] = json.loads(request.data)
        return FakeResponse({"message": {"content": content}, "done_reason": "stop"})

    monkeypatch.setattr("club.generation.urlopen", fake_urlopen)


def reply(passages, text="No, climbing on ARENA elements is prohibited."):
    return json.dumps({"passages": passages, "reply": text})


def test_the_model_reads_every_rule_and_the_question(monkeypatch):
    captured: dict = {}
    mock_ollama(monkeypatch, reply(["G102"]), captured)

    generate_answer(QUESTION, RULES)

    assert captured["url"] == "http://ollama:11434/api/chat"
    body = captured["body"]
    assert body["model"] == "qwen3:4b-instruct-2507-q4_K_M"
    assert body["messages"][0]["role"] == "system"
    assert body["messages"][1]["content"] == (
        "Passages:\n\n"
        "[G102]\nClimbing on ARENA elements is prohibited.\n\n"
        "[G101]\nA team member may not enter the FIELD during a MATCH.\n\n"
        "Question: Can we climb on the arena?"
    )


def test_the_model_may_only_cite_the_rules_it_was_given(monkeypatch):
    captured: dict = {}
    mock_ollama(monkeypatch, reply(["G102"]), captured)

    generate_answer(QUESTION, RULES)

    passages = captured["body"]["format"]["properties"]["passages"]
    assert passages["items"]["enum"] == ["G102", "G101", "none"]
    assert passages["maxItems"] == 2


def test_the_same_question_gets_the_same_answer(monkeypatch):
    # Sampling would let one question get a right answer, then a wrong one.
    captured: dict = {}
    mock_ollama(monkeypatch, reply(["G102"]), captured)

    generate_answer(QUESTION, RULES)

    assert captured["body"]["options"]["temperature"] == 0
    # Ollama's default context would cut five whole rules short.
    assert captured["body"]["options"]["num_ctx"] == 8192


def test_the_reply_comes_back_with_the_rules_it_cites(monkeypatch):
    mock_ollama(monkeypatch, reply(["G102", "G101"], "  No.  "))

    assert generate_answer(QUESTION, RULES) == Answer("No.", ["G102", "G101"])


def test_a_reference_it_was_not_given_is_not_cited(monkeypatch):
    mock_ollama(monkeypatch, reply(["G102", "G999"]))

    assert generate_answer(QUESTION, RULES).references == ["G102"]


def test_none_means_no_rule_answers_the_question(monkeypatch):
    mock_ollama(monkeypatch, reply(["none"], "The passages do not say."))

    assert generate_answer(QUESTION, RULES).references == []


def test_an_unreachable_model_is_a_generation_error(monkeypatch):
    def unreachable(request, timeout):
        raise URLError("connection refused")

    monkeypatch.setattr("club.generation.urlopen", unreachable)

    with pytest.raises(GenerationError):
        generate_answer(QUESTION, RULES)


def test_an_answer_cut_before_its_end_is_a_generation_error(monkeypatch):
    mock_ollama(monkeypatch, '{"passages": ["G102"], "reply": "No, climb')

    with pytest.raises(GenerationError):
        generate_answer(QUESTION, RULES)


def test_a_blank_reply_citing_a_rule_is_a_generation_error(monkeypatch):
    mock_ollama(monkeypatch, reply(["G102"], "  "))

    with pytest.raises(GenerationError):
        generate_answer(QUESTION, RULES)
