from datetime import date

from club.assoconnect.matching import (
    CLOSE_NAME,
    DISPUTED_NUMBER,
    SEVERAL_ACCOUNTS,
    Doubt,
    Match,
    reconcile,
)
from club.models import User
from club.tests.builders import account, line, verified_account


def test_a_request_that_says_the_same_person_is_matched_to_its_line():
    user = account()

    reconciliation = reconcile([line()])

    assert reconciliation.matched == [Match(line(), user)]
    assert reconciliation.waiting == []


def test_case_accents_and_hyphens_do_not_keep_a_line_from_its_account():
    user = account(last_name="dubois martin", first_name="andre")

    reconciliation = reconcile([line(last_name="DUBOIS-MARTIN", first_name="André")])

    assert reconciliation.matched == [
        Match(line(last_name="DUBOIS-MARTIN", first_name="André"), user)
    ]


def test_a_line_finds_the_account_already_carrying_its_member_number():
    user = verified_account("4521")
    account(last_name="Dubois", first_name="Marie")

    reconciliation = reconcile([line(last_name="Duboa", first_name="Mari")])

    assert [match.account for match in reconciliation.matched] == [user]


def test_a_line_nobody_claims_waits_for_its_account():
    reconciliation = reconcile([line()])

    assert reconciliation.matched == []
    assert reconciliation.waiting == [line()]


def test_a_neighbouring_name_on_the_same_birth_date_is_left_to_the_admin():
    sister = account(last_name="Dubois", first_name="Léa")

    reconciliation = reconcile([line()])

    assert reconciliation.matched == []
    assert reconciliation.to_decide == [Doubt(line(), sister, CLOSE_NAME)]


def test_two_accounts_claiming_one_line_are_both_left_to_the_admin():
    one = account(email="one@example.org")
    other = account(email="other@example.org")

    reconciliation = reconcile([line()])

    assert reconciliation.matched == []
    assert reconciliation.to_decide == [
        Doubt(line(), one, SEVERAL_ACCOUNTS),
        Doubt(line(), other, SEVERAL_ACCOUNTS),
    ]


def test_a_member_number_claimed_by_another_account_is_left_to_the_admin():
    verified_account("4521")
    claimant = account()

    reconciliation = reconcile([line()])

    assert reconciliation.matched == []
    assert reconciliation.to_decide == [Doubt(line(), claimant, DISPUTED_NUMBER)]


def test_a_verified_member_absent_from_the_export_is_listed_as_departed():
    gone = verified_account("9999", email="gone@example.org")
    verified_account("4521")

    reconciliation = reconcile([line()])

    assert reconciliation.departed == [gone]


def test_an_account_no_line_claims_is_listed_as_untied():
    stranger = account(
        email="paul@example.org",
        first_name="Paul",
        last_name="Martin",
        birth_date=date(2010, 1, 1),
    )

    reconciliation = reconcile([line()])

    assert reconciliation.untied == [stranger]


def test_an_account_without_a_request_is_listed_as_untied():
    admin = User.objects.create_user("admin@example.org", "admin")

    reconciliation = reconcile([line()])

    assert reconciliation.untied == [admin]


def test_an_account_matched_or_left_to_the_admin_is_not_listed_as_untied():
    account()
    account(email="leon@example.org", first_name="Léon", last_name="Bernard")
    verified_account("9999")

    reconciliation = reconcile(
        [line(), line(assoconnect_id="7000", first_name="Léon", last_name="Martin")]
    )

    assert reconciliation.untied == []


def test_a_deactivated_account_is_not_listed_as_untied():
    stranger = User.objects.create_user("test@example.org", "test")
    stranger.is_active = False
    stranger.save()

    reconciliation = reconcile([line()])

    assert reconciliation.untied == []
