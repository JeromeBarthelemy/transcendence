"""Language belongs to the request, not the account or Django's locale."""

import json

import pytest
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import translation

from club.gdpr import request_deletion
from club.models import User

PASSWORD = "correct-horse-battery-staple"
NAME = "Lina & Tom <robot> {draft}"

MAILS = [
    (
        "fr",
        "Export de vos données — Fieldnotes",
        (
            f"Bonjour,\n\nVoici l'export des données du compte « {NAME} », "
            "en pièce jointe, au format lisible (JSON).\n"
        ),
        "Suppression de compte confirmée — Fieldnotes",
        (
            f"Bonjour,\n\nLe compte « {NAME} » a été supprimé à sa demande : "
            "son identité a été effacée. Ce qu'il a écrit reste dans le "
            "classeur de l'équipe.\n"
        ),
    ),
    (
        "en",
        "Your data export — Fieldnotes",
        (
            f'Hello,\n\nThe data export for the account "{NAME}" is attached '
            "in a readable format (JSON).\n"
        ),
        "Account deletion confirmed — Fieldnotes",
        (
            f'Hello,\n\nThe account "{NAME}" has been deleted as requested: '
            "its identifying information has been erased. What the member "
            "wrote remains in the team's notebook.\n"
        ),
    ),
    (
        "es",
        "Exportación de tus datos — Fieldnotes",
        (
            f"Hola:\n\nSe adjunta la exportación de los datos de la cuenta «{NAME}» "
            "en un formato legible (JSON).\n"
        ),
        "Eliminación de la cuenta confirmada — Fieldnotes",
        (
            f"Hola:\n\nLa cuenta «{NAME}» se ha eliminado según lo solicitado: "
            "se han borrado sus datos identificativos. Lo que escribió "
            "el miembro permanece en el cuaderno del equipo.\n"
        ),
    ),
]


@pytest.fixture
def member(client):
    user = User.objects.create_user(
        "lina@example.org", NAME, PASSWORD, contact_email="guardian@example.org"
    )
    client.force_login(user)
    return user


@pytest.mark.parametrize(
    "language,export_subject,export_body,deletion_subject,deletion_body", MAILS
)
def test_export_subject_and_body_follow_the_requested_language(
    client,
    member,
    mailoutbox,
    settings,
    tmp_path,
    language,
    export_subject,
    export_body,
    deletion_subject,
    deletion_body,
):
    settings.MEDIA_ROOT = tmp_path
    member.avatar.save("photo.webp", ContentFile(b"original-avatar"), save=True)
    response = client.post(
        "/api/auth/me/export/", {"language": language}, content_type="application/json"
    )

    assert response.status_code == 202
    assert response.json() == {"sent_to": "guardian@example.org"}
    (mail,) = mailoutbox
    assert mail.subject == export_subject
    assert mail.body == export_body
    assert mail.to == ["guardian@example.org"]
    exported, avatar = mail.attachments
    name, content, mimetype = exported
    assert (name, mimetype) == ("export.json", "application/json")
    assert json.loads(content)["display_name"] == NAME
    assert avatar == ("avatar.webp", b"original-avatar", "image/webp")


@pytest.mark.parametrize(
    "language,export_subject,export_body,deletion_subject,deletion_body", MAILS
)
def test_deletion_captures_the_language_and_identity_before_the_commit_callback(
    client,
    member,
    mailoutbox,
    django_capture_on_commit_callbacks,
    language,
    export_subject,
    export_body,
    deletion_subject,
    deletion_body,
):
    with django_capture_on_commit_callbacks(execute=False) as callbacks:
        response = client.delete(
            "/api/auth/me/",
            {"password": PASSWORD, "language": language},
            content_type="application/json",
        )
        assert not mailoutbox

    assert response.status_code == 200
    assert response.json() == {"sent_to": "guardian@example.org"}
    member.refresh_from_db()
    assert not member.is_active
    assert member.display_name != NAME
    assert len(callbacks) == 1
    # The request's locale is no longer ambient when after-commit work runs.
    with translation.override("de"):
        callbacks[0]()

    (mail,) = mailoutbox
    assert mail.subject == deletion_subject
    assert mail.body == deletion_body
    assert mail.to == ["guardian@example.org"]
    assert not mail.attachments
    assert client.get("/api/auth/me/").json() is None


