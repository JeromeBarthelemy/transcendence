import io
import zipfile
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from club.export import gather, to_markdown_zip
from club.models import (
    Entry,
    EntryParticipant,
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


# --- the Markdown rendering ---


def unzip(archive):
    with zipfile.ZipFile(io.BytesIO(archive)) as files:
        return {name: files.read(name).decode() for name in files.namelist()}


def test_each_category_is_a_markdown_file():
    rouages = team_season()
    lina = member("lina")
    intake = WorkItem.objects.create(team_season=rouages, title="Intake", on_robot=True)
    entry(rouages, date(2026, 10, 7), lina, work_item=intake)
    entry(rouages, date(2026, 10, 8), lina, type=Entry.Type.NOTE)

    files = unzip(to_markdown_zip(gather(rouages)))

    assert sorted(files) == ["1-construction-du-robot.md", "2-vie-de-lequipe.md"]


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

    text = unzip(to_markdown_zip(gather(rouages)))["1-construction-du-robot.md"]

    assert "## Intake" in text
    assert "mercredi 30 septembre 2026 · brainstorming — lina, tom" in text
    assert "Trois idées de rouleaux." in text
    assert "Choisir entre galets et courroie." in text


def test_the_life_of_the_team_is_not_titled_twice():
    rouages = team_season()
    entry(rouages, date(2026, 10, 8), member("jo"), type=Entry.Type.NOTE, body="HS.")

    text = unzip(to_markdown_zip(gather(rouages)))["1-vie-de-lequipe.md"]

    assert text.count("Vie de l'équipe") == 1
