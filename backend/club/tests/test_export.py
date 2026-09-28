import io
import zipfile
from datetime import date, datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from django.core.files.base import ContentFile

from club.export import gather, to_markdown_zip
from club.models import (
    Attachment,
    Consent,
    Entry,
    EntryParticipant,
    Membership,
    Season,
    Team,
    TeamSeason,
    User,
    WorkItem,
)

PARIS = ZoneInfo("Europe/Paris")


def team_season(number=12345):
    season, _ = Season.objects.get_or_create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=number, name=f"Équipe {number}")
    return TeamSeason.objects.create(team=team, season=season)


def member(name):
    user, _ = User.objects.get_or_create(
        email=f"{name}@example.org", defaults={"display_name": name}
    )
    return user


def entry(team, day, *participants, work_item=None, type=Entry.Type.PROGRESS, **fields):
    written = Entry.objects.create(
        team_season=team,
        author=participants[0],
        work_item=work_item,
        type=type,
        occurred_at=datetime.combine(day, time(15), tzinfo=PARIS),
        **fields,
    )
    for user in participants:
        EntryParticipant.objects.create(entry=written, user=user)
    return written


def category(notebook, title):
    [found] = [c for c in notebook.categories if c.title == title]
    return found


def test_a_robot_work_item_is_a_chapter_of_building_the_robot():
    rouages = team_season()
    intake = WorkItem.objects.create(team_season=rouages, title="Intake", on_robot=True)
    lina, tom = member("lina"), member("tom")
    entry(rouages, date(2026, 10, 7), lina, work_item=intake, body="Maquette.")
    entry(
        rouages,
        date(2026, 9, 30),
        lina,
        tom,
        work_item=intake,
        body="Trois idées.",
        step=Entry.Step.BRAINSTORMING,
        handover="Choisir entre galets et courroie.",
    )

    [chapter] = category(gather(rouages), "Construction du robot").chapters

    assert chapter.title == "Intake"
    # Oldest first: a work item's thread reads as a story.
    first, second = chapter.items
    assert first.body == "Trois idées."
    assert first.occurred_at.date() == date(2026, 9, 30)
    assert first.step == Entry.Step.BRAINSTORMING
    assert first.handover == "Choisir entre galets et courroie."
    assert first.participants == ["lina", "tom"]
    assert second.body == "Maquette."


def test_a_work_item_off_the_robot_is_outreach():
    rouages = team_season()
    sponsoring = WorkItem.objects.create(team_season=rouages, title="Sponsoring")
    entry(rouages, date(2026, 10, 7), member("lina"), work_item=sponsoring)

    [chapter] = category(gather(rouages), "Outreach").chapters

    assert chapter.title == "Sponsoring"


def test_what_concerns_no_work_item_is_the_life_of_the_team():
    rouages = team_season()
    lina = member("lina")
    entry(rouages, date(2026, 10, 7), lina, type=Entry.Type.DECISION, body="Défense.")
    entry(rouages, date(2026, 10, 9), lina, type=Entry.Type.NOTE, body="Perceuse HS.")

    life = category(gather(rouages), "Vie de l'équipe")

    assert [item.body for chapter in life.chapters for item in chapter.items] == [
        "Défense.",
        "Perceuse HS.",
    ]


def test_a_work_item_nobody_worked_on_is_left_out():
    rouages = team_season()
    WorkItem.objects.create(
        team_season=rouages,
        title="Lanceur",
        on_robot=True,
        status=WorkItem.Status.DROPPED,
    )

    assert gather(rouages).categories == []


def test_a_work_item_dropped_after_working_on_it_keeps_its_story():
    rouages = team_season()
    courroie = WorkItem.objects.create(
        team_season=rouages,
        title="Courroie",
        on_robot=True,
        status=WorkItem.Status.DROPPED,
    )
    entry(rouages, date(2026, 10, 7), member("lina"), work_item=courroie)

    [chapter] = category(gather(rouages), "Construction du robot").chapters

    assert chapter.status == WorkItem.Status.DROPPED


