"""Writing the answer to a rulebook question from the rules `rag.ask`
found (#215).

One call to the model, in English like the manual and the question, whose
reply is held to a JSON schema: the one or two rules it relies on, picked
among those it was given, then a short reply. No check of the reply
afterwards: the student reads it under a warning that only the rules shown
are binding, and the rules shown are the ones the reply relies on.
Measurement 9 (76 questions, read by hand) found the checks tried before
refusing good answers more often than they caught wrong ones.

The model runs through Ollama (`compose.yml`'s `ollama` service), read from
settings so that trying another one is a `.env` change,
`RAG_GENERATION_MODEL`, not a code change.
"""

import json
from typing import NamedTuple
from urllib.request import Request, urlopen

from django.conf import settings

# Past this, the question falls back to the rules alone. A processor
# without a graphics card takes close to a minute per answer (measurement
# 9: ~55 s at the median on a 4-core i3).
GENERATION_TIMEOUT_SECONDS = 90
# Room for the JSON and a few sentences: a reply cut short is unreadable
# JSON, hence a refusal.
GENERATION_MAX_TOKENS = 600
# Five whole rules run past Ollama's default context, which would silently
# drop the start of the prompt.
CONTEXT_TOKENS = 8192
NONE = "none"

SYSTEM_PROMPT = (
    "You are Fieldbot. You answer questions from FIRST Tech Challenge team "
    "members, using only the competition manual passages given below.\n"
    "Reply in JSON, in this order:\n"
    '- "passages": the references of the one or two passages that answer the '
    'question, or ["none"] if no passage answers it.\n'
    '- "reply": one or two short sentences in plain English for a student. If '
    "the question can be answered by yes or no, start with Yes or No; otherwise "
    "start with the number or fact asked for. Then add the main condition or "
    "exception, if the passages give one. Base it on those passages, never "
    "contradict them, and do not mention rule numbers."
)


class GenerationError(Exception):
    """The model could not be reached, timed out, or answered with
    something unreadable. The caller falls back to showing the rules
    alone — never to inventing a sentence to fill the gap."""


class Answer(NamedTuple):
    reply: str
    # The rules the reply relies on; empty when the model found none of
    # them answering the question.
    references: list[str]


def _schema(references: list[str]) -> dict:
    """`passages` before `reply`: the model picks what it relies on
    before writing from it."""
    return {
        "type": "object",
        "properties": {
            "passages": {
                "type": "array",
                "items": {"type": "string", "enum": [*references, NONE]},
                "minItems": 1,
                "maxItems": 2,
            },
            "reply": {"type": "string"},
        },
        "required": ["passages", "reply"],
    }


def generate_answer(question: str, rules: list[tuple[str, str]]) -> Answer:
    """`rules` are `(reference, text)` pairs, in the order the model reads
    them."""
    references = list(dict.fromkeys(reference for reference, _ in rules if reference))
    passages = "\n\n".join(f"[{reference}]\n{text}" for reference, text in rules)
    body = json.dumps(
        {
            "model": settings.RAG_GENERATION_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f"Passages:\n\n{passages}\n\nQuestion: {question}",
                },
            ],
            "format": _schema(references),
            "stream": False,
            "options": {
                "temperature": 0,
                "num_ctx": CONTEXT_TOKENS,
                "num_predict": GENERATION_MAX_TOKENS,
            },
        }
    ).encode("utf-8")
    request = Request(
        f"{settings.RAG_OLLAMA_URL}/api/chat",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=GENERATION_TIMEOUT_SECONDS) as response:
            content = json.loads(response.read())["message"]["content"]
        data = json.loads(content)
        cited = [ref for ref in dict.fromkeys(data["passages"]) if ref in references]
        reply = data["reply"].strip()
    # OSError: unreachable or timed out; the rest: anything but the JSON asked.
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        raise GenerationError(str(error)) from error
    if cited and not reply:
        raise GenerationError("réponse du modèle vide")
    return Answer(reply, cited)
