from club.admin import UserCreationForm


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
