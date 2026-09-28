"""The Django admin's own trigger for anonymize() — a member who has left,
anonymized by whoever runs the club rather than by the member themselves.
"""

from club.models import User

CHANGELIST = "/admin/club/user/"


def staff(email="staff@club.fr", display_name="Staff"):
    return User.objects.create_superuser(email, display_name, "staff-password")


def student(email="eleve@club.fr", display_name="Élève", contact_email=""):
    return User.objects.create_user(email, display_name, contact_email=contact_email)


def test_the_action_asks_for_confirmation_before_anonymizing(client):
    client.force_login(staff())
    lina = student(contact_email="parent.lina@club.fr")

    response = client.post(
        CHANGELIST, {"action": "anonymize_selected", "_selected_action": [lina.pk]}
    )

    assert response.status_code == 200
    lina.refresh_from_db()
    assert lina.display_name == "Élève"


def test_confirming_the_action_anonymizes_the_selected_members(client):
    client.force_login(staff())
    lina = student(contact_email="parent.lina@club.fr")

    client.post(
        CHANGELIST,
        {
            "action": "anonymize_selected",
            "_selected_action": [lina.pk],
            "post": "yes",
        },
    )

    lina.refresh_from_db()
    assert lina.display_name == f"Ancien membre {lina.id}"
    assert lina.has_usable_password() is False


def test_the_action_needs_no_password(client):
    # Unlike the member's own DELETE, a staff sign-in already confirms who
    # is acting.
    client.force_login(staff())
    lina = student(contact_email="parent.lina@club.fr")

    response = client.post(
        CHANGELIST,
        {
            "action": "anonymize_selected",
            "_selected_action": [lina.pk],
            "post": "yes",
        },
    )

    assert response.status_code == 302
    lina.refresh_from_db()
    assert lina.display_name == f"Ancien membre {lina.id}"


def test_a_member_with_no_contact_address_is_reported_and_skipped(client):
    client.force_login(staff())
    lina = student(contact_email="")

    client.post(
        CHANGELIST,
        {
            "action": "anonymize_selected",
            "_selected_action": [lina.pk],
            "post": "yes",
        },
    )

    lina.refresh_from_db()
    assert lina.display_name == "Élève"


def test_a_non_staff_caller_cannot_reach_the_admin(client):
    lina = student(contact_email="parent.lina@club.fr")
    client.force_login(lina)

    response = client.post(
        CHANGELIST,
        {
            "action": "anonymize_selected",
            "_selected_action": [lina.pk],
            "post": "yes",
        },
    )

    assert response.status_code in (302, 403)
    lina.refresh_from_db()
    assert lina.display_name == "Élève"
