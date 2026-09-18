"""Small project-level views that do not belong to a domain app."""

from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_GET


@require_GET
def health_check(_request: HttpRequest) -> JsonResponse:
    """Confirm that the Django process is ready to answer the frontend."""
    return JsonResponse({"status": "ok"})
