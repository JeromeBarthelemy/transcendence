"""Who is told of a change on the board (module 13): those who follow the work
item, the whole team for what concerns no work item, never the one who made
the change."""

from datetime import timedelta

from django.utils import timezone

from club.models import (
    Entry,
    Membership,
    Notification,
    Season,
    Team,
    TeamSeason,
    User,
    WorkItem,
)
from club.notifications import record_change
from club.progress import join, record_progress


def team_season(number=12345):
    season, _ = Season.objects.get_or_create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=number, name=f"Équipe {number}")
    return TeamSeason.objects.create(team=team, season=season)


def member_of(team_season, name):
    user = User.objects.create_user(f"{name}@example.org", name)
    Membership.objects.create(user=user, team_season=team_season)
    return user


def notified(verb=None):
    notifications = Notification.objects.all()
    if verb is not None:
        notifications = notifications.filter(verb=verb)
    return sorted(n.recipient.display_name for n in notifications)


def note(team_season, author, work_item=None):
    return Entry.objects.create(
        team_season=team_season,
        author=author,
        work_item=work_item,
        type=Entry.Type.NOTE,
        body="Perceuse HS.",
    )


def test_a_note_on_a_work_item_notifies_those_who_took_part_in_its_progress(db):
    rouages = team_season()
    lina, tom, ines = (member_of(rouages, n) for n in ("lina", "tom", "ines"))
    intake = WorkItem.objects.create(team_season=rouages, title="intake")
    progress = record_progress(intake, lina, "Galets montés.")
    join(progress, tom)

    record_change(
        ines,
        Notification.Verb.ENTRY_ADDED,
        team_season=rouages,
        work_item=intake,
        entry=note(rouages, ines, intake),
    )

    # Inès wrote it and never took part: Lina and Tom follow intake.
    assert notified() == ["lina", "tom"]


def test_the_author_of_a_change_is_never_told_of_it(db):
    rouages = team_season()
    lina, tom = member_of(rouages, "lina"), member_of(rouages, "tom")
    intake = WorkItem.objects.create(team_season=rouages, title="intake")
    progress = record_progress(intake, lina, "Galets montés.")
    join(progress, tom)

    record_change(
        lina,
        Notification.Verb.ENTRY_UPDATED,
        team_season=rouages,
        work_item=intake,
        entry=progress,
    )

    assert notified() == ["tom"]


def test_a_trace_about_no_work_item_notifies_the_whole_team(db):
    rouages = team_season()
    lina = member_of(rouages, "lina")
    member_of(rouages, "tom")
    member_of(rouages, "ines")
    member_of(team_season(67890), "sam")

    record_change(
        lina,
        Notification.Verb.ENTRY_ADDED,
        team_season=rouages,
        work_item=None,
        entry=note(rouages, lina),
    )

    assert notified() == ["ines", "tom"]


def test_opening_a_work_item_notifies_the_whole_team(db):
    # Nobody follows a work item yet when it opens: it is the team's news.
    rouages = team_season()
    lina = member_of(rouages, "lina")
    member_of(rouages, "tom")
    intake = WorkItem.objects.create(team_season=rouages, title="intake")

    record_change(
        lina, Notification.Verb.WORK_ITEM_OPENED, team_season=rouages, work_item=intake
    )

    assert notified() == ["tom"]


def test_a_deactivated_account_is_never_notified(db):
    rouages = team_season()
    lina, tom = member_of(rouages, "lina"), member_of(rouages, "tom")
    tom.is_active = False
    tom.save()

    record_change(
        lina,
        Notification.Verb.ENTRY_ADDED,
        team_season=rouages,
        work_item=None,
        entry=note(rouages, lina),
    )

    assert notified() == []


def test_a_follower_removed_from_the_team_is_no_longer_notified(db):
    rouages = team_season()
    lina, tom = member_of(rouages, "lina"), member_of(rouages, "tom")
    intake = WorkItem.objects.create(team_season=rouages, title="intake")
    join(record_progress(intake, lina, "Galets montés."), tom)
    Membership.objects.filter(user=tom).delete()

    record_change(
        lina,
        Notification.Verb.ENTRY_ADDED,
        team_season=rouages,
        work_item=intake,
        entry=note(rouages, lina, intake),
    )

    assert notified() == []


def test_a_mentor_follower_is_notified_without_being_a_member(db):
    rouages = team_season()
    lina = member_of(rouages, "lina")
    marc = User.objects.create_user(
        "marc@example.org", "marc", club_role=User.ClubRole.MENTOR
    )
    intake = WorkItem.objects.create(team_season=rouages, title="intake")
    join(record_progress(intake, lina, "Galets montés."), marc)

    record_change(
        lina,
        Notification.Verb.ENTRY_ADDED,
        team_season=rouages,
        work_item=intake,
        entry=note(rouages, lina, intake),
    )

    assert notified() == ["marc"]


def test_a_removal_is_still_told_once_the_trace_and_work_item_are_gone(db):
    rouages = team_season()
    lina, tom = member_of(rouages, "lina"), member_of(rouages, "tom")
    intake = WorkItem.objects.create(team_season=rouages, title="intake")
    removed = note(rouages, lina)

    record_change(
        lina,
        Notification.Verb.ENTRY_REMOVED,
        team_season=rouages,
        work_item=None,
        entry=removed,
    )
    removed.delete()
    record_change(
        lina, Notification.Verb.WORK_ITEM_DELETED, team_season=rouages, work_item=intake
    )
    intake.delete()

    told = Notification.objects.order_by("id")
    assert [(n.verb, n.entry_type, n.work_item_title) for n in told] == [
        (Notification.Verb.ENTRY_REMOVED, Entry.Type.NOTE, ""),
        (Notification.Verb.WORK_ITEM_DELETED, None, "intake"),
    ]
    assert all(n.recipient == tom and n.read_at is None for n in told)


