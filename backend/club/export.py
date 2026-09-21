"""The notebook export: a team's season gathered once, as material for whoever
writes the portfolio elsewhere. Every rule is applied here; each output format
only lays out what `gather` returns."""

from dataclasses import dataclass, field
from datetime import datetime

from club.models import Entry, TeamSeason


@dataclass
class Item:
    occurred_at: datetime
    type: str
    step: str | None
    body: str
    handover: str
    author: str
    participants: list[str]


@dataclass
class Chapter:
    title: str
    # None for what belongs to no work item.
    status: str | None
    items: list[Item] = field(default_factory=list)


@dataclass
class Category:
    title: str
    chapters: list[Chapter]


@dataclass
class Notebook:
    team: str
    season: str
    categories: list[Category]


def _item(entry: Entry) -> Item:
    return Item(
        occurred_at=entry.occurred_at,
        type=entry.type,
        step=entry.step,
        body=entry.body,
        handover=entry.handover,
        author=entry.author.display_name,
        participants=[user.display_name for user in entry.participants.all()],
    )


def gather(team_season: TeamSeason) -> Notebook:
    """Categories are read off the work items, never tagged by hand. A work
    item nobody worked on has no material and is left out; within a chapter,
    entries run oldest first, so a thread reads as a story."""
    entries = (
        team_season.entries.select_related("author", "work_item")
        .prefetch_related("participants")
        .order_by("occurred_at", "id")
    )
    robot: dict[int, Chapter] = {}
    outreach: dict[int, Chapter] = {}
    life = Chapter(title="Vie de l'équipe", status=None)
    for entry in entries:
        item = entry.work_item
        if item is None:
            life.items.append(_item(entry))
            continue
        chapters = robot if item.on_robot else outreach
        chapter = chapters.setdefault(item.id, Chapter(item.title, item.status))
        chapter.items.append(_item(entry))

    categories = [
        Category("Construction du robot", list(robot.values())),
        Category("Outreach", list(outreach.values())),
        Category("Vie de l'équipe", [life] if life.items else []),
    ]
    return Notebook(
        team=str(team_season.team),
        season=team_season.season.label,
        categories=[category for category in categories if category.chapters],
    )
