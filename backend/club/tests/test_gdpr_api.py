"""A member's own data export and account deletion, each confirmed by
e-mail to their contact address — never the login one (docs/modules.md §10).
"""

import pytest
from django.core.files.base import ContentFile

from club.models import (
    Consent,
    Membership,
    RuleQuery,
    Season,
    Team,
    TeamSeason,
    User,
    VerificationRequest,
)


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


PASSWORD = "correct-horse-battery-staple"


def student(email="eleve@club.fr", display_name="Élève", contact_email=""):
    return User.objects.create_user(
        email, display_name, PASSWORD, contact_email=contact_email
    )


def admin(email="admin@club.fr", display_name="Admin", contact_email="admin@club.fr"):
    return User.objects.create_user(
        email,
        display_name,
        PASSWORD,
        is_club_admin=True,
        contact_email=contact_email,
    )


def delete(client, password=PASSWORD):
    return client.delete(
        "/api/auth/me/", {"password": password}, content_type="application/json"
    )


# --- exporting one's own data ---


def test_a_member_receives_their_export_by_e_mail(client, mailoutbox):
    lina = student(contact_email="parent.lina@club.fr")
    client.force_login(lina)

    response = client.post("/api/auth/me/export/")

    assert response.status_code == 202
    (mail,) = mailoutbox
    assert mail.to == ["parent.lina@club.fr"]
    (attachment,) = mail.attachments
    name, content, _mimetype = attachment
    assert name == "export.json"
    assert "Élève" in content


def test_the_export_never_goes_to_the_login_address(client, mailoutbox):
    # The login address may be built and undeliverable (the .invalid domain);
    # the contact address is the one AssoConnect actually confirms.
    lina = student(email="lina@club.fr", contact_email="parent.lina@club.fr")
    client.force_login(lina)

    client.post("/api/auth/me/export/")

    (mail,) = mailoutbox
    assert "lina@club.fr" not in mail.to


def test_the_export_carries_memberships_and_image_rights_decisions(client, mailoutbox):
    lina = student(contact_email="parent.lina@club.fr")
    client.force_login(lina)
    season = Season.objects.create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=12345, name="Rouages")
    team_season = TeamSeason.objects.create(team=team, season=season)
    Membership.objects.create(user=lina, team_season=team_season)
    Consent.objects.create(
        user=lina,
        decision=Consent.Decision.GRANTED,
        granted_by=Consent.GrantedBy.LEGAL_GUARDIAN,
    )

    client.post("/api/auth/me/export/")

    (mail,) = mailoutbox
    (_, content, _) = mail.attachments[0]
    assert "Rouages" in content
    assert "granted" in content


def test_the_export_includes_the_avatar_as_a_second_attachment(client, mailoutbox):
    lina = student(contact_email="parent.lina@club.fr")
    lina.avatar.save("photo.webp", ContentFile(b"fake-webp-bytes"), save=True)
    client.force_login(lina)

    client.post("/api/auth/me/export/")

    (mail,) = mailoutbox
    assert len(mail.attachments) == 2
    name, content, mimetype = mail.attachments[1]
    assert name == "avatar.webp"
    assert content == b"fake-webp-bytes"
    assert mimetype == "image/webp"


def test_the_export_has_no_second_attachment_without_an_avatar(client, mailoutbox):
    lina = student(contact_email="parent.lina@club.fr")
    client.force_login(lina)

    client.post("/api/auth/me/export/")

    (mail,) = mailoutbox
    assert len(mail.attachments) == 1


def test_the_export_carries_assoconnect_id_and_pending_verification(client, mailoutbox):
    lina = student(contact_email="parent.lina@club.fr")
    lina.assoconnect_id = "AC-42"
    lina.save(update_fields=["assoconnect_id"])
    VerificationRequest.objects.create(
        user=lina,
        first_name="Lina",
        last_name="Dupont",
        birth_date="2010-05-01",
    )
    client.force_login(lina)

    client.post("/api/auth/me/export/")

    (mail,) = mailoutbox
    (_, content, _) = mail.attachments[0]
    assert "AC-42" in content
    assert "Dupont" in content
    assert "2010-05-01" in content


