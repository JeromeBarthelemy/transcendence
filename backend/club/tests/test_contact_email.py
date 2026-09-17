from django.contrib import admin as django_admin

from club.models import User


def test_an_account_starts_with_no_contact_address():
    # Sign-up does not ask for one: AssoConnect states it.
    ada = User.objects.create_user("ada@club.fr", "Ada")

    assert ada.contact_email == ""


def test_a_contact_address_is_not_an_identifier():
    # Two siblings share their guardian's mailbox. Nothing may refuse that,
    # which is exactly why this column is not the credential.
    User.objects.create_user("lina@club.fr", "Lina", contact_email="parent@club.fr")
    User.objects.create_user("noe@club.fr", "Noé", contact_email="parent@club.fr")

    assert User.objects.filter(contact_email="parent@club.fr").count() == 2


def test_the_admin_shows_every_field_of_an_account():
    # fieldsets are listed by hand, so a new column is invisible until it is
    # added — which is how contact_email would have gone unnoticed.
    registered = django_admin.site._registry[User]
    # `or ()` for the type-checker only: ModelAdmin declares fieldsets as
    # optional, and this one is not.
    shown = {
        field
        for _, section in (registered.fieldsets or ())
        for field in section["fields"]
    }

    assert shown >= {"email", "contact_email", "display_name", "club_role"}
