"""Permissions beyond authenticated-or-not, which is all DRF's own classes
know how to say."""

from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView


class IsClubAdmin(BasePermission):
    """Creating, renaming or deleting a team is an administrative act. Self-
    contained rather than paired with `IsAuthenticated`: an anonymous caller
    has `request.user` set to Django's `AnonymousUser`, which answers
    `is_authenticated` before anything tries to read `is_club_admin` off it —
    a field it does not have."""

    def has_permission(self, request: Request, view: APIView) -> bool:
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.is_club_admin
        )
