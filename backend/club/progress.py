"""Recording a progress: the one way an avancée is written, so that its rules
hold whichever screen or route writes it."""

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from club.models import Entry, EntryParticipant, User, WorkItem


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
    body: str,
    step: str | None = None,
    handover: str | None = None,
) -> None:
    """Its participants write it; mentors correct anyone's, since the student
    who wrote it badly may be gone for the season. Without a step or a
    handover, they stay as they were."""
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

    entry.body = body
    if step is not None:
        entry.step = step
    if handover is not None:
        entry.handover = handover
    entry.updated_by = user
    entry.updated_at = timezone.now()
    entry.save(update_fields=["body", "step", "handover", "updated_by", "updated_at"])
