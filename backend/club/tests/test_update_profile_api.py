"""One's own display name and login address (#178)."""

from club.models import User

PASSWORD = "rouage-bleu-2026"
ME = "/api/auth/me/"


def person(email="lina@club.fr", display_name="Lina", **extra):
    return User.objects.create_user(email, display_name, password=PASSWORD, **extra)


def update(client, **data):
    return client.patch(ME, data, content_type="application/json")


def test_a_member_changes_their_display_name(client):
    client.force_login(person())

    response = update(client, display_name="Lina D.")

    assert response.status_code == 200
    assert response.json()["display_name"] == "Lina D."


def test_the_new_name_signs_one_in(client):
    lina = person()
    client.force_login(lina)
    update(client, display_name="Lina D.")
    client.logout()

    response = client.post(
        "/api/auth/login/",
        {"username": "Lina D.", "password": PASSWORD},
        content_type="application/json",
    )

    assert response.status_code == 200


def test_a_display_name_already_taken_is_refused(client):
    person("ada@club.fr", "Ada")
    client.force_login(person())

    response = update(client, display_name="ada")

    assert response.status_code == 400
    assert response.json()["display_name"][0]["code"] == "display_name_taken"


def test_a_display_name_with_an_at_sign_is_refused(client):
    client.force_login(person())

    response = update(client, display_name="lina@club")

    assert response.status_code == 400
    assert response.json()["display_name"][0]["code"] == "display_name_has_at_sign"


def test_changing_the_login_address_asks_for_the_current_password(client):
    lina = person()
    client.force_login(lina)

    response = update(client, email="lina-nouvelle@club.fr", current_password=PASSWORD)

    assert response.status_code == 200
    lina.refresh_from_db()
    assert lina.email == "lina-nouvelle@club.fr"


def test_a_wrong_password_refuses_the_new_address_and_changes_nothing(client):
    lina = person()
    client.force_login(lina)

    response = update(
        client, email="lina-nouvelle@club.fr", current_password="pas-le-bon"
    )

    assert response.status_code == 400
    assert response.json()["non_field_errors"][0]["code"] == "current_password_wrong"
    lina.refresh_from_db()
    assert lina.email == "lina@club.fr"


def test_a_missing_password_is_refused_the_same_way(client):
    client.force_login(person())

    response = update(client, email="lina-nouvelle@club.fr")

    assert response.status_code == 400
    assert response.json()["non_field_errors"][0]["code"] == "current_password_wrong"


def test_an_email_already_used_is_refused(client):
    person("ada@club.fr", "Ada")
    client.force_login(person())

    response = update(client, email="ada@club.fr", current_password=PASSWORD)

    assert response.status_code == 400
    assert response.json()["email"][0]["code"] == "email_taken"


def test_an_address_anonymization_would_give_is_refused(client):
    # anonymize() (club/gdpr.py) would give some other account this exact
    # address; taking it first here would make that account's own erasure
    # fail on IntegrityError later.
    client.force_login(person())

    response = update(
        client,
        email="ancien-membre-13@rouages.invalid",
        current_password=PASSWORD,
    )

    assert response.status_code == 400
    assert response.json()["email"][0]["code"] == "email_reserved"


def test_changing_only_the_display_name_needs_no_password(client):
    client.force_login(person())

    response = update(client, display_name="Lina D.")

    assert response.status_code == 200


def test_a_minor_can_change_their_own_display_name_and_address(client):
    # #178's own point: unlike contact_email, this is theirs to change.
    client.force_login(person(birth_date="2010-01-01"))

    response = update(
        client, display_name="Lina D.", email="lina2@club.fr", current_password=PASSWORD
    )

    assert response.status_code == 200


def test_an_anonymous_caller_cannot_update_a_profile(client):
    assert update(client, display_name="Quelqu'un").status_code == 403


def test_a_contact_address_cannot_be_changed_from_here(client):
    # contact_email stays the admin's own (UserRoleSerializer) — not even
    # reachable through this serializer's fields.
    lina = person(contact_email="parent@club.fr")
    client.force_login(lina)

    update(client, contact_email="attacker@evil.example")

    lina.refresh_from_db()
    assert lina.contact_email == "parent@club.fr"
