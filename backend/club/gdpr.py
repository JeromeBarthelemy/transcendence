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

from .models import Consent, Membership, User


def _contact_email(user: User) -> str:
    if not user.contact_email:
        raise ValidationError(
            "Aucune adresse de contact n'est enregistrée pour ce compte : "
            "impossible d'envoyer la confirmation.",
            code="no_contact_email",
        )
    return user.contact_email


def export_data(user: User) -> dict[str, Any]:
    """Everything the account itself holds about its owner. Not the club's
    notebook — that export (#38) serves a different reader, the portfolio,
    and it is not a personal-data request."""
    return {
        "display_name": user.display_name,
        "email": user.email,
        "contact_email": user.contact_email,
        "club_role": user.club_role,
        "is_club_admin": user.is_club_admin,
        "birth_date": user.birth_date.isoformat() if user.birth_date else None,
        "date_joined": user.date_joined.isoformat(),
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
    validates before acting."""
    to = _contact_email(user)
    payload = json.dumps(export_data(user), indent=2, ensure_ascii=False)
    EmailMessage(
        subject="Export de vos données — Fieldnotes",
        body=(
            "Bonjour,\n\n"
            f"Voici l'export des données du compte « {user.display_name} », "
            "en pièce jointe, au format lisible (JSON).\n"
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[to],
        attachments=[("export.json", payload, "application/json")],
    ).send()


def request_deletion(user: User) -> None:
    """Deactivates rather than deletes: `Entry.author` and
    `EntryParticipant.user` are `PROTECT`, so a literal delete would either
    orphan a member's traces or be refused the moment they have any — which
    is almost everyone. `is_active=False` is the same state AssoConnect
    verification already uses for someone who has left."""
    to = _contact_email(user)  # checked first: no confirmation, no change.
    user.is_active = False
    user.save(update_fields=["is_active"])
    send_mail(
        subject="Suppression de compte confirmée — Fieldnotes",
        message=(
            "Bonjour,\n\n"
            f"Le compte « {user.display_name} » a été supprimé à sa demande.\n"
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[to],
    )