def test_another_teams_work_is_not_in_the_notebook():
    rouages = team_season(12345)
    theirs = team_season(67890)
    intake = WorkItem.objects.create(team_season=theirs, title="Intake", on_robot=True)
    entry(theirs, date(2026, 10, 7), member("sam"), work_item=intake)

    assert gather(rouages).categories == []


def test_a_selective_export_keeps_only_the_category_asked_for():
    rouages = team_season()
    lina = member("lina")
    intake = WorkItem.objects.create(team_season=rouages, title="Intake", on_robot=True)
    entry(rouages, date(2026, 10, 7), lina, work_item=intake)
    entry(rouages, date(2026, 10, 8), lina, type=Entry.Type.NOTE)

    notebook = gather(rouages, category="robot")

    assert [c.title for c in notebook.categories] == ["Construction du robot"]


def test_a_selective_export_keeps_only_the_work_item_asked_for():
    rouages = team_season()
    lina = member("lina")
    intake = WorkItem.objects.create(team_season=rouages, title="Intake", on_robot=True)
    lanceur = WorkItem.objects.create(
        team_season=rouages, title="Lanceur", on_robot=True
    )
    entry(rouages, date(2026, 10, 7), lina, work_item=intake)
    entry(rouages, date(2026, 10, 7), lina, work_item=lanceur)
    entry(rouages, date(2026, 10, 8), lina, type=Entry.Type.NOTE)

    [robot] = gather(rouages, work_item=intake).categories

    assert [chapter.title for chapter in robot.chapters] == ["Intake"]


# --- the Markdown rendering ---


def unzip(archive):
    """Markdown as text, attached files as the bytes they are."""
    with zipfile.ZipFile(io.BytesIO(archive)) as files:
        return {
            name: files.read(name).decode()
            if name.endswith(".md")
            else files.read(name)
            for name in files.namelist()
        }


def zipped(notebook):
    archive = io.BytesIO()
    to_markdown_zip(notebook, archive)
    return archive.getvalue()


def downloaded(response):
    return b"".join(response.streaming_content)


def test_each_category_is_a_markdown_file():
    rouages = team_season()
    lina = member("lina")
    intake = WorkItem.objects.create(team_season=rouages, title="Intake", on_robot=True)
    entry(rouages, date(2026, 10, 7), lina, work_item=intake)
    entry(rouages, date(2026, 10, 8), lina, type=Entry.Type.NOTE)

    files = unzip(zipped(gather(rouages)))

    assert sorted(files) == [
        "1-construction-du-robot.md",
        "2-vie-de-lequipe.md",
        "A-LIRE.md",
    ]


def test_a_chapter_reads_with_its_sources():
    rouages = team_season()
    intake = WorkItem.objects.create(team_season=rouages, title="Intake", on_robot=True)
    entry(
        rouages,
        date(2026, 9, 30),
        member("lina"),
        member("tom"),
        work_item=intake,
        body="Trois idées de rouleaux.",
        step=Entry.Step.BRAINSTORMING,
        handover="Choisir entre galets et courroie.",
    )

    text = unzip(zipped(gather(rouages)))["1-construction-du-robot.md"]

    assert "## Intake" in text
    assert "mercredi 30 septembre 2026 · brainstorming — lina, tom" in text
    assert "Trois idées de rouleaux." in text
    assert "Choisir entre galets et courroie." in text


def test_the_life_of_the_team_is_not_titled_twice():
    rouages = team_season()
    entry(rouages, date(2026, 10, 8), member("jo"), type=Entry.Type.NOTE, body="HS.")

    text = unzip(zipped(gather(rouages)))["1-vie-de-lequipe.md"]

    assert text.count("Vie de l'équipe") == 1


# --- downloading it ---


def export_url(team, **query):
    params = "&".join(f"{key}={value}" for key, value in query.items())
    return f"/api/team-seasons/{team.id}/export/?{params}"


