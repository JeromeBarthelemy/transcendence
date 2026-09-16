from datetime import datetime, timedelta, timezone

from club.models import Consent, User

SEPTEMBER = datetime(2026, 9, 1, tzinfo=timezone.utc)


def test_a_later_decision_overrides_an_earlier_one():
    ada = User.objects.create_user("ada@club.fr", "Ada")
    Consent.objects.create(
        user=ada,
        decision=Consent.Decision.GRANTED,
        granted_by=Consent.GrantedBy.LEGAL_GUARDIAN,
        decided_at=SEPTEMBER,
    )
    Consent.objects.create(
        user=ada,
        decision=Consent.Decision.REFUSED,
        granted_by=Consent.GrantedBy.LEGAL_GUARDIAN,
        decided_at=SEPTEMBER + timedelta(days=30),
    )

    in_force = Consent.objects.in_force_for(ada)
    assert in_force is not None
    assert in_force.decision == Consent.Decision.REFUSED


def test_no_decision_means_unknown():
    ada = User.objects.create_user("ada@club.fr", "Ada")

    assert Consent.objects.in_force_for(ada) is None


def test_two_decisions_at_the_same_moment_are_settled_by_the_later_record():
    ada = User.objects.create_user("ada@club.fr", "Ada")
    for decision in (Consent.Decision.REFUSED, Consent.Decision.GRANTED):
        Consent.objects.create(
            user=ada,
            decision=decision,
            granted_by=Consent.GrantedBy.SELF,
            decided_at=SEPTEMBER,
        )

    in_force = Consent.objects.in_force_for(ada)
    assert in_force is not None
    assert in_force.decision == Consent.Decision.GRANTED


def test_refusals_are_the_refusals_in_force_and_nothing_else():
    refused = User.objects.create_user("refused@club.fr", "Refused")
    changed_mind = User.objects.create_user("changed@club.fr", "Changed mind")
    unknown = User.objects.create_user("unknown@club.fr", "Unknown")

    def decide(user, decision, days):
        Consent.objects.create(
            user=user,
            decision=decision,
            granted_by=Consent.GrantedBy.LEGAL_GUARDIAN,
            decided_at=SEPTEMBER + timedelta(days=days),
        )

    decide(refused, Consent.Decision.REFUSED, 0)
    decide(changed_mind, Consent.Decision.REFUSED, 0)
    decide(changed_mind, Consent.Decision.GRANTED, 10)

    refusals = Consent.objects.refusals()

    # The publishing screen shows who refused and since when: decisions, not
    # just members. An unknown member is protected like a refusal elsewhere,
    # but is not one.
    assert [decision.user for decision in refusals] == [refused]
    assert refusals[0].decision == Consent.Decision.REFUSED
    assert unknown not in [decision.user for decision in refusals]
