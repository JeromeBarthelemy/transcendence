import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError

from club.models import User


def test_two_accounts_cannot_share_a_name_differing_only_by_case():
    User.objects.create_user("lina@club.fr", "Lina")

    with pytest.raises(IntegrityError):
        User.objects.create_user("lina.b@club.fr", "lina")


def test_validation_suggests_an_initial_rather_than_reporting_a_constraint():
    # The message is read by a twelve-year-old, so it says what to do next.
    User.objects.create_user("lina@club.fr", "Lina")
    duplicate = User(email="lina.b@club.fr", display_name="LINA")
    duplicate.set_unusable_password()

    with pytest.raises(ValidationError) as excinfo:
        duplicate.full_clean()

    assert "déjà pris" in str(excinfo.value)
    assert "initiale" in str(excinfo.value)


def test_the_refusal_carries_a_code_the_front_end_can_branch_on():
    # The sentence is for the person, the code is for the page: rewording one
    # must never break the other.
    User.objects.create_user("lina@club.fr", "Lina")
    duplicate = User(email="lina.b@club.fr", display_name="LINA")
    duplicate.set_unusable_password()

    with pytest.raises(ValidationError) as excinfo:
        duplicate.full_clean()

    codes = [
        error.code for errors in excinfo.value.error_dict.values() for error in errors
    ]
    assert "display_name_taken" in codes


def test_a_display_name_can_hold_no_at_sign():
    # Without this, a display name could impersonate an address and the two
    # login paths of Task 4 would stop being tellable apart.
    impostor = User(email="lina@club.fr", display_name="ada@club.fr")
    impostor.set_unusable_password()

    with pytest.raises(ValidationError) as excinfo:
        impostor.full_clean()

    assert "display_name" in excinfo.value.message_dict


def test_two_different_names_are_both_allowed():
    User.objects.create_user("lina@club.fr", "Lina")
    User.objects.create_user("lina.b@club.fr", "Lina B.")

    assert User.objects.count() == 2


def test_an_accented_name_is_taken_whatever_case_is_typed():
    # SQLite's lower() stops at ASCII, so a constraint computed in the
    # database would let Élodie and élodie both exist — and a French club is
    # full of the names it would miss.
    User.objects.create_user("elodie@club.fr", "Élodie")

    with pytest.raises(IntegrityError):
        User.objects.create_user("elodie.g@club.fr", "élodie")
