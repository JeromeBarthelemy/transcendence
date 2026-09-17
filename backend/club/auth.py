"""Reaching one password by either of two unique identifiers.

Not a second authentication method: the same account, the same hash, the same
checks. Only the lookup differs, because a twelve-year-old types their display
name and not an address on a domain that delivers nothing.
"""

from typing import Any

from django.contrib.auth.backends import ModelBackend
from django.http import HttpRequest

from .models import User


class DisplayNameBackend(ModelBackend):
    """Listed after ModelBackend, which keeps the email path untouched: this
    one is only reached once the address has failed. Inheriting rather than
    rewriting is what keeps the dummy-hash protection against enumeration."""

    def authenticate(
        self,
        request: HttpRequest | None,
        username: str | None = None,
        password: str | None = None,
        **kwargs: Any,
    ) -> User | None:
        if username is None:
            username = kwargs.get(User.USERNAME_FIELD)
        if username is None or password is None:
            return None
        try:
            # On the folded column, like the constraint: neither SQLite's
            # lower() nor its LIKE folds anything outside ASCII, so comparing
            # in the database would leave Élodie unable to sign in by name at
            # all. Python folded it on the way in; Python folds the attempt.
            user = User.objects.get(display_name_folded=username.casefold())
        except User.DoesNotExist:
            # Run the hasher anyway, so that an unknown name and a wrong
            # password take the same time to be refused.
            User().set_password(password)
            return None
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
