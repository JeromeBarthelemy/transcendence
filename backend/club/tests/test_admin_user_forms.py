from django.forms.models import model_to_dict

from club.admin import UserCreationForm, UserEditForm
from club.models import User


def test_the_django_admin_cannot_create_an_account_under_a_reserved_name():
    form = UserCreationForm(
        data={
            "email": "lina@club.fr",
            "display_name": "Ancien membre 13",
            "usable_password": "false",
        }
    )

    assert not form.is_valid()
    assert form.errors.as_data()["display_name"][0].code == "display_name_reserved"


def edit_form(user, **changes):
    data = {**model_to_dict(user), **changes}
    return UserEditForm(data=data, instance=user)


def test_the_django_admin_cannot_create_an_account_under_a_name_taken_regardless_of_case():
    User.objects.create_user("elodie@club.fr", "Élodie")

    form = UserCreationForm(
        data={
            "email": "elodie2@club.fr",
            "display_name": "élodie",
            "usable_password": "false",
        }
    )

    assert not form.is_valid()
    assert form.errors.as_data()["display_name"][0].code == "display_name_taken"


def test_the_django_admin_cannot_rename_an_account_to_a_name_taken_regardless_of_case():
    User.objects.create_user("elodie@club.fr", "Élodie")
    lina = User.objects.create_user("lina@club.fr", "Lina")

    form = edit_form(lina, display_name="élodie")

    assert not form.is_valid()
    assert form.errors.as_data()["display_name"][0].code == "display_name_taken"


def test_the_django_admin_saves_an_account_that_keeps_its_own_name():
    lina = User.objects.create_user("lina@club.fr", "Lina")

    form = edit_form(lina, contact_email="parents@club.fr")

    assert form.is_valid(), form.errors
