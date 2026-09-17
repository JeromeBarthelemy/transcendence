"""Giving an identifier to whoever has no address.

The address identifies an account; it is not assumed to be a mailbox. Whoever
has one gives it, and whoever has none is given one here — on a domain that
can never deliver, so that nothing is ever silently lost.
"""

from django.conf import settings
from django.utils.text import slugify

from .models import User


def reserved_email(first_name: str, last_name: str) -> str:
    """An address on the reserved domain, free at the moment it returns.

    Free "at the moment it returns" and not for ever: the caller saves inside
    the same transaction, and the unique index on email is what actually
    decides. This only spares the common case a pointless refusal.
    """
    stem = ".".join(part for part in (slugify(first_name), slugify(last_name)) if part)
    # slugify drops anything it cannot transliterate, so a name written in
    # another script can flatten to nothing — which would build "@domain".
    stem = stem or "membre"
    domain = settings.SIGNUP_RESERVED_EMAIL_DOMAIN
    candidate = f"{stem}@{domain}"
    # Two namesakes in one club is a collision to number, not a mistake to
    # refuse.
    suffix = 1
    while User.objects.filter(email=candidate).exists():
        suffix += 1
        candidate = f"{stem}{suffix}@{domain}"
    return candidate
