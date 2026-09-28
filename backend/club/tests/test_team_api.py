"""Drives #50 (team CRUD over the API) before it exists: red first, then the
views and serializers that turn these into green. `client` is Django's own
test client — it exercises whatever view answers the URL, DRF or not, so
these do not wait on DRF landing to be written.
"""

from django.test import Client

from club.api.serializers import AddMembershipSerializer, CreateTeamSerializer
from club.models import Membership, Season, Team, TeamSeason, User, WorkItem

from .races import overtaken_by


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


def test_creating_a_team_with_a_taken_number_is_refused_cleanly(client):
    client.force_login(admin())
    team()  # 12345, already taken
    season(2026, "BioBuzz")

    response = client.post(
        "/api/teams/",
        {"number": 12345, "name": "Une autre équipe", "season": 2026},
    )

    # Team.number is unique, but a plain Serializer does not know that on its
    # own — without validate_number this reaches Team.objects.create() and
    # comes back as a bare 500 (IntegrityError), not a clean refusal.
    assert response.status_code == 400
    assert Team.objects.filter(number=12345).count() == 1


def as_admin(user):
    """A second browser, for the rival request."""
    rival = Client()
    rival.force_login(user)
    return rival


def test_of_two_simultaneous_creations_of_one_team_number_the_second_is_refused(
    client, monkeypatch
):
    boss = admin()
    client.force_login(boss)
    season(2026, "BioBuzz")
    rival = overtaken_by(
        monkeypatch,
        CreateTeamSerializer,
        lambda: as_admin(boss).post(
            "/api/teams/", {"number": 12345, "name": "Rouages", "season": 2026}
        ),
    )

    response = client.post(
        "/api/teams/", {"number": 12345, "name": "Une autre", "season": 2026}
    )

    assert rival == [201]
    assert response.status_code == 400
    assert response.json()["number"][0]["code"] == "team_number_taken"
    assert Team.objects.count() == TeamSeason.objects.count() == 1


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


def test_a_team_with_members_cannot_be_deleted_over_the_api(client):
    client.force_login(admin())
    rouages_2026 = team_season()
    lina = student("lina@club.fr", "Lina")
    Membership.objects.create(user=lina, team_season=rouages_2026)

    response = client.delete(f"/api/teams/{rouages_2026.team.id}/")

    # team_seasons.count() == 1 here, so the history check alone would let
    # this through — cascading team_seasons.all().delete() would then take
    # Lina's membership with it, silently, with a 204 to show for it.
    assert response.status_code == 409
    assert Team.objects.filter(id=rouages_2026.team.id).exists()
    assert Membership.objects.filter(user=lina, team_season=rouages_2026).exists()


def test_a_team_can_be_deleted_once_its_last_member_is_removed(client):
    # The corrected demo script: create, add two, remove both, then delete.
    client.force_login(admin())
    rouages_2026 = team_season()
    lina = student("lina@club.fr", "Lina")
    membership = Membership.objects.create(user=lina, team_season=rouages_2026)

    client.delete(f"/api/memberships/{membership.id}/")
    response = client.delete(f"/api/teams/{rouages_2026.team.id}/")

    assert response.status_code == 204
    assert not Team.objects.filter(id=rouages_2026.team.id).exists()


def test_a_team_with_work_items_cannot_be_deleted_over_the_api(client):
    # No member left, one season: only the work items stand in the way.
    client.force_login(admin())
    rouages_2026 = team_season()
    WorkItem.objects.create(team_season=rouages_2026, title="intake")

    response = client.delete(f"/api/teams/{rouages_2026.team.id}/")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "team_has_history"
    assert WorkItem.objects.filter(team_season=rouages_2026).exists()


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


def test_of_two_simultaneous_additions_of_one_member_the_second_is_refused(
    client, monkeypatch
):
    boss = admin()
    client.force_login(boss)
    rouages_2026 = team_season()
    lina = student("lina@club.fr", "Lina")
    body = {"user": lina.id, "team_season": rouages_2026.id}
    rival = overtaken_by(
        monkeypatch,
        AddMembershipSerializer,
        lambda: as_admin(boss).post("/api/memberships/", body),
    )

    response = client.post("/api/memberships/", body)

    assert rival == [201]
    assert response.status_code == 400
    assert response.json()["non_field_errors"][0]["code"] == "membership_exists"
    assert Membership.objects.filter(user=lina, team_season=rouages_2026).count() == 1


