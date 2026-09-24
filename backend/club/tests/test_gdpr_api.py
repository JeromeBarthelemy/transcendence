"""A member's own data export and account deletion, each confirmed by
e-mail to their contact address — never the login one (docs/modules.md §10).
"""

from club.models import Consent, Membership, Season, Team, TeamSeason, User


def student(email="eleve@club.fr", display_name="Élève", contact_email=""):
    return User.objects.create_user(email, display_name, contact_email=contact_email)


def admin(email="admin@club.fr", display_name="Admin", contact_email="admin@club.fr"):
    return User.objects.create_user(
        email, display_name, is_club_admin=True, contact_email=contact_email
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

    response = client.delete("/api/auth/me/")

    assert response.status_code == 204
    lina.refresh_from_db()
    assert lina.is_active is False
    (mail,) = mailoutbox
    assert mail.to == ["parent.lina@club.fr"]


def test_a_deleted_account_still_exists_and_keeps_its_traces(client, mailoutbox):
    lina = student(contact_email="parent.lina@club.fr")
    client.force_login(lina)

    client.delete("/api/auth/me/")

    assert User.objects.filter(id=lina.id).exists()


def test_deleting_ones_account_signs_one_out(client, mailoutbox):
    lina = student(contact_email="parent.lina@club.fr")
    client.force_login(lina)

    client.delete("/api/auth/me/")

    assert client.get("/api/auth/me/").status_code == 403


def test_without_a_contact_address_deletion_is_refused_and_nothing_changes(
    client, mailoutbox
):
    lina = student(contact_email="")
    client.force_login(lina)

    response = client.delete("/api/auth/me/")

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "no_contact_email"
    lina.refresh_from_db()
    assert lina.is_active is True
    assert mailoutbox == []


def test_the_only_admin_cannot_delete_their_own_account(client, mailoutbox):
    boss = admin()
    client.force_login(boss)

    response = client.delete("/api/auth/me/")

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "last_admin_cannot_leave"
    boss.refresh_from_db()
    assert boss.is_active is True
    assert mailoutbox == []


def test_an_admin_can_leave_if_another_one_remains(client, mailoutbox):
    boss = admin("boss@club.fr", "Boss", "boss@club.fr")
    admin("other@club.fr", "Other", "other@club.fr")
    client.force_login(boss)

    response = client.delete("/api/auth/me/")

    assert response.status_code == 204
    boss.refresh_from_db()
    assert boss.is_active is False


def test_an_anonymous_caller_cannot_delete_an_account(client):
    assert client.delete("/api/auth/me/").status_code in (401, 403)