def test_a_member_downloads_the_notebook_as_an_archive(client):
    rouages = team_season()
    lina = member("lina")
    Membership.objects.create(user=lina, team_season=rouages)
    entry(rouages, date(2026, 10, 8), lina, type=Entry.Type.NOTE, body="HS.")
    client.force_login(lina)

    response = client.get(export_url(rouages, format="markdown"))

    assert response.status_code == 200
    assert response["Content-Type"] == "application/zip"
    assert "attachment" in response["Content-Disposition"]
    assert sorted(unzip(downloaded(response))) == ["1-vie-de-lequipe.md", "A-LIRE.md"]


def test_markdown_is_the_format_by_default(client):
    rouages = team_season()
    lina = member("lina")
    Membership.objects.create(user=lina, team_season=rouages)
    client.force_login(lina)

    assert client.get(export_url(rouages))["Content-Type"] == "application/zip"


def test_an_unknown_format_is_refused(client):
    rouages = team_season()
    lina = member("lina")
    Membership.objects.create(user=lina, team_season=rouages)
    client.force_login(lina)

    response = client.get(export_url(rouages, format="docx"))

    assert response.status_code == 400
    assert response.json()["format"][0]["code"] == "invalid_choice"


def test_a_student_cannot_export_another_teams_notebook(client):
    rouages = team_season(12345)
    sam = member("sam")
    Membership.objects.create(user=sam, team_season=team_season(67890))
    client.force_login(sam)

    assert client.get(export_url(rouages)).status_code == 403


def test_a_member_downloads_one_category(client):
    rouages = team_season()
    lina = member("lina")
    Membership.objects.create(user=lina, team_season=rouages)
    sponsoring = WorkItem.objects.create(team_season=rouages, title="Sponsoring")
    entry(rouages, date(2026, 10, 7), lina, work_item=sponsoring)
    entry(rouages, date(2026, 10, 8), lina, type=Entry.Type.NOTE)
    client.force_login(lina)

    response = client.get(export_url(rouages, category="outreach"))

    assert sorted(unzip(downloaded(response))) == ["1-outreach.md", "A-LIRE.md"]


def test_a_member_downloads_one_work_item(client):
    rouages = team_season()
    lina = member("lina")
    Membership.objects.create(user=lina, team_season=rouages)
    sponsoring = WorkItem.objects.create(team_season=rouages, title="Sponsoring")
    entry(rouages, date(2026, 10, 7), lina, work_item=sponsoring)
    entry(rouages, date(2026, 10, 8), lina, type=Entry.Type.NOTE)
    client.force_login(lina)

    response = client.get(export_url(rouages, work_item=sponsoring.id))

    assert sorted(unzip(downloaded(response))) == ["1-outreach.md", "A-LIRE.md"]


def test_an_unknown_category_is_refused(client):
    rouages = team_season()
    lina = member("lina")
    Membership.objects.create(user=lina, team_season=rouages)
    client.force_login(lina)

    response = client.get(export_url(rouages, category="robots"))

    assert response.status_code == 400
    assert response.json()["category"][0]["code"] == "invalid_choice"


def test_another_teams_work_item_cannot_be_exported(client):
    rouages = team_season(12345)
    lina = member("lina")
    Membership.objects.create(user=lina, team_season=rouages)
    theirs = WorkItem.objects.create(team_season=team_season(67890), title="Intake")
    client.force_login(lina)

    response = client.get(export_url(rouages, work_item=theirs.id))

    assert response.status_code == 400
    assert response.json()["work_item"][0]["code"] == "work_item_not_in_team"


# --- attached files ---


@pytest.fixture
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


def attached(to, name="plan.pdf", content=b"%PDF-1.7 plan", recognisable=False):
    return Attachment.objects.create(
        entry=to,
        uploaded_by=to.author,
        file=ContentFile(content, name=f"stored{Path(name).suffix.lower()}"),
        name=name,
        content_type="application/pdf",
        people_recognisable=recognisable,
    )


def refuses(user, on=date(2026, 9, 1)):
    Consent.objects.create(
        user=user,
        decision=Consent.Decision.REFUSED,
        granted_by=Consent.GrantedBy.LEGAL_GUARDIAN,
        decided_at=datetime.combine(on, time(12), tzinfo=PARIS),
    )