def test_the_export_carries_rulebook_questions(client, mailoutbox):
    lina = student(contact_email="parent.lina@club.fr")
    RuleQuery.objects.create(
        asker=lina,
        question="Quelle hauteur maximale en autonome ?",
        answer="",
    )
    client.force_login(lina)

    client.post("/api/auth/me/export/")

    (mail,) = mailoutbox
    (_, content, _) = mail.attachments[0]
    assert "Quelle hauteur maximale en autonome" in content


def test_the_export_leaves_out_the_teams_notebook(client, mailoutbox):
    # Entries stay the team's history, attributed, after a member leaves —
    # the notebook export serves a different reader, the portfolio.
    lina = student(contact_email="parent.lina@club.fr")
    client.force_login(lina)
    season = Season.objects.create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=12345, name="Rouages")
    team_season = TeamSeason.objects.create(team=team, season=season)
    Membership.objects.create(user=lina, team_season=team_season)

    client.post("/api/auth/me/export/")

    (mail,) = mailoutbox
    (_, content, _) = mail.attachments[0]
    assert "entries" not in content
    assert "entry" not in content


def test_without_a_contact_address_the_export_is_refused(client, mailoutbox):
    lina = student(contact_email="")
    client.force_login(lina)

    response = client.post("/api/auth/me/export/")

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "no_contact_email"
    assert mailoutbox == []


def test_an_anonymous_caller_cannot_request_an_export(client):
    assert client.post("/api/auth/me/export/").status_code in (401, 403)


# --- deleting one's own account ---


def test_a_member_deletes_their_own_account(client, mailoutbox):
    lina = student(contact_email="parent.lina@club.fr")
    client.force_login(lina)

    response = delete(client)

    assert response.status_code == 204
    lina.refresh_from_db()
    assert lina.is_active is False
    (mail,) = mailoutbox
    assert mail.to == ["parent.lina@club.fr"]


def test_deletion_anonymizes_the_display_name_and_login_address(client, mailoutbox):
    lina = student(contact_email="parent.lina@club.fr")
    client.force_login(lina)

    delete(client)

    lina.refresh_from_db()
    assert lina.display_name == f"Ancien membre {lina.id}"
    assert lina.email == f"ancien-membre-{lina.id}@rouages.invalid"


def test_deletion_clears_contact_email_birth_date_and_assoconnect_id(
    client, mailoutbox
):
    lina = student(contact_email="parent.lina@club.fr")
    lina.birth_date = "2010-05-01"
    lina.assoconnect_id = "AC-42"
    lina.save(update_fields=["birth_date", "assoconnect_id"])
    client.force_login(lina)

    delete(client)

    lina.refresh_from_db()
    assert lina.contact_email == ""
    assert lina.birth_date is None
    assert lina.assoconnect_id is None


def test_deletion_removes_the_avatar_file(
    client, mailoutbox, tmp_path, django_capture_on_commit_callbacks
):
    lina = student(contact_email="parent.lina@club.fr")
    lina.avatar.save("photo.webp", ContentFile(b"fake-webp-bytes"), save=True)
    stored_at = tmp_path / lina.avatar.name
    assert stored_at.exists()
    client.force_login(lina)

    with django_capture_on_commit_callbacks(execute=True):
        delete(client)

    lina.refresh_from_db()
    assert not lina.avatar
    assert not stored_at.exists()


def test_deletion_deletes_the_pending_verification_request(client, mailoutbox):
    lina = student(contact_email="parent.lina@club.fr")
    VerificationRequest.objects.create(
        user=lina, first_name="Lina", last_name="Dupont", birth_date="2010-05-01"
    )
    client.force_login(lina)

    delete(client)

    assert not VerificationRequest.objects.filter(user=lina).exists()


def test_deletion_leaves_the_password_unusable(client, mailoutbox):
    lina = student(contact_email="parent.lina@club.fr")
    client.force_login(lina)

    delete(client)

    lina.refresh_from_db()
    assert lina.has_usable_password() is False


