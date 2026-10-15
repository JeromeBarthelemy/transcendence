"""Admin CRUD on User (#52): list, view, edit the role/admin flag,
deactivate — the surface docs/modules.md §4 asks for on top of the model
it already settles.
"""

from urllib.parse import urlencode

from club.gdpr import anonymize
from club.models import User


def admin(email="admin@club.fr", display_name="Admin", **extra):
    # An administrator is a mentor who also administrates (club/models.py,
    # `User`) — the fixture keeps that true, now that `UserRoleSerializer`
    # enforces it too.
    return User.objects.create_user(
        email,
        display_name,
        club_role=User.ClubRole.MENTOR,
        is_club_admin=True,
        **extra,
    )


def student(email="eleve@club.fr", display_name="Élève", **extra):
    return User.objects.create_user(email, display_name, **extra)


def mentor(email="mentor@club.fr", display_name="Mentor"):
    return User.objects.create_user(email, display_name, club_role=User.ClubRole.MENTOR)


def superuser(email="root@club.fr", display_name="Root"):
    return User.objects.create_superuser(email, display_name)


def staff_admin(email="staff@club.fr", display_name="Staff"):
    # is_staff without is_superuser: Django admin access, nothing more —
    # create_superuser always sets both, so this needs its own fixture.
    return User.objects.create_user(
        email,
        display_name,
        club_role=User.ClubRole.MENTOR,
        is_club_admin=True,
        is_staff=True,
    )


# --- listing ---


def test_a_club_admin_lists_every_member(client):
    client.force_login(admin())
    student("lina@club.fr", "Lina")

    response = client.get("/api/users/")

    assert response.status_code == 200
    names = [member["display_name"] for member in response.json()]
    assert "Lina" in names


def test_a_deactivated_member_is_still_listed(client):
    client.force_login(admin())
    gone = student("parti@club.fr", "Parti")
    gone.is_active = False
    gone.save(update_fields=["is_active"])

    response = client.get("/api/users/")

    listed = {member["id"]: member for member in response.json()}
    assert listed[gone.id]["is_active"] is False


def test_a_student_cannot_list_members(client):
    client.force_login(student())

    assert client.get("/api/users/").status_code == 403


def test_an_anonymous_caller_cannot_list_members(client):
    assert client.get("/api/users/").status_code in (401, 403)


# --- viewing one ---


def test_a_club_admin_views_one_member(client):
    client.force_login(admin())
    lina = student("lina@club.fr", "Lina")

    response = client.get(f"/api/users/{lina.id}/")

    assert response.status_code == 200
    assert response.json()["display_name"] == "Lina"
    assert response.json()["club_role"] == "student"


def test_an_unknown_member_is_not_found(client):
    client.force_login(admin())

    assert client.get("/api/users/999/").status_code == 404


# --- editing the role ---


def test_a_club_admin_makes_a_student_a_mentor(client):
    client.force_login(admin())
    lina = student("lina@club.fr", "Lina")

    response = client.patch(
        f"/api/users/{lina.id}/",
        {"club_role": "mentor"},
        content_type="application/json",
    )

    assert response.status_code == 200
    lina.refresh_from_db()
    assert lina.club_role == User.ClubRole.MENTOR


def test_a_club_admin_grants_admin_rights(client):
    client.force_login(admin())
    tom = mentor("tom@club.fr", "Tom")

    client.patch(
        f"/api/users/{tom.id}/",
        {"is_club_admin": True},
        content_type="application/json",
    )

    tom.refresh_from_db()
    assert tom.is_club_admin is True


def test_a_club_admin_revokes_another_admins_rights(client):
    client.force_login(admin())
    other = admin("other@club.fr", "Autre admin")

    client.patch(
        f"/api/users/{other.id}/",
        {"is_club_admin": False},
        content_type="application/json",
    )

    other.refresh_from_db()
    assert other.is_club_admin is False