def test_an_entrys_files_are_in_the_archive_as_they_were_sent(media_root):
    rouages = team_season()
    note = entry(rouages, date(2026, 10, 8), member("lina"), type=Entry.Type.NOTE)
    plan = attached(note, "Plan intake v3.pdf")

    files = unzip(zipped(gather(rouages)))

    assert files[f"fichiers/{plan.id}-plan-intake-v3.pdf"] == b"%PDF-1.7 plan"


def test_an_entry_links_to_its_files(media_root):
    rouages = team_season()
    note = entry(rouages, date(2026, 10, 8), member("lina"), type=Entry.Type.NOTE)
    plan = attached(note, "Plan intake v3.pdf")

    text = unzip(zipped(gather(rouages)))["1-vie-de-lequipe.md"]

    assert f"[Plan intake v3.pdf](fichiers/{plan.id}-plan-intake-v3.pdf)" in text


def test_two_files_sent_with_the_same_name_are_both_kept(media_root):
    rouages = team_season()
    note = entry(rouages, date(2026, 10, 8), member("lina"), type=Entry.Type.NOTE)
    first = attached(note, "IMG_0042.jpg", b"first")
    second = attached(note, "IMG_0042.jpg", b"second")

    files = unzip(zipped(gather(rouages)))

    assert files[f"fichiers/{first.id}-img_0042.jpg"] == b"first"
    assert files[f"fichiers/{second.id}-img_0042.jpg"] == b"second"


def test_the_archive_says_to_check_image_rights_and_that_nobody_refused(media_root):
    rouages = team_season()
    lina = member("lina")
    Membership.objects.create(user=lina, team_season=rouages)
    note = entry(rouages, date(2026, 10, 8), lina, type=Entry.Type.NOTE)
    attached(note, recognisable=True)

    text = unzip(zipped(gather(rouages)))["A-LIRE.md"]

    assert "droit à l'image" in text
    assert "Refus en vigueur : aucun." in text
    assert "Fichiers à vérifier : aucun." in text


def test_a_file_with_people_on_it_is_to_check_when_a_team_member_refused(media_root):
    rouages = team_season()
    lina, jade = member("lina"), member("jade")
    for user in (lina, jade):
        Membership.objects.create(user=user, team_season=rouages)
    refuses(jade, on=date(2026, 9, 20))
    note = entry(rouages, date(2026, 10, 8), lina, type=Entry.Type.NOTE)
    photo = attached(note, "Démo collège.jpg", recognisable=True)
    attached(note, "Plan.pdf", recognisable=False)

    text = unzip(zipped(gather(rouages)))["A-LIRE.md"]

    assert "jade, depuis le 20 septembre 2026" in text
    assert f"fichiers/{photo.id}-demo-college.jpg" in text
    assert "Plan.pdf" not in text


def test_the_downloaded_notebook_carries_the_files(client, media_root):
    rouages = team_season()
    lina = member("lina")
    Membership.objects.create(user=lina, team_season=rouages)
    note = entry(rouages, date(2026, 10, 8), lina, type=Entry.Type.NOTE)
    plan = attached(note, "plan.pdf")
    client.force_login(lina)

    response = client.get(export_url(rouages))

    files = unzip(downloaded(response))
    assert files[f"fichiers/{plan.id}-plan.pdf"] == b"%PDF-1.7 plan"


def test_an_attached_file_is_dated_the_day_it_was_attached(media_root):
    rouages = team_season()
    note = entry(rouages, date(2026, 10, 8), member("lina"), type=Entry.Type.NOTE)
    plan = attached(note, "plan.pdf")
    Attachment.objects.filter(pk=plan.pk).update(
        uploaded_at=datetime(2026, 10, 9, 18, 30, tzinfo=PARIS)
    )

    with zipfile.ZipFile(io.BytesIO(zipped(gather(rouages)))) as files:
        info = files.getinfo(f"fichiers/{plan.id}-plan.pdf")

    assert info.date_time == (2026, 10, 9, 18, 30, 0)
