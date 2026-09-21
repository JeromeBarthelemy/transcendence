"""One refusal, said twice.

A code the front end branches on, and a sentence the person reads. Matching on
the sentence would make every rewording a front-end bug; shipping the code
alone would push a translation catalogue into a project that serves one club
in one language. So both travel together, always.

The code is English and the message French, which is the repo's rule rather
than an exception to it: a code is code — branched on, never read.
"""

from typing import Any

from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.status import HTTP_409_CONFLICT
from rest_framework.views import exception_handler as drf_exception_handler


class Conflict(APIException):
    """The request was well-formed — a `ValidationError` (400) would be the
    wrong signal — but the database refuses it because of a row that still
    depends on the one being changed, a `ProtectedError` underneath. Deleting
    a team with a season history is the first case; more will reuse this."""

    status_code = HTTP_409_CONFLICT
    default_code = "conflict"
    default_detail = (
        "Cette suppression entrerait en conflit avec l'historique existant."
    )


def _with_codes(value: Any) -> Any:
    """DRF already carries the code on the message itself: everything it
    raises is an ErrorDetail, a str subclass with a `.code`. Nothing is
    invented here — it is only stopped from being thrown away."""
    if isinstance(value, list):
        return [_with_codes(item) for item in value]
    if isinstance(value, dict):
        return {key: _with_codes(item) for key, item in value.items()}
    return {"code": getattr(value, "code", "invalid"), "message": str(value)}


def exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    """Returning None lets DRF re-raise, which is what turns a programming
    error into a 500 and a logged traceback rather than a tidy JSON lie.

    Only reached for refusals that are *raised*: a view returning a 400 itself
    never passes through here, which is why every view calls
    `is_valid(raise_exception=True)`.
    """
    response = drf_exception_handler(exc, context)
    if response is None:
        return None
    # The shape DRF chose is kept — errors stay keyed by field, so the page can
    # put each one under its own box. Only each message becomes a pair.
    response.data = _with_codes(response.data)
    return response