def test_an_invalid_role_is_refused(client):
    client.force_login(admin())
    lina = student("lina@club.fr", "Lina")

    response = client.patch(
        f"/api/users/{lina.id}/",
        {"club_role": "wizard"},
        content_type="application/json",
    )

    assert response.status_code == 400
    lina.refresh_from_db()
    assert lina.club_role == User.ClubRole.STUDENT


def test_a_club_admin_cannot_edit_their_own_role(client):
    boss = admin()
    client.force_login(boss)

    response = client.patch(
        f"/api/users/{boss.id}/",
        {"is_club_admin": False},
        content_type="application/json",
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "cannot_target_self"
    boss.refresh_from_db()
    assert boss.is_club_admin is True


def test_a_student_cannot_edit_a_member(client):
    client.force_login(student())
    lina = student("lina@club.fr", "Lina")

    response = client.patch(
        f"/api/users/{lina.id}/",
        {"club_role": "mentor"},
        content_type="application/json",
    )

    assert response.status_code == 403
    lina.refresh_from_db()
    assert lina.club_role == User.ClubRole.STUDENT


def test_a_student_cannot_be_made_admin_without_being_made_a_mentor(client):
    # The model says an administrator is a mentor who also administrates
    # (club/models.py, `User`) — a student with the flag set would pass
    # every admin check while getting 403 not_a_member on their own team.
    client.force_login(admin())
    lina = student("lina@club.fr", "Lina")

    response = client.patch(
        f"/api/users/{lina.id}/",
        {"is_club_admin": True},
        content_type="application/json",
    )

    assert response.status_code == 400
    assert response.json()["non_field_errors"][0]["code"] == "admin_must_be_mentor"
    lina.refresh_from_db()
    assert lina.is_club_admin is False


def test_demoting_an_admin_without_clearing_the_flag_is_refused(client):
    client.force_login(admin())
    other = admin("other@club.fr", "Autre admin")

    response = client.patch(
        f"/api/users/{other.id}/",
        {"club_role": "student"},
        content_type="application/json",
    )

    assert response.status_code == 400
    assert response.json()["non_field_errors"][0]["code"] == "admin_must_be_mentor"
    other.refresh_from_db()
    assert other.club_role == User.ClubRole.MENTOR
    assert other.is_club_admin is True


def test_demoting_an_admin_and_clearing_the_flag_together_is_accepted(client):
    client.force_login(admin())
    other = admin("other@club.fr", "Autre admin")

    response = client.patch(
        f"/api/users/{other.id}/",
        {"club_role": "student", "is_club_admin": False},
        content_type="application/json",
    )

    assert response.status_code == 200
    other.refresh_from_db()
    assert other.club_role == User.ClubRole.STUDENT
    assert other.is_club_admin is False


# --- reactivating ---


def test_a_club_admin_reactivates_a_suspended_member(client):
    client.force_login(admin())
    lina = student("lina@club.fr", "Lina")
    lina.is_active = False
    lina.save(update_fields=["is_active"])

    response = client.patch(
        f"/api/users/{lina.id}/",
        {"is_active": True},
        content_type="application/json",
    )

    assert response.status_code == 200
    lina.refresh_from_db()
    assert lina.is_active is True


def test_a_form_encoded_patch_does_not_reset_the_fields_it_does_not_touch(client):
    # Without partial=True, DRF reads an absent boolean as False once the
    # body is form-encoded rather than JSON — found reviewing #88:
    # PATCH club_role=mentor this way left an admin demoted and suspended,
    # although neither field was in the body.
    client.force_login(admin())
    boss = admin("boss@club.fr", "Boss")

    response = client.patch(
        f"/api/users/{boss.id}/",
        urlencode({"club_role": "mentor"}),
        content_type="application/x-www-form-urlencoded",
    )

    assert response.status_code == 200
    boss.refresh_from_db()
    assert boss.is_club_admin is True
    assert boss.is_active is True


# --- editing the name and contact address (#178) ---


def test_a_club_admin_corrects_a_members_display_name(client):
    client.force_login(admin())
    lina = student("lina@club.fr", "Lina")

    response = client.patch(
        f"/api/users/{lina.id}/",
        {"display_name": "Lina D."},
        content_type="application/json",
    )

    assert response.status_code == 200
    lina.refresh_from_db()
    assert lina.display_name == "Lina D."


def test_a_club_admin_corrects_a_guardians_contact_address(client):
    client.force_login(admin())
    lina = student("lina@club.fr", "Lina")

    response = client.patch(
        f"/api/users/{lina.id}/",
        {"contact_email": "parent@club.fr"},
        content_type="application/json",
    )

    assert response.status_code == 200
    lina.refresh_from_db()
    assert lina.contact_email == "parent@club.fr"


def test_a_contact_address_may_be_cleared(client):
    client.force_login(admin())
    lina = student("lina@club.fr", "Lina", contact_email="parent@club.fr")

    client.patch(
        f"/api/users/{lina.id}/",
        {"contact_email": ""},
        content_type="application/json",
    )

    lina.refresh_from_db()
    assert lina.contact_email == ""


def test_a_display_name_already_taken_is_refused(client):
    client.force_login(admin())
    student("ada@club.fr", "Ada")
    lina = student("lina@club.fr", "Lina")

    response = client.patch(
        f"/api/users/{lina.id}/",
        {"display_name": "ada"},
        content_type="application/json",
    )

    assert response.status_code == 400
    assert response.json()["display_name"][0]["code"] == "display_name_taken"
    lina.refresh_from_db()
    assert lina.display_name == "Lina"


def test_a_club_admin_cannot_correct_their_own_name_from_this_screen(client):
    boss = admin()
    client.force_login(boss)

    response = client.patch(
        f"/api/users/{boss.id}/",
        {"display_name": "Nouveau nom"},
        content_type="application/json",
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "cannot_target_self"


# --- staff accounts ---


def test_a_non_staff_admin_cannot_delete_a_staff_account(client):
    client.force_login(admin())
    root = superuser()

    response = client.delete(f"/api/users/{root.id}/")

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "cannot_target_staff"
    root.refresh_from_db()
    assert root.is_active is True


def test_a_non_staff_admin_cannot_demote_a_staff_account(client):
    client.force_login(admin())
    root = superuser()

    response = client.patch(
        f"/api/users/{root.id}/",
        {"is_club_admin": False},
        content_type="application/json",
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "cannot_target_staff"
    root.refresh_from_db()
    assert root.is_club_admin is True


def test_a_staff_admin_can_edit_another_staff_account(client):
    client.force_login(superuser("caller@club.fr", "Caller"))
    root = superuser("root@club.fr", "Root")

    response = client.patch(
        f"/api/users/{root.id}/",
        {"is_club_admin": False},
        content_type="application/json",
    )

    assert response.status_code == 200
    root.refresh_from_db()
    assert root.is_club_admin is False


# --- superuser accounts ---


def test_a_staff_non_superuser_admin_cannot_delete_a_superuser(client):
    # is_staff clears cannot_target_staff on its own — found by @Nitwee
    # reviewing #88: a club admin with Django admin access but no superuser
    # status could still delete or demote a superuser account.
    client.force_login(staff_admin())
    root = superuser()

    response = client.delete(f"/api/users/{root.id}/")

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "cannot_target_superuser"
    root.refresh_from_db()
    assert root.is_active is True


def test_a_staff_non_superuser_admin_cannot_demote_a_superuser(client):
    client.force_login(staff_admin())
    root = superuser()

    response = client.patch(
        f"/api/users/{root.id}/",
        {"is_club_admin": False},
        content_type="application/json",
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "cannot_target_superuser"
    root.refresh_from_db()
    assert root.is_club_admin is True


def test_a_superuser_can_edit_another_superuser(client):
    client.force_login(superuser("caller@club.fr", "Caller"))
    root = superuser("root@club.fr", "Root")

    response = client.patch(
        f"/api/users/{root.id}/",
        {"is_club_admin": False},
        content_type="application/json",
    )

    assert response.status_code == 200
    root.refresh_from_db()
    assert root.is_club_admin is False


# --- deleting (anonymizing) ---


def test_a_club_admin_deletes_a_member_by_anonymizing_them(
    client, mailoutbox, django_capture_on_commit_callbacks
):
    # DELETE here is the same anonymize() a member's own request and the
    # Django admin's action call — not a suspension (#88): the row stays,
    # but the identity is gone and it can no longer sign in.
    client.force_login(admin())
    lina = student("lina@club.fr", "Lina", contact_email="parent.lina@club.fr")

    with django_capture_on_commit_callbacks(execute=True):
        response = client.delete(f"/api/users/{lina.id}/")

    assert response.status_code == 204
    lina.refresh_from_db()
    assert lina.is_active is False
    assert lina.display_name != "Lina"
    assert lina.email != "lina@club.fr"
    assert lina.has_usable_password() is False
    assert len(mailoutbox) == 1


def test_deleting_an_admin_clears_their_admin_flag_too(client):
    # Found reviewing #88: an anonymized admin reactivated by mistake would
    # otherwise still count as a live admin, although nobody can sign in.
    client.force_login(admin("boss@club.fr", "Boss"))
    other = admin("other@club.fr", "Other", contact_email="other@club.fr")

    response = client.delete(f"/api/users/{other.id}/")

    assert response.status_code == 204
    other.refresh_from_db()
    assert other.is_club_admin is False


def test_an_anonymized_member_still_exists_and_keeps_their_traces(client):
    # The point of anonymizing rather than deleting the row: it, and
    # whatever cites it, survives.
    client.force_login(admin())
    lina = student("lina@club.fr", "Lina", contact_email="parent.lina@club.fr")

    client.delete(f"/api/users/{lina.id}/")

    assert User.objects.filter(id=lina.id).exists()


def test_deleting_a_member_without_a_contact_address_is_refused(client):
    # anonymize()'s own confirmation e-mail needs somewhere to go — the
    # same guard a member's own deletion request already gets.
    client.force_login(admin())
    lina = student("lina@club.fr", "Lina", contact_email="")

    response = client.delete(f"/api/users/{lina.id}/")

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "no_contact_email"
    lina.refresh_from_db()
    assert lina.is_active is True


def test_a_club_admin_cannot_delete_their_own_account(client):
    boss = admin()
    client.force_login(boss)

    response = client.delete(f"/api/users/{boss.id}/")

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "cannot_target_self"
    boss.refresh_from_db()
    assert boss.is_active is True


def test_a_student_cannot_delete_a_member(client):
    client.force_login(student())
    lina = student("lina@club.fr", "Lina")

    response = client.delete(f"/api/users/{lina.id}/")

    assert response.status_code == 403
    lina.refresh_from_db()
    assert lina.is_active is True


# --- an anonymized account ---


def anonymized(email="parti@club.fr", display_name="Parti"):
    gone = student(email, display_name)
    anonymize(gone)
    return gone


def test_the_list_tells_an_anonymized_account_from_a_suspended_one(client):
    client.force_login(admin())
    gone = anonymized()
    suspended = student("s@club.fr", "Suspendu", is_active=False)

    listed = {user["id"]: user for user in client.get("/api/users/").json()}

    assert listed[gone.id]["is_anonymized"] is True
    assert listed[suspended.id]["is_anonymized"] is False


def test_an_anonymized_account_cannot_be_made_an_active_admin_again(client):
    client.force_login(admin())
    gone = anonymized()

    response = client.patch(
        f"/api/users/{gone.id}/",
        {"club_role": "mentor", "is_club_admin": True, "is_active": True},
        content_type="application/json",
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "account_anonymized"
    gone.refresh_from_db()
    assert not gone.is_active and not gone.is_club_admin


def test_an_anonymized_account_cannot_be_deleted_twice(client):
    client.force_login(admin())
    gone = anonymized()

    response = client.delete(f"/api/users/{gone.id}/")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "account_anonymized"
