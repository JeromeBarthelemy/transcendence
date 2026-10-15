"""A member's rights over their own data: a readable export, and deletion
with confirmation (docs/modules.md §10). Both travel by e-mail, and never to
the login address — it identifies an account without being assumed to
deliver, and the youngest members have none that does. The confirmation goes
to `contact_email` instead: the member's own for an adult, their legal
guardian's for a minor — the same column the AssoConnect import already
fills, read here for the first time.
"""

import json
from smtplib import SMTPException
from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.mail import EmailMessage
from django.db import transaction

from .api.permissions import not_the_last_admin
from .models import (
    ANONYMIZED_NAME,
    Consent,
    Membership,
    User,
    VerificationRequest,
    remove_after_commit,
)


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
    `anonymize` erases or already keeps — plus their memberships, the
    questions they asked the rulebook, and the notifications they received. Not the club's notebook: entries
    and their attachments are the team's history, kept and still
    attributed after a member leaves, and the notebook export serves a
    different reader, the portfolio, for a request this is not."""
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
        "rule_queries": [
            {
                "question": query.question,
                "answer": query.answer,
                "created_at": query.created_at.isoformat(),
            }
            for query in user.rule_queries.order_by("created_at")
        ],
        "notifications": [
            {
                "change": notice.get_verb_display(),
                "work_item": notice.work_item_title,
                # None for a new role, which concerns no team.
                "team": notice.team_season.team.name if notice.team_season else None,
                "season": notice.team_season.season.label
                if notice.team_season
                else None,
                "created_at": notice.created_at.isoformat(),
                "read_at": notice.read_at.isoformat() if notice.read_at else None,
            }
            for notice in user.notifications.order_by("created_at").select_related(
                "team_season__team", "team_season__season"
            )
        ],
    }


def _send(message: EmailMessage) -> None:
    """A request is confirmed by e-mail or not carried out. A relay that
    refuses, or none to reach — no network, no `EMAIL_HOST` — is said as
    such, not left to surface as a 500."""
    try:
        message.send()
    except (SMTPException, OSError):
        raise ValidationError(
            "Le courriel ne peut pas être envoyé pour le moment : rien n'a "
            "été fait. Réessayez plus tard.",
            code="mail_unavailable",
        ) from None


def send_export(user: User) -> str:
    """Fails before anything is sent if there is nowhere to send it —
    checked first, same backstop-first spirit as everywhere else the club
    validates before acting. The avatar rides as a second attachment, the
    only part of `export_data` that is not JSON-representable. Returns the
    address it went to, for the member to know where to look."""
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
    _send(
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
        )
    )
    return to


def anonymize(user: User) -> None:
    """What "deletion" actually means: `Entry.author` and
    `EntryParticipant.user` are `PROTECT` on purpose, so what a member
    wrote stays in the team's notebook, attributed. What goes is the
    identity — name, address, birth date, AssoConnect id, avatar,
    password, any pending verification request, the notifications received
    (those the member caused stay their recipients'), and any admin rights,
    which an unusable password leaves no way to exercise anyway. The
    consent log stays: it still decides whether past content may be
    published.

    Called only from `request_deletion` (a member's own request) or the
    Django admin's anonymize action (someone who has left) — never from a
    suspension, which is temporary, and this is not."""
    domain = settings.SIGNUP_RESERVED_EMAIL_DOMAIN
    previous_avatar = user.avatar.name
    user.display_name = f"{ANONYMIZED_NAME} {user.pk}"
    user.email = f"ancien-membre-{user.pk}@{domain}"
    user.contact_email = ""
    user.birth_date = None
    user.assoconnect_id = None
    user.avatar.name = ""
    user.set_unusable_password()
    user.is_active = False
    user.is_club_admin = False
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
            "is_club_admin",
        ]
    )
    remove_after_commit(user, previous_avatar)
    VerificationRequest.objects.filter(user=user).delete()
    user.notifications.all().delete()


@transaction.atomic
def request_deletion(user: User, *, password: str | None) -> str:
    """The right to erasure: confirmed by `password` (a session left open
    on a shared computer must not delete the account in one click), then
    anonymized. `password=None` skips that check — only the Django admin
    action passes it, since a staff sign-in already confirms who is acting.

    `not_the_last_admin` is checked inside this same transaction rather
    than before it, so two admins leaving at once are ordered by the
    database's own write lock (`transaction_mode: "IMMEDIATE"`,
    config/settings.py) instead of a stale read — `select_for_update()`
    would say the same thing but SQLite ignores it.

    The confirmation is sent after the transaction commits
    (`transaction.on_commit`), not from inside it: `IMMEDIATE` takes
    SQLite's write lock the moment this transaction opens, and every other
    write in the club would otherwise wait behind however long the SMTP
    relay takes to answer. `robust=True` logs a failed send rather than
    raising it — unlike `send_export`'s own call to `_send`, there is
    nothing left to undo by the time it would run: the anonymization is
    already committed. Returns the address the confirmation is being sent
    to, whether or not it arrives."""
    if password is not None and not user.check_password(password):
        raise ValidationError(
            "Mot de passe incorrect : le compte n'a pas été supprimé.",
            code="wrong_password",
        )
    to = _contact_email(user)  # checked first: no confirmation, no change.
    not_the_last_admin(user)
    display_name = user.display_name
    anonymize(user)
    transaction.on_commit(
        lambda: _send(
            EmailMessage(
                subject="Suppression de compte confirmée — Fieldnotes",
                body=(
                    "Bonjour,\n\n"
                    f"Le compte « {display_name} » a été supprimé à sa demande : "
                    "son identité a été effacée. Ce qu'il a écrit reste dans le "
                    "classeur de l'équipe.\n"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[to],
            )
        ),
        robust=True,
    )
    return to