def test_the_last_to_leave_todays_progress_tells_its_followers_it_is_gone(client, db):
    rouages = team_season()
    lina, tom = member_of(rouages, "lina"), member_of(rouages, "tom")
    intake = WorkItem.objects.create(team_season=rouages, title="intake")
    earlier = record_progress(intake, tom, "Galets montés.")
    Entry.objects.filter(pk=earlier.pk).update(
        occurred_at=timezone.now() - timedelta(days=2)
    )
    client.force_login(lina)
    client.post(f"/api/work-items/{intake.id}/tick/", {}, "application/json")

    response = client.delete(f"/api/work-items/{intake.id}/tick/")

    assert response.status_code == 204
    told = Notification.objects.filter(recipient=tom).order_by("id")
    assert [(n.verb, n.entry, n.entry_type) for n in told] == [
        (Notification.Verb.ENTRY_ADDED, None, Entry.Type.PROGRESS),
        (Notification.Verb.ENTRY_REMOVED, None, Entry.Type.PROGRESS),
    ]


# --- reading them ---


def told_of_a_note(team_season, author):
    """A note by `author` on no work item: its whole team is told."""
    record_change(
        author,
        Notification.Verb.ENTRY_ADDED,
        team_season=team_season,
        work_item=None,
        entry=note(team_season, author),
    )


def test_a_member_sees_their_unread_count_and_what_happened(client, db):
    rouages = team_season()
    lina, tom = member_of(rouages, "lina"), member_of(rouages, "tom")
    intake = WorkItem.objects.create(team_season=rouages, title="intake")
    record_change(
        lina, Notification.Verb.WORK_ITEM_OPENED, team_season=rouages, work_item=intake
    )
    told_of_a_note(rouages, lina)
    client.force_login(tom)

    answer = client.get("/api/notifications/").json()

    assert answer["unread"] == 2
    latest, first = answer["items"]
    assert latest["verb"] == "entry_added"
    assert latest["actor"] == {"display_name": "lina", "avatar": None}
    assert latest["work_item"] is None
    assert latest["entry"]["type"] == "note"
    assert latest["read"] is False
    assert first["verb"] == "work_item_opened"
    assert first["work_item"] == {"id": intake.id, "title": "intake"}
    assert first["entry"] is None


def test_a_member_never_sees_anyone_elses_notifications(client, db):
    rouages = team_season()
    lina, tom = member_of(rouages, "lina"), member_of(rouages, "tom")
    told_of_a_note(rouages, tom)
    client.force_login(tom)

    answer = client.get("/api/notifications/").json()

    # Lina was told, Tom wrote it.
    assert answer == {"unread": 0, "items": []}
    assert Notification.objects.filter(recipient=lina).count() == 1


def test_a_member_removed_from_the_team_no_longer_sees_its_notifications(client, db):
    rouages = team_season()
    lina, tom = member_of(rouages, "lina"), member_of(rouages, "tom")
    told_of_a_note(rouages, lina)
    Membership.objects.filter(user=tom).delete()
    client.force_login(tom)

    listed = client.get("/api/notifications/").json()
    marked = client.post(
        "/api/notifications/read/", {}, content_type="application/json"
    )

    assert listed == {"unread": 0, "items": []}
    assert marked.json() == {"unread": 0}


def test_a_deleted_work_item_is_still_named_in_its_notice(client, db):
    rouages = team_season()
    lina, tom = member_of(rouages, "lina"), member_of(rouages, "tom")
    pince = WorkItem.objects.create(team_season=rouages, title="pince")
    record_change(
        lina, Notification.Verb.WORK_ITEM_DELETED, team_season=rouages, work_item=pince
    )
    pince.delete()
    client.force_login(tom)

    (item,) = client.get("/api/notifications/").json()["items"]

    assert item["work_item"] == {"id": None, "title": "pince"}


def test_marking_all_as_read_brings_the_count_back_to_zero(client, db):
    rouages = team_season()
    lina, tom = member_of(rouages, "lina"), member_of(rouages, "tom")
    told_of_a_note(rouages, lina)
    told_of_a_note(rouages, lina)
    client.force_login(tom)

    response = client.post(
        "/api/notifications/read/", {}, content_type="application/json"
    )

    assert response.json() == {"unread": 0}
    answer = client.get("/api/notifications/").json()
    assert answer["unread"] == 0
    assert [item["read"] for item in answer["items"]] == [True, True]


def test_marking_some_as_read_leaves_the_others_and_never_someone_elses(client, db):
    rouages = team_season()
    lina, tom = member_of(rouages, "lina"), member_of(rouages, "tom")
    told_of_a_note(rouages, lina)
    told_of_a_note(rouages, lina)
    told_of_a_note(rouages, tom)
    toms = list(Notification.objects.filter(recipient=tom).order_by("id"))
    linas = Notification.objects.get(recipient=lina)
    client.force_login(tom)

    response = client.post(
        "/api/notifications/read/",
        {"ids": [toms[0].id, linas.id]},
        content_type="application/json",
    )

    assert response.json() == {"unread": 1}
    linas.refresh_from_db()
    assert linas.read_at is None


def test_an_id_past_what_the_database_holds_is_refused(client, db):
    rouages = team_season()
    client.force_login(member_of(rouages, "tom"))

    response = client.post(
        "/api/notifications/read/",
        {"ids": [99999999999999999999]},
        content_type="application/json",
    )

    assert response.status_code == 400


def test_a_visitor_has_no_notifications(client, db):
    assert client.get("/api/notifications/").status_code == 403
    assert client.post("/api/notifications/read/").status_code == 403
