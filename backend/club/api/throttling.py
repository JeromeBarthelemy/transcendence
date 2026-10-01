"""Slows a dictionary attack against one account, not one IP.

DRF's own `AnonRateThrottle` keys by the caller's address, which is the wrong
unit here: a shared club computer or a NAT'd room network must not throttle a
member typing their own correct password because someone else, on the same
address, just mistyped theirs on a different account.
"""

from rest_framework.request import Request
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView


class LoginThrottle(SimpleRateThrottle):
    scope = "login"

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        data = request.data
        username = data.get("username") if isinstance(data, dict) else None
        if not isinstance(username, str) or not username.strip():
            # Nothing to key an account-targeted attack on — the serializer
            # refuses an empty identifier on its own, throttle or not.
            return None
        return self.cache_format % {
            "scope": self.scope,
            "ident": username.strip().casefold(),
        }
