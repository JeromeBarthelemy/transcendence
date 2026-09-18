"""Drives #50 (team CRUD over the API) before it exists: red first, then the
views and serializers that turn these into green. `client` is Django's own
test client — it exercises whatever view answers the URL, DRF or not, so
these do not wait on DRF landing to be written.
"""

from club.models import Membership, Season, Team, TeamSeason, User


def season(start_year=2026, game_name="BioBuzz"):
    return Season.objects.create(start_year=start_year, game_name=game_name)


def team(number=12345, name="Rouages & Cie"):
    return Team.objects.create(number=number, name=name)


def team_season(number=12345, start_year=2026, game_name="BioBuzz"):
    return TeamSeason.objects.create(
        team=team(number), season=season(start_year, game_name)
    )


def admin(email="admin@club.fr", display_name="Admin"):
    return User.objects.create_user(email, display_name, is_club_admin=True)


def student(email="eleve@club.fr", display_name="Élève"):
    return User.objects.create_user(email, display_name)


# --- creating a team ---


def test_creating_a_team_also_opens_its_team_season_for_the_given_season(client):
    client.force_login(admin())
    season(2026, "BioBuzz")

    client.post(
        "/api/teams/",
        {"number": 12345, "name": "Rouages & Cie", "season": 2026},
    )

    assert Team.objects.filter(number=12345).exists()
    assert TeamSeason.objects.filter(
        team__number=12345, season__start_year=2026
    ).exists()


def test_creating_a_team_for_an_unknown_season_is_refused(client):
    client.force_login(admin())

    response = client.post(
        "/api/teams/",
        {"number": 12345, "name": "Rouages & Cie", "season": 2099},
    )

    assert response.status_code == 400
    assert not Team.objects.exists()


def test_creating_a_team_requires_a_club_admin(client):
    client.force_login(student())

    response = client.post("/api/teams/", {"number": 12345, "name": "Rouages & Cie"})

    assert response.status_code == 403
    assert not Team.objects.exists()


def test_an_anonymous_request_cannot_create_a_team(client):
    response = client.post("/api/teams/", {"number": 12345, "name": "Rouages & Cie"})

    # DRF's SessionAuthentication never sets WWW-Authenticate, so a rejected
    # anonymous request comes back 403, not 401 — both count as "refused".
    assert response.status_code in (401, 403)
    assert not Team.objects.exists()


# --- renaming a team ---


def test_renaming_a_team_keeps_its_number(client):
    client.force_login(admin())
    rouages = team()

    client.patch(
        f"/api/teams/{rouages.id}/",
        {"name": "Les Rouages"},
        content_type="application/json",
    )

    rouages.refresh_from_db()
    assert rouages.name == "Les Rouages"
    assert rouages.number == 12345


# --- deleting a team ---


def test_a_team_with_no_history_can_be_deleted_over_the_api(client):
    client.force_login(admin())
    rouages = team()
    TeamSeason.objects.create(team=rouages, season=season())

    response = client.delete(f"/api/teams/{rouages.id}/")

    assert response.status_code == 204
    assert not Team.objects.filter(id=rouages.id).exists()


def test_a_team_with_last_season_history_cannot_be_deleted_over_the_api(client):
    # The real ProtectedError case (see club/models.py, TeamSeason.team):
    # two seasons of history, not the one just opened for the demo.
    client.force_login(admin())
    rouages = team()
    TeamSeason.objects.create(team=rouages, season=season(2025, "Centerstage"))
    TeamSeason.objects.create(team=rouages, season=season(2026, "BioBuzz"))

    response = client.delete(f"/api/teams/{rouages.id}/")

    # Same spirit as #3: a database constraint must surface as a clean
    # response, never a bare 500.
    assert response.status_code == 409
    assert Team.objects.filter(id=rouages.id).exists()


# --- memberships ---


def test_adding_a_member_creates_a_membership(client):
    client.force_login(admin())
    rouages_2026 = team_season()
    lina = student("lina@club.fr", "Lina")

    client.post("/api/memberships/", {"user": lina.id, "team_season": rouages_2026.id})

    assert Membership.objects.filter(user=lina, team_season=rouages_2026).exists()


def test_adding_the_same_member_twice_is_rejected_cleanly(client):
    client.force_login(admin())
    rouages_2026 = team_season()
    lina = student("lina@club.fr", "Lina")
    Membership.objects.create(user=lina, team_season=rouages_2026)

    response = client.post(
        "/api/memberships/", {"user": lina.id, "team_season": rouages_2026.id}
    )

    # Same spirit as #3 again: the unique constraint must not reach the
    # client as an IntegrityError traceback.
    assert response.status_code == 400
    assert Membership.objects.filter(user=lina, team_season=rouages_2026).count() == 1


def test_removing_a_member_deletes_the_membership(client):
    client.force_login(admin())
    rouages_2026 = team_season()
    lina = student("lina@club.fr", "Lina")
    membership = Membership.objects.create(user=lina, team_season=rouages_2026)

    client.delete(f"/api/memberships/{membership.id}/")

    assert not Membership.objects.filter(id=membership.id).exists()
