from datetime import date, datetime, time

import pytest
from django.db import IntegrityError
from django.utils import timezone

from club.assoconnect.apply import apply
from club.assoconnect.matching import Match, Reconciliation, reconcile
from club.models import Consent, VerificationRequest
from club.tests.builders import BORN, ORDERED_ON, account, line

# The export gives a day; a decision is an instant.
ORDERED_AT = timezone.make_aware(datetime.combine(ORDERED_ON, time.min))


def reconciliation(*matches):
    """Only the matched lines are applied; the other three lists are shown to
    the club admin, never acted on."""
    return Reconciliation(matched=list(matches), to_decide=[], waiting=[], departed=[])


def test_a_matched_account_takes_its_member_number_and_birth_date():
    user = account()

    apply(reconciliation(Match(line(), user)))

    user.refresh_from_db()
    assert user.assoconnect_id == "4521"
    assert user.birth_date == BORN


def test_a_verified_account_no_longer_has_a_verification_request():
    user = account()

    apply(reconciliation(Match(line(), user)))

    assert not VerificationRequest.objects.filter(user=user).exists()


def test_a_ticked_refusal_becomes_a_refused_decision():
    user = account()

    apply(reconciliation(Match(line(image_rights_refused=True), user)))

    (decision,) = Consent.objects.filter(user=user)
    assert decision.decision == Consent.Decision.REFUSED
    assert decision.decided_at == ORDERED_AT


def test_a_signed_document_becomes_a_decision_dated_from_the_order():
    user = account()

    apply(reconciliation(Match(line(), user)))

    (decision,) = Consent.objects.filter(user=user)
    assert decision.decision == Consent.Decision.GRANTED
    assert decision.decided_at == ORDERED_AT


def test_neither_document_nor_refusal_decides_nothing():
    user = account()

    apply(reconciliation(Match(line(image_rights_signed=False), user)))

    assert not Consent.objects.filter(user=user).exists()


def test_a_minor_has_their_legal_guardian_sign():
    user = account()

    apply(reconciliation(Match(line(), user)))

    (decision,) = Consent.objects.filter(user=user)
    assert decision.granted_by == Consent.GrantedBy.LEGAL_GUARDIAN


def test_a_member_of_age_on_the_day_signs_for_themselves():
    user = account(birth_date=date(1976, 6, 8))

    apply(reconciliation(Match(line(birth_date=date(1976, 6, 8)), user)))

    (decision,) = Consent.objects.filter(user=user)
    assert decision.granted_by == Consent.GrantedBy.SELF


def test_the_same_export_applied_twice_leaves_one_decision():
    user = account()
    rows = [line()]

    apply(reconcile(rows))
    apply(reconcile(rows))

    assert Consent.objects.filter(user=user).count() == 1


def test_a_line_that_fails_applies_none_of_the_others():
    first = account(email="one@example.org")
    second = account(email="two@example.org", last_name="Duval")

    # Two accounts given one member number: the second save breaks its unique
    # constraint, and the first must fall with it.
    with pytest.raises(IntegrityError):
        apply(reconciliation(Match(line(), first), Match(line(), second)))

    first.refresh_from_db()
    assert first.assoconnect_id is None