def test_a_failed_confirmation_e_mail_leaves_the_account_unchanged(
    client, mailoutbox, monkeypatch
):
    from club import gdpr

    def broken_send_mail(*args, **kwargs):
        raise RuntimeError("SMTP is down")

    monkeypatch.setattr(gdpr, "send_mail", broken_send_mail)
    lina = student(contact_email="parent.lina@club.fr")
    original_email = lina.email
    client.force_login(lina)

    with pytest.raises(RuntimeError):
        delete(client)

    lina.refresh_from_db()
    assert lina.is_active is True
    assert lina.email == original_email
    assert lina.has_usable_password() is True
    assert mailoutbox == []


def test_a_deleted_account_still_exists_and_keeps_its_traces(client, mailoutbox):
    lina = student(contact_email="parent.lina@club.fr")
    client.force_login(lina)

    delete(client)

    assert User.objects.filter(id=lina.id).exists()


def test_deleting_ones_account_signs_one_out(client, mailoutbox):
    lina = student(contact_email="parent.lina@club.fr")
    client.force_login(lina)

    delete(client)

    assert client.get("/api/auth/me/").status_code == 403


def test_a_wrong_password_refuses_deletion_and_nothing_changes(client, mailoutbox):
    lina = student(contact_email="parent.lina@club.fr")
    client.force_login(lina)

    response = delete(client, password="not-the-right-one")

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "wrong_password"
    lina.refresh_from_db()
    assert lina.is_active is True
    assert lina.has_usable_password() is True
    assert mailoutbox == []


def test_a_missing_password_refuses_deletion_the_same_way(client, mailoutbox):
    lina = student(contact_email="parent.lina@club.fr")
    client.force_login(lina)

    response = client.delete("/api/auth/me/", {}, content_type="application/json")

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "wrong_password"
    lina.refresh_from_db()
    assert lina.is_active is True
    assert mailoutbox == []


def test_deactivating_an_account_does_not_anonymize_it(client, mailoutbox):
    # A suspension is temporary; anonymize() is not, and must only ever run
    # from `request_deletion` or the Django admin action.
    lina = student(contact_email="parent.lina@club.fr")
    original_display_name = lina.display_name
    original_email = lina.email

    lina.is_active = False
    lina.save(update_fields=["is_active"])

    lina.refresh_from_db()
    assert lina.display_name == original_display_name
    assert lina.email == original_email
    assert lina.contact_email == "parent.lina@club.fr"
    assert lina.has_usable_password() is True


def test_without_a_contact_address_deletion_is_refused_and_nothing_changes(
    client, mailoutbox
):
    lina = student(contact_email="")
    client.force_login(lina)

    response = delete(client)

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "no_contact_email"
    lina.refresh_from_db()
    assert lina.is_active is True
    assert mailoutbox == []


def test_the_only_admin_cannot_delete_their_own_account(client, mailoutbox):
    boss = admin()
    client.force_login(boss)

    response = delete(client)

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "last_admin_cannot_leave"
    boss.refresh_from_db()
    assert boss.is_active is True
    assert mailoutbox == []


def test_an_admin_can_leave_if_another_one_remains(client, mailoutbox):
    boss = admin("boss@club.fr", "Boss", "boss@club.fr")
    admin("other@club.fr", "Other", "other@club.fr")
    client.force_login(boss)

    response = delete(client)

    assert response.status_code == 204
    boss.refresh_from_db()
    assert boss.is_active is False


def test_an_admin_who_leaves_loses_the_admin_flag_too(client, mailoutbox):
    # Found reviewing #88: an anonymized admin kept is_club_admin set —
    # reactivated by mistake (nothing else makes sense once the password is
    # unusable), it would count as another live admin to
    # `not_the_last_admin`, although nobody can sign in to it.
    boss = admin("boss@club.fr", "Boss", "boss@club.fr")
    admin("other@club.fr", "Other", "other@club.fr")
    client.force_login(boss)

    delete(client)

    boss.refresh_from_db()
    assert boss.is_club_admin is False


def test_an_anonymous_caller_cannot_delete_an_account(client):
    assert delete(client).status_code in (401, 403)
