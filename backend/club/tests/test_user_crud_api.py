"""Admin CRUD on User (#52): list, view, edit the role/admin flag,
deactivate — the surface docs/modules.md §4 asks for on top of the model
it already settles.
"""

from club.models import User


def admin(email="admin@club.fr", display_name="Admin"):
    # An administrator is a mentor who also administrates (club/models.py,
    # `User`) — the fixture keeps that true, now that `UserRoleSerializer`
    # enforces it too.
    return User.objects.create_user(
        email, display_name, club_role=User.ClubRole.MENTOR, is_club_admin=True
    )


def student(email="eleve@club.fr", display_name="Élève"):
    return User.objects.create_user(email, display_name)


def mentor(email="mentor@club.fr", display_name="Mentor"):
    return User.objects.create_user(email, display_name, club_role=User.ClubRole.MENTOR)


def superuser(email="root@club.fr", display_name="Root"):
    return User.objects.create_superuser(email, display_name)


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


# --- staff accounts ---


def test_a_non_staff_admin_cannot_deactivate_a_staff_account(client):
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


# --- deactivating ---


def test_a_club_admin_deactivates_a_member(client):
    client.force_login(admin())
    lina = student("lina@club.fr", "Lina")

    response = client.delete(f"/api/users/{lina.id}/")

    assert response.status_code == 204
    lina.refresh_from_db()
    assert lina.is_active is False


def test_a_deactivated_member_still_exists_and_keeps_their_traces(client):
    # The point of deactivating rather than deleting: the row, and whatever
    # cites it, survives.
    client.force_login(admin())
    lina = student("lina@club.fr", "Lina")

    client.delete(f"/api/users/{lina.id}/")

    assert User.objects.filter(id=lina.id).exists()


def test_a_club_admin_cannot_deactivate_their_own_account(client):
    boss = admin()
    client.force_login(boss)

    response = client.delete(f"/api/users/{boss.id}/")

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "cannot_target_self"
    boss.refresh_from_db()
    assert boss.is_active is True


def test_a_student_cannot_deactivate_a_member(client):
    client.force_login(student())
    lina = student("lina@club.fr", "Lina")

    response = client.delete(f"/api/users/{lina.id}/")

    assert response.status_code == 403
    lina.refresh_from_db()
    assert lina.is_active is True
