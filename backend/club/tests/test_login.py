from django.contrib.auth import authenticate

from club.models import User

PASSWORD = "rouage-bleu-2026"


def test_the_address_still_signs_in():
    # The subject's minimum, untouched: email and password.
    ada = User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)

    assert authenticate(username="ada@club.fr", password=PASSWORD) == ada


def test_the_display_name_signs_in_too():
    ada = User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)

    assert authenticate(username="Ada", password=PASSWORD) == ada


def test_the_display_name_signs_in_whatever_case_is_typed():
    ada = User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)

    assert authenticate(username="aDa", password=PASSWORD) == ada


def test_a_wrong_password_is_refused_on_the_display_name_path_too():
    User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)

    assert authenticate(username="Ada", password="pas-le-bon") is None


def test_an_unknown_display_name_is_refused():
    assert authenticate(username="Personne", password=PASSWORD) is None


def test_a_deactivated_account_is_refused_on_the_display_name_path():
    # A member who left keeps their account, deactivated, so their traces
    # stay attributed — it must not sign in.
    User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD, is_active=False)

    assert authenticate(username="Ada", password=PASSWORD) is None


def test_an_account_without_a_usable_password_is_refused():
    User.objects.create_user("ada@club.fr", "Ada")

    assert authenticate(username="Ada", password=PASSWORD) is None


def test_an_accented_name_signs_in():
    # The folding happens in Python on both sides. Were it left to SQLite,
    # Élodie could not sign in by name at all — not even by typing it right.
    elodie = User.objects.create_user("elodie@club.fr", "Élodie", password=PASSWORD)

    assert authenticate(username="Élodie", password=PASSWORD) == elodie


def test_an_accented_name_signs_in_whatever_case_is_typed():
    elodie = User.objects.create_user("elodie@club.fr", "Élodie", password=PASSWORD)

    assert authenticate(username="ÉLODIE", password=PASSWORD) == elodie
