"""Recording a progress: the one way an avancée is written, so that its rules
hold whichever screen or route writes it."""

from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Case, F, Q, TextField, Value, When
from django.db.models.functions import Concat
from django.utils import timezone

from club.models import Entry, EntryParticipant, User, WorkItem
from club.workdays import progress_of_the_day, workday


class ProgressChanged(Exception):
    """Not a ValidationError: nothing in the request is wrong, the progress
    moved under it, and the API answers 409 rather than 400."""


def check_step(work_item: WorkItem, step: str | None) -> None:
    if step is not None and not work_item.on_robot:
        raise ValidationError(
            "Un chantier hors robot n'a pas d'étape.", code="step_off_robot"
        )


@transaction.atomic
def record_progress(
    work_item: WorkItem,
    author: User,
    body: str,
    step: str | None = None,
    handover: str = "",
) -> Entry:
    """Without a step, a robot work item carries on where it was, and starts
    at brainstorming; a work item off the robot has no steps at all.

    A student who records a progress did it, and is signed up to it. A mentor
    may be writing up what the students forgot, which is not having been
    there: they join like anyone else if they took part."""
    check_step(work_item, step)
    if work_item.on_robot:
        step = step or work_item.current_step or Entry.Step.BRAINSTORMING

    # Working on a work item thought finished reopens it. The status is tested
    # by the database, not read then written, so two students reopening it at
    # the same moment cannot race.
    WorkItem.objects.filter(
        pk=work_item.pk, status__in=[WorkItem.Status.DONE, WorkItem.Status.DROPPED]
    ).update(status=WorkItem.Status.OPEN, closed_at=None)

    entry = Entry.objects.create(
        # Taken from the work item, so a progress cannot land in another team.
        team_season=work_item.team_season,
        author=author,
        work_item=work_item,
        type=Entry.Type.PROGRESS,
        body=body,
        step=step,
        handover=handover,
    )
    if author.club_role == User.ClubRole.STUDENT:
        join(entry, author)
    return entry


def join(entry: Entry, user: User) -> None:
    """Always for oneself: nobody signs anybody else up."""
    if entry.type != Entry.Type.PROGRESS:
        raise ValidationError(
            "On ne s'inscrit qu'à une avancée.", code="join_not_progress"
        )
    EntryParticipant.objects.create(entry=entry, user=user)


def edit_progress(
    entry: Entry,
    user: User,
    *,
    addition: str = "",
    step: str | None = None,
    handover: str | None = None,
    handover_was: str | None = None,
) -> None:
    """By its participants, and by mentors, who step in on any team. Its
    text is shared by all of them, so it is only added to, never replaced:
    nobody erases what someone else wrote. Without a step or a handover,
    they stay as they were.

    A handover change says what it started from (`handover_was`): if the
    handover holds something else by now, the save is refused rather than
    erasing it, and nothing of it is written."""
    work_item = entry.work_item
    # record_progress always sets the work item; the second test is for mypy.
    if entry.type != Entry.Type.PROGRESS or work_item is None:
        raise ValidationError(
            "Seule une avancée se modifie ici.", code="edit_not_progress"
        )
    is_mentor = user.club_role == User.ClubRole.MENTOR
    if not is_mentor and not entry.participants.filter(pk=user.pk).exists():
        raise ValidationError(
            "Seuls ses participants et les mentors modifient une avancée.",
            code="edit_not_participant",
        )
    check_step(work_item, step)
    addition = addition.strip()
    if not addition and step is None and handover is None:
        return

    # Tested and written by the database in one UPDATE, not read then
    # written: two additions at the same moment both land, and a handover
    # change only goes through over the handover it was written from.
    matches = Q(pk=entry.pk)
    changes: dict[str, Any] = {"updated_by": user, "updated_at": timezone.now()}
    if addition:
        changes["body"] = Case(
            When(body="", then=Value(addition)),
            default=Concat(F("body"), Value(f"\n\n{addition}")),
            output_field=TextField(),
        )
    if handover is not None:
        matches &= Q(handover=handover_was)
        changes["handover"] = handover
    if step is not None:
        changes["step"] = step
    saved = Entry.objects.filter(matches).update(**changes)
    entry.refresh_from_db()
    if not saved:
        raise ProgressChanged


@transaction.atomic
def leave_todays_progress(work_item: WorkItem, user: User) -> None:
    """Undoes a tick made by mistake, for oneself only: nobody signs anybody
    up, nobody signs anybody out. Past days are corrected, not left.

    The last one leaving takes the progress with them, text included — a
    progress nobody did is no trace. One still holding a file stays: the
    file is. Django looks for who is left before deleting, in two queries:
    with SQLite in IMMEDIATE mode (settings.py), the transaction holds the
    write lock across both, so a tick arriving meanwhile waits, then finds
    the progress gone and opens a new one, instead of being deleted with it."""
    entry = progress_of_the_day(work_item, workday(timezone.now()))
    if entry is None or not entry.participants.filter(pk=user.pk).exists():
        raise ValidationError(
            "Vous ne participez pas à l'avancée d'aujourd'hui sur ce chantier.",
            code="not_a_participant",
        )
    EntryParticipant.objects.filter(entry=entry, user=user).delete()
    Entry.objects.filter(
        pk=entry.pk, participants__isnull=True, attachments__isnull=True
    ).delete()
