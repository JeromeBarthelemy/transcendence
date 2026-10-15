"""What an administrator does to a member is told to that member alone
(module 13, #242): added to a team, removed from it, given a new role."""

import pytest

from club.models import Membership, Notification, Season, Team, TeamSeason, User
from club.notifications import notify_member


def team_season(number=12345):
    season, _ = Season.objects.get_or_create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=number, name=f"Équipe {number}")
    return TeamSeason.objects.create(team=team, season=season)


def admin():
    return User.objects.create_user(
        "admin@club.fr",
        "Admin",
        club_role=User.ClubRole.MENTOR,
        is_club_admin=True,
    )


def student(name, **extra):
    return User.objects.create_user(f"{name}@club.fr", name, **extra)


def as_admin(client, boss=None):
    client.force_login(boss or admin())
    return client


def notified():
    return sorted(
        (n.recipient.display_name, n.verb) for n in Notification.objects.all()
    )


def change_role(client, user, **fields):
    return client.patch(
        f"/api/users/{user.id}/", fields, content_type="application/json"
    )


def bell(client, user):
    client.force_login(user)
    return client.get("/api/notifications/").json()


# --- teams ---


def test_a_member_added_to_a_team_is_the_only_one_told(client):
    rouages = team_season()
    tom = student("tom")
    Membership.objects.create(user=tom, team_season=rouages)
    lina = student("lina")

    as_admin(client).post(
        "/api/memberships/", {"user": lina.id, "team_season": rouages.id}
    )

    assert notified() == [("lina", Notification.Verb.MEMBERSHIP_ADDED)]
    assert Notification.objects.get().team_season == rouages


def test_a_member_removed_from_a_team_still_sees_it_in_their_bell(client):
    rouages = team_season()
    lina = student("lina")
    membership = Membership.objects.create(user=lina, team_season=rouages)

    as_admin(client).delete(f"/api/memberships/{membership.id}/")

    # The team is no longer hers to open, but the notice is about her.
    answer = bell(client, lina)
    assert answer["unread"] == 1
    (notice,) = answer["items"]
    assert notice["verb"] == "membership_removed"
    assert notice["actor"]["display_name"] == "Admin"
    assert notice["team"] == "Équipe 12345"


def test_an_admin_adding_themselves_to_a_team_is_not_told(client):
    rouages = team_season()
    boss = admin()

    as_admin(client, boss).post(
        "/api/memberships/", {"user": boss.id, "team_season": rouages.id}
    )

    assert notified() == []


def test_a_suspended_member_added_to_a_team_is_not_told(client):
    rouages = team_season()
    lina = student("lina", is_active=False)

    as_admin(client).post(
        "/api/memberships/", {"user": lina.id, "team_season": rouages.id}
    )

    assert notified() == []


# --- roles ---


def test_a_new_role_is_told_to_the_member_alone_with_no_team(client):
    lina = student("lina")

    change_role(as_admin(client), lina, club_role="mentor")

    assert notified() == [("lina", Notification.Verb.MADE_MENTOR)]
    (notice,) = bell(client, lina)["items"]
    assert notice["team_season"] is None
    assert notice["team"] is None


def test_going_back_to_student_is_told(client):
    tom = student("tom", club_role=User.ClubRole.MENTOR)

    change_role(as_admin(client), tom, club_role="student")

    assert notified() == [("tom", Notification.Verb.MADE_STUDENT)]


def test_granting_then_revoking_admin_rights_are_both_told(client):
    tom = student("tom", club_role=User.ClubRole.MENTOR)
    as_admin(client)

    change_role(client, tom, is_club_admin=True)
    change_role(client, tom, is_club_admin=False)

    assert notified() == [
        ("tom", Notification.Verb.ADMIN_GRANTED),
        ("tom", Notification.Verb.ADMIN_REVOKED),
    ]


def test_a_student_made_mentor_and_admin_at_once_is_told_both(client):
    lina = student("lina")

    change_role(as_admin(client), lina, club_role="mentor", is_club_admin=True)

    assert notified() == [
        ("lina", Notification.Verb.ADMIN_GRANTED),
        ("lina", Notification.Verb.MADE_MENTOR),
    ]


def test_a_role_set_to_what_it_already_was_tells_nobody(client):
    tom = student("tom", club_role=User.ClubRole.MENTOR)

    change_role(as_admin(client), tom, club_role="mentor", is_club_admin=False)

    assert notified() == []


def test_a_suspension_tells_nobody(client):
    # The account can no longer sign in to read it.
    lina = student("lina")

    change_role(as_admin(client), lina, is_active=False)

    assert notified() == []


def test_a_refused_role_change_tells_nobody(client):
    lina = student("lina")

    response = change_role(as_admin(client), lina, is_club_admin=True)

    assert response.status_code == 400
    assert notified() == []


# --- personal verbs ---


def test_only_a_personal_verb_can_be_told_to_one_member():
    with pytest.raises(AssertionError):
        notify_member(admin(), student("lina"), Notification.Verb.ENTRY_ADDED)
