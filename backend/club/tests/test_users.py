import pytest
from django.contrib.auth import authenticate
from django.core.exceptions import ValidationError
from django.db import IntegrityError

from club.models import User


def test_create_user_refuses_an_email_differing_only_by_case():
    User.objects.create_user("ada@club.fr", "Ada")

    with pytest.raises(IntegrityError):
        User.objects.create_user("Ada@club.fr", "Ada L.")


def test_validation_reports_an_email_differing_only_by_case():
    # The admin forms validate with full_clean() before saving: the duplicate
    # must surface there as a form error, not as an IntegrityError on save.
    User.objects.create_user("ada@club.fr", "Ada")
    duplicate = User(email="Ada@club.fr", display_name="Ada L.")
    duplicate.set_unusable_password()

    with pytest.raises(ValidationError) as excinfo:
        duplicate.full_clean()

    assert "email" in excinfo.value.message_dict


def test_login_finds_the_account_whatever_case_is_typed():
    user = User.objects.create_user("ada@club.fr", "Ada", password="rouage-bleu-2026")

    assert authenticate(username="Ada@club.fr", password="rouage-bleu-2026") == user