@pytest.mark.parametrize("operation", ["export", "delete"])
@pytest.mark.parametrize("language", ["de", "en-GB", "", None, ["en"], {}, 0])
def test_an_invalid_language_is_refused_before_sending_or_anonymizing(
    client,
    member,
    mailoutbox,
    operation,
    language,
):
    if operation == "export":
        response = client.post(
            "/api/auth/me/export/",
            {"language": language},
            content_type="application/json",
        )
    else:
        response = client.delete(
            "/api/auth/me/",
            {"language": language, "password": PASSWORD},
            content_type="application/json",
        )

    assert response.status_code == 400
    assert "language" in response.json()
    assert not mailoutbox
    member.refresh_from_db()
    assert member.is_active
    assert member.display_name == NAME
    assert member.contact_email == "guardian@example.org"
    assert client.get("/api/auth/me/").json()["display_name"] == NAME


@pytest.mark.parametrize("operation", ["export", "delete"])
def test_older_callers_without_a_language_keep_french(
    client,
    member,
    mailoutbox,
    django_capture_on_commit_callbacks,
    operation,
):
    with translation.override("es"), django_capture_on_commit_callbacks(execute=True):
        if operation == "export":
            response = client.post("/api/auth/me/export/")
        else:
            response = client.delete(
                "/api/auth/me/", {"password": PASSWORD}, content_type="application/json"
            )

    assert response.status_code in (200, 202)
    (mail,) = mailoutbox
    assert mail.subject == MAILS[0][1 if operation == "export" else 3]
    assert mail.body == MAILS[0][2 if operation == "export" else 4]


def test_administrative_deletion_keeps_the_clubs_french_default(
    client,
    member,
    mailoutbox,
    django_capture_on_commit_callbacks,
):
    admin = User.objects.create_user(
        "paul@example.org",
        "Paul",
        PASSWORD,
        club_role=User.ClubRole.MENTOR,
        is_club_admin=True,
    )
    client.force_login(admin)

    with translation.override("es"), django_capture_on_commit_callbacks(execute=True):
        response = client.delete(f"/api/users/{member.pk}/")

    assert response.status_code == 204
    (mail,) = mailoutbox
    assert mail.subject == MAILS[0][3]
    assert mail.body == MAILS[0][4]
    assert mail.to == ["guardian@example.org"]


@pytest.mark.parametrize("language", ["fr", "en", "es"])
def test_a_language_does_not_bypass_password_confirmation(
    client,
    member,
    mailoutbox,
    language,
):
    response = client.delete(
        "/api/auth/me/",
        {"password": "wrong-password", "language": language},
        content_type="application/json",
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "wrong_password"
    assert not mailoutbox
    member.refresh_from_db()
    assert member.is_active
    assert member.display_name == NAME
    assert client.get("/api/auth/me/").json()["display_name"] == NAME


@pytest.mark.parametrize("language", ["fr", "en", "es"])
def test_a_rolled_back_deletion_sends_no_confirmation(
    member,
    mailoutbox,
    django_capture_on_commit_callbacks,
    language,
):
    with (
        django_capture_on_commit_callbacks(execute=True),
        pytest.raises(RuntimeError, match="rollback"),
        transaction.atomic(),
    ):
        request_deletion(member, password=PASSWORD, language=language)
        assert not mailoutbox
        raise RuntimeError("rollback")

    assert not mailoutbox
    member.refresh_from_db()
    assert member.is_active
    assert member.display_name == NAME
    assert member.contact_email == "guardian@example.org"
