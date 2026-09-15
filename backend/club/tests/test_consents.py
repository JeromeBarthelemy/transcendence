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

    assert Consent.objects.in_force_for(ada).decision == Consent.Decision.REFUSED


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

    assert Consent.objects.in_force_for(ada).decision == Consent.Decision.GRANTED


def test_refusals_list_only_members_whose_latest_decision_is_a_refusal():
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

    # An unknown member is protected like a refusal elsewhere, but is not one.
    assert list(Consent.objects.refusals()) == [refused]
    assert unknown not in Consent.objects.refusals()
