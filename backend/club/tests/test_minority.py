from datetime import date

from club.models import User

TODAY = date(2026, 9, 15)


def test_an_unverified_account_is_a_minor_whatever_it_declared():
    # A student could type any birth date: only AssoConnect's counts.
    user = User(email="ada@club.fr", display_name="Ada", birth_date=date(2000, 1, 1))

    assert user.is_minor_on(TODAY) is True


def test_a_verified_account_becomes_an_adult_on_its_eighteenth_birthday():
    user = User(
        email="ada@club.fr",
        display_name="Ada",
        assoconnect_id="A-1042",
        birth_date=date(2008, 9, 15),
    )

    assert user.is_minor_on(date(2026, 9, 14)) is True
    assert user.is_minor_on(date(2026, 9, 15)) is False


def test_a_verified_account_without_a_birth_date_stays_a_minor():
    user = User(email="ada@club.fr", display_name="Ada", assoconnect_id="A-1042")

    assert user.is_minor_on(TODAY) is True


def test_the_first_superuser_is_a_minor_until_verified():
    # Whoever installs the instance is verified like any other member.
    admin = User.objects.create_superuser("admin@club.fr", "Admin", "rouage-bleu-2026")

    assert admin.is_minor is True
