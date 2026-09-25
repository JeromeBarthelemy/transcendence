"""A member's rights over their own data: a readable export, and deletion
with confirmation (docs/modules.md §10). Both travel by e-mail, and never to
the login address — it identifies an account without being assumed to
deliver, and the youngest members have none that does. The confirmation goes
to `contact_email` instead: the member's own for an adult, their legal
guardian's for a minor — the same column the AssoConnect import already
fills, read here for the first time.
"""

import json
from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.mail import EmailMessage, send_mail
from django.db import transaction

from .api.permissions import not_the_last_admin
from .models import Consent, Membership, User, VerificationRequest, remove_after_commit


def _contact_email(user: User) -> str:
    if not user.contact_email:
        raise ValidationError(
            "Aucune adresse de contact n'est enregistrée pour ce compte : "
            "impossible d'envoyer la confirmation.",
            code="no_contact_email",
        )
    return user.contact_email


def export_data(user: User) -> dict[str, Any]:
    """The member's own identity and account-level decisions — exactly what
    `anonymize` erases or already keeps — plus their memberships. Not the
    club's notebook: entries and their attachments are the team's history,
    kept and still attributed after a member leaves, and that export (#38)
    serves a different reader, the portfolio, for a request this is not."""
    verification = getattr(user, "verification_request", None)
    return {
        "display_name": user.display_name,
        "email": user.email,
        "contact_email": user.contact_email,
        "club_role": user.club_role,
        "is_club_admin": user.is_club_admin,
        "birth_date": user.birth_date.isoformat() if user.birth_date else None,
        "assoconnect_id": user.assoconnect_id,
        "date_joined": user.date_joined.isoformat(),
        "pending_verification": (
            {
                "first_name": verification.first_name,
                "last_name": verification.last_name,
                "declared_birth_date": verification.birth_date.isoformat(),
            }
            if verification is not None
            else None
        ),
        "memberships": [
            {
                "team": membership.team_season.team.name,
                "season": membership.team_season.season.label,
            }
            for membership in Membership.objects.filter(user=user).select_related(
                "team_season__team", "team_season__season"
            )
        ],
        "image_rights_decisions": [
            {
                "decision": consent.decision,
                "decided_at": consent.decided_at.isoformat(),
            }
            for consent in Consent.objects.filter(user=user)
        ],
    }


def send_export(user: User) -> None:
    """Fails before anything is sent if there is nowhere to send it —
    checked first, same backstop-first spirit as everywhere else the club
    validates before acting. The avatar rides as a second attachment, the
    only part of `export_data` that is not JSON-representable."""
    to = _contact_email(user)
    payload = json.dumps(export_data(user), indent=2, ensure_ascii=False)
    attachments = [("export.json", payload, "application/json")]
    if user.avatar:
        user.avatar.open("rb")
        try:
            # AvatarSerializer only ever writes WEBP (club/api/serializers.py),
            # whatever format the original upload came in — read here, not
            # guessed, since there is exactly one format to expect.
            attachments.append(("avatar.webp", user.avatar.read(), "image/webp"))
        finally:
            user.avatar.close()
    EmailMessage(
        subject="Export de vos données — Fieldnotes",
        body=(
            "Bonjour,\n\n"
            f"Voici l'export des données du compte « {user.display_name} », "
            "en pièce jointe, au format lisible (JSON).\n"
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[to],
        attachments=attachments,
    ).send()


def anonymize(user: User) -> None:
    """What "deletion" actually means (the privacy policy settled in #79):
    `Entry.author` and `EntryParticipant.user` are `PROTECT` on purpose —
    what a member wrote belongs to the team's history and stays in its
    notebook, attributed. What goes is the identity: `display_name` becomes
    "Ancien membre" plus the account's own id, already unique; `email`
    likewise on the reserved `.invalid` domain sign-up already uses for an
    address nobody gave (`club/signup.py`); `contact_email`, `birth_date`
    and `assoconnect_id` cleared; the avatar removed, file included (the
    same after-commit removal as #77); the password made unusable; the
    pending verification request, if any, deleted — it would otherwise
    name someone this account no longer says it is. The consent log stays:
    it still decides whether the member's past content may be published.

    Two callers, and only these two: a member's own deletion request, once
    its confirmation is sent (`request_deletion`), and a club admin
    anonymizing someone who has left, from the Django admin. Deactivating an
    account (#88's suspension) must never reach here — a suspension is
    temporary, and this is not."""
    domain = settings.SIGNUP_RESERVED_EMAIL_DOMAIN
    previous_avatar = user.avatar.name
    user.display_name = f"Ancien membre {user.pk}"
    user.email = f"ancien-membre-{user.pk}@{domain}"
    user.contact_email = ""
    user.birth_date = None
    user.assoconnect_id = None
    user.avatar.name = ""
    user.set_unusable_password()
    user.is_active = False
    user.save(
        update_fields=[
            "display_name",
            "email",
            "contact_email",
            "birth_date",
            "assoconnect_id",
            "avatar",
            "password",
            "is_active",
        ]
    )
    remove_after_commit(user, previous_avatar)
    VerificationRequest.objects.filter(user=user).delete()


@transaction.atomic
def request_deletion(user: User) -> None:
    """The right to erasure, an anonymization rather than a row deleted
    (`anonymize`) — `Entry.author` and `EntryParticipant.user` are
    `PROTECT`, so a literal delete would either orphan a member's traces or
    be refused outright the moment they have any, which is almost everyone.

    Atomic, the confirmation e-mail last: a failed send must leave the
    account exactly as it was, or a member who could not be told would also
    be unable to sign back in and ask again. `not_the_last_admin` is
    checked inside this same transaction, not before it, so a second admin
    leaving at the same instant is checked against this one's write rather
    than a count read before it — `config/settings.py` takes the database's
    write lock the moment the transaction opens (`transaction_mode:
    "IMMEDIATE"`), which is what actually orders the two; SQLite ignores
    `select_for_update()` outright (`has_select_for_update` is `False`), so
    that would guard nothing here."""
    to = _contact_email(user)  # checked first: no confirmation, no change.
    not_the_last_admin(user)
    display_name = user.display_name
    anonymize(user)
    send_mail(
        subject="Suppression de compte confirmée — Fieldnotes",
        message=(
            "Bonjour,\n\n"
            f"Le compte « {display_name} » a été supprimé à sa demande : son "
            "identité a été effacée. Ce qu'il a écrit reste dans le classeur "
            "de l'équipe.\n"
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[to],
    )
