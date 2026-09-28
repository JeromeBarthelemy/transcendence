"""The notebook export: a team's season gathered once, as material for whoever
writes the portfolio elsewhere. Every rule is applied here; each output format
only lays out what `gather` returns."""

import shutil
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import IO

from django.db.models.fields.files import FieldFile
from django.utils import formats, timezone
from django.utils.text import slugify

from club.models import Attachment, Consent, Entry, Membership, TeamSeason, WorkItem


@dataclass
class AttachedFile:
    # As it was sent, for the reader.
    name: str
    # Where it sits in the archive: the id keeps two IMG_0042.jpg apart.
    path: str
    content: FieldFile
    uploaded_at: datetime
    to_check: bool


@dataclass
class Item:
    occurred_at: datetime
    type: str
    step: str | None
    body: str
    handover: str
    author: str
    participants: list[str]
    files: list[AttachedFile]


@dataclass
class Chapter:
    title: str
    # None for what belongs to no work item.
    status: str | None
    items: list[Item] = field(default_factory=list)


@dataclass
class Category:
    # What a selective export names the category by.
    key: str
    title: str
    chapters: list[Chapter]


CATEGORY_KEYS = ["robot", "outreach", "team-life"]


@dataclass
class Refusal:
    member: str
    since: datetime


@dataclass
class Notebook:
    team: str
    season: str
    categories: list[Category]
    # The team's members whose refusal is in force today.
    refusals: list[Refusal]

    def files(self) -> list[AttachedFile]:
        return [
            attached
            for category in self.categories
            for chapter in category.chapters
            for item in chapter.items
            for attached in item.files
        ]


def _attached(attachment: Attachment, to_check: set[int]) -> AttachedFile:
    stem = slugify(Path(attachment.name).stem) or "fichier"
    suffix = Path(attachment.file.name or "").suffix
    return AttachedFile(
        name=attachment.name,
        path=f"fichiers/{attachment.id}-{stem}{suffix}",
        content=attachment.file,
        uploaded_at=attachment.uploaded_at,
        to_check=attachment.id in to_check,
    )


def _item(entry: Entry, to_check: set[int]) -> Item:
    return Item(
        occurred_at=entry.occurred_at,
        type=entry.type,
        step=entry.step,
        body=entry.body,
        handover=entry.handover,
        author=entry.author.display_name,
        participants=[user.display_name for user in entry.participants.all()],
        files=[_attached(file, to_check) for file in entry.attachments.all()],
    )


def gather(
    team_season: TeamSeason,
    category: str | None = None,
    work_item: WorkItem | None = None,
) -> Notebook:
    """Categories are read off the work items, never tagged by hand. A work
    item nobody worked on has no material and is left out; within a chapter,
    entries run oldest first, so a thread reads as a story. A selective export
    keeps one category, one work item, or both."""
    entries = (
        team_season.entries.select_related("author", "work_item")
        .prefetch_related("participants", "attachments")
        .order_by("occurred_at", "id")
    )
    if work_item is not None:
        entries = entries.filter(work_item=work_item)
    to_check = set(
        Attachment.objects.to_check()
        .filter(entry__team_season=team_season)
        .values_list("id", flat=True)
    )
    robot: dict[int, Chapter] = {}
    outreach: dict[int, Chapter] = {}
    life = Chapter(title="Vie de l'équipe", status=None)
    for entry in entries:
        item = entry.work_item
        if item is None:
            life.items.append(_item(entry, to_check))
            continue
        chapters = robot if item.on_robot else outreach
        chapter = chapters.setdefault(item.id, Chapter(item.title, item.status))
        chapter.items.append(_item(entry, to_check))

    categories = [
        Category("robot", "Construction du robot", list(robot.values())),
        Category("outreach", "Outreach", list(outreach.values())),
        Category("team-life", "Vie de l'équipe", [life] if life.items else []),
    ]
    members = Membership.objects.filter(team_season=team_season)
    return Notebook(
        team=str(team_season.team),
        season=team_season.season.label,
        categories=[
            kept
            for kept in categories
            if kept.chapters and category in (None, kept.key)
        ],
        refusals=[
            Refusal(decision.user.display_name, decision.decided_at)
            for decision in Consent.objects.refusals()
            if members.filter(user=decision.user).exists()
        ],
    )


