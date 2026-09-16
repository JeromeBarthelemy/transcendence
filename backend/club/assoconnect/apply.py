"""Writing what the reconciliation settled.

Only the matched lines are applied: a doubt is the club admin's to settle, and
a member the export no longer states is never deactivated here.
"""

from datetime import date, datetime, time

from django.db import transaction
from django.utils import timezone

from club.models import Consent, User, VerificationRequest

from .matching import Reconciliation


@transaction.atomic
def apply(reconciliation: Reconciliation) -> None:
    """All or nothing again: a half-applied import would leave nobody able to
    say where it stopped."""
    for match in reconciliation.matched:
        account, row = match.account, match.row
        # The export establishes the birth date; what the account declared at
        # sign-up never decided anything.
        account.assoconnect_id = row.assoconnect_id
        account.birth_date = row.birth_date
        account.save(update_fields=["assoconnect_id", "birth_date"])
        # The request has nothing left to prove.
        VerificationRequest.objects.filter(user=account).delete()
        _decide_image_rights(account, row)


def _decide_image_rights(account: User, row) -> None:
    """A ticked refusal refuses, a signed document grants, and neither says
    nothing at all: silence is not a decision."""
    if row.image_rights_refused:
        decision = Consent.Decision.REFUSED
    elif row.image_rights_signed:
        decision = Consent.Decision.GRANTED
    else:
        return
    # The journal records decisions, not repetitions: an import that states
    # again what is already in force leaves no trace.
    in_force = Consent.objects.in_force_for(account)
    if in_force is not None and in_force.decision == decision:
        return
    Consent.objects.create(
        user=account,
        decision=decision,
        # The capacity is the one held on the day of the signature: becoming an
        # adult since does not rewrite who signed.
        granted_by=(
            Consent.GrantedBy.LEGAL_GUARDIAN
            if account.is_minor_on(row.decided_on)
            else Consent.GrantedBy.SELF
        ),
        decided_at=_at(row.decided_on),
    )


def _at(day: date) -> datetime:
    """The export gives a day, a decision is an instant: midnight, local."""
    return timezone.make_aware(datetime.combine(day, time.min))
