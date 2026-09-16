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


def test_an_account_created_without_a_password_cannot_be_signed_into():
    ada = User.objects.create_user("ada@club.fr", "Ada")

    assert not ada.has_usable_password()


def test_an_account_protects_by_default():
    ada = User.objects.create_user("ada@club.fr", "Ada")

    assert ada.is_minor
    assert ada.club_role == User.ClubRole.STUDENT
    assert not ada.is_club_admin
    assert not ada.is_staff


def test_the_first_account_is_a_mentor_who_administrates():
    root = User.objects.create_superuser("root@club.fr", "Root", "rouage-bleu-2026")

    assert root.is_mentor
    assert root.is_club_admin
    assert root.is_staff


def test_a_superuser_without_admin_access_is_refused():
    with pytest.raises(ValueError):
        User.objects.create_superuser("root@club.fr", "Root", is_staff=False)


def test_is_mentor_tells_the_two_roles_apart():
    student = User.objects.create_user("ada@club.fr", "Ada")
    mentor = User.objects.create_user(
        "sam@club.fr", "Sam", club_role=User.ClubRole.MENTOR
    )

    assert not student.is_mentor
    assert mentor.is_mentor