def _markdown_item(item: Item) -> list[str]:
    source = [formats.date_format(timezone.localtime(item.occurred_at), "l j F Y")]
    if item.type != Entry.Type.PROGRESS:
        source.append(Entry.Type(item.type).label)
    if item.step:
        source.append(Entry.Step(item.step).label)
    lines = [
        f"### {' · '.join(source)} — {', '.join(item.participants or [item.author])}"
    ]
    if item.body:
        lines += ["", item.body]
    if item.handover:
        lines += ["", f"> À faire ensuite : {item.handover}"]
    if item.files:
        lines += ["", f"Fichiers : {', '.join(_link(file) for file in item.files)}"]
    return lines + [""]


def _link(attached: AttachedFile) -> str:
    # A bracket in the name would end the link text early.
    text = attached.name.replace("[", "\\[").replace("]", "\\]")
    return f"[{text}]({attached.path})"


def _markdown_category(notebook: Notebook, category: Category) -> str:
    lines = [f"# {category.title}", "", f"{notebook.team} · {notebook.season}", ""]
    for chapter in category.chapters:
        # What belongs to no work item is one chapter, already titled by its
        # category.
        if chapter.status is not None:
            label = WorkItem.Status(chapter.status).label
            lines += [f"## {chapter.title}", "", f"*{label}*", ""]
        for item in chapter.items:
            lines += _markdown_item(item)
    return "\n".join(lines)


def _read_me(notebook: Notebook) -> str:
    """What whoever opens the archive must know before using an image."""
    lines = [
        "# À lire avant d'utiliser ce cahier",
        "",
        f"{notebook.team} · {notebook.season}",
        "",
        (
            "Ce cahier est un document de travail interne au club : la matière "
            "dont on tire le portfolio, jamais publiée telle quelle. Avant de "
            "publier une image, vérifiez le droit à l'image des personnes qui y "
            "figurent."
        ),
        "",
    ]
    if not notebook.refusals:
        lines += ["Refus en vigueur : aucun.", ""]
    else:
        lines += ["Refus en vigueur :", ""]
        for refusal in notebook.refusals:
            since = formats.date_format(timezone.localtime(refusal.since), "j F Y")
            lines.append(f"- {refusal.member}, depuis le {since}")
        lines.append("")
    to_check = [attached for attached in notebook.files() if attached.to_check]
    if not to_check:
        lines += ["Fichiers à vérifier : aucun.", ""]
    else:
        lines += ["Fichiers à vérifier, des personnes y sont reconnaissables :", ""]
        lines += [f"- {_link(attached)}" for attached in to_check]
        lines.append("")
    return "\n".join(lines)


def to_markdown_zip(notebook: Notebook, archive: IO[bytes]) -> None:
    """One Markdown file per category, numbered in the notebook's order, and
    the attached files beside them. Written into a file rather than returned:
    a season of videos does not fit in the memory of the club's laptop."""
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as files:
        files.writestr("A-LIRE.md", _read_me(notebook))
        for number, category in enumerate(notebook.categories, start=1):
            name = f"{number}-{slugify(category.title)}.md"
            files.writestr(name, _markdown_category(notebook, category))
        for attached in notebook.files():
            # Photos, videos and PDFs are compressed already: stored as they are.
            # Dated the day it was attached rather than zipfile's 1980.
            uploaded = timezone.localtime(attached.uploaded_at)
            info = zipfile.ZipInfo(attached.path, uploaded.timetuple()[:6])
            info.compress_type = zipfile.ZIP_STORED
            with (
                attached.content.open("rb") as source,
                files.open(info, "w", force_zip64=True) as target,
            ):
                shutil.copyfileobj(source, target)