def test_adding_two_members_then_removing_one(client):
    # The exact scenario from docs/modules.md §3's demo script — the two
    # preceding tests already cover add and remove in isolation, this one
    # is the end-to-end walk a corrector will actually watch.
    client.force_login(admin())
    rouages_2026 = team_season()
    lina = student("lina@club.fr", "Lina")
    tom = student("tom@club.fr", "Tom")

    add_lina = client.post(
        "/api/memberships/", {"user": lina.id, "team_season": rouages_2026.id}
    )
    add_tom = client.post(
        "/api/memberships/", {"user": tom.id, "team_season": rouages_2026.id}
    )
    assert add_lina.status_code == 201
    assert add_tom.status_code == 201
    assert rouages_2026.memberships.count() == 2

    lina_membership = Membership.objects.get(user=lina, team_season=rouages_2026)
    response = client.delete(f"/api/memberships/{lina_membership.id}/")

    assert response.status_code == 204
    remaining = list(rouages_2026.memberships.all())
    assert len(remaining) == 1
    assert remaining[0].user == tom


def test_removing_a_member_deletes_the_membership(client):
    client.force_login(admin())
    rouages_2026 = team_season()
    lina = student("lina@club.fr", "Lina")
    membership = Membership.objects.create(user=lina, team_season=rouages_2026)

    client.delete(f"/api/memberships/{membership.id}/")

    assert not Membership.objects.filter(id=membership.id).exists()


# --- listing teams, for the management screen ---


def test_the_team_list_shows_the_current_seasons_teams_and_their_rosters(client):
    client.force_login(admin())
    season(2025, "Into the Deep")
    current = team_season(12345, 2026, "BioBuzz")
    Membership.objects.create(user=student("z@club.fr", "Zoé"), team_season=current)
    Membership.objects.create(user=student("m@club.fr", "marie"), team_season=current)

    body = client.get("/api/teams/").json()

    assert body["season"] == {"start_year": 2026, "game_name": "BioBuzz"}
    [listed] = body["teams"]
    assert listed["number"] == 12345
    assert listed["team_season"] == current.id
    # Folded, so a lower-case name is not sorted after Z.
    assert [member["display_name"] for member in listed["members"]] == [
        "marie",
        "Zoé",
    ]


def test_the_team_list_leaves_out_a_team_not_opened_this_season(client):
    client.force_login(admin())
    old = team_season(111, 2025, "Into the Deep")
    TeamSeason.objects.create(team=team(222), season=season(2026, "BioBuzz"))

    body = client.get("/api/teams/").json()

    assert [listed["number"] for listed in body["teams"]] == [222]
    assert old.team.number not in [listed["number"] for listed in body["teams"]]


def test_the_team_list_with_no_season_is_empty(client):
    client.force_login(admin())

    assert client.get("/api/teams/").json() == {"season": None, "teams": []}


def test_the_team_list_requires_a_club_admin(client):
    client.force_login(student())

    assert client.get("/api/teams/").status_code == 403


# --- searching members to add ---


def test_searching_users_ignores_case_and_accents_as_typed(client):
    client.force_login(admin())
    student("e@club.fr", "Élodie")
    student("m@club.fr", "Marie")

    body = client.get("/api/users/", {"search": "éLO"}).json()

    assert [user["display_name"] for user in body] == ["Élodie"]
    assert body[0]["club_role"] == "student"


def test_searching_users_leaves_out_inactive_accounts(client):
    client.force_login(admin())
    gone = student("g@club.fr", "Gaston")
    gone.is_active = False
    gone.save()

    assert client.get("/api/users/", {"search": "gas"}).json() == []


def test_an_empty_search_lists_nobody(client):
    client.force_login(admin())
    student()

    assert client.get("/api/users/", {"search": "  "}).json() == []


def test_searching_users_requires_a_club_admin(client):
    client.force_login(student())

    assert client.get("/api/users/", {"search": "a"}).status_code == 403


def test_searching_for_a_team_leaves_its_members_out_before_the_cap(client):
    client.force_login(admin())
    current = team_season()
    for index in range(10):
        member = student(f"a{index}@club.fr", f"Alex {index}")
        Membership.objects.create(user=member, team_season=current)
    outsider = student("z@club.fr", "Alex Z")

    body = client.get(
        "/api/users/", {"search": "alex", "team_season": current.id}
    ).json()

    assert [user["id"] for user in body] == [outsider.id]


def test_without_a_search_the_user_list_is_still_every_account(client):
    client.force_login(admin())
    gone = student("g@club.fr", "Gaston")
    gone.is_active = False
    gone.save()

    body = client.get("/api/users/").json()

    assert gone.id in [user["id"] for user in body]
