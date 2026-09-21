"""Recording a progress: the one way an avancée is written, so that its rules
hold whichever screen or route writes it."""

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from club.models import Entry, User, WorkItem


@transaction.atomic
def record_progress(
    work_item: WorkItem, author: User, body: str, step: str | None = None
) -> Entry:
    """Without a step, a robot work item carries on where it was, and starts
    at brainstorming; a work item off the robot has no steps at all."""
    if work_item.on_robot:
        step = step or work_item.current_step or Entry.Step.BRAINSTORMING
    elif step is not None:
        raise ValidationError(
            "Un chantier hors robot n'a pas d'étape.", code="step_off_robot"
        )

    if work_item.status == WorkItem.Status.SUGGESTED:
        work_item.status = WorkItem.Status.OPEN
        work_item.opened_at = timezone.now()
        work_item.save(update_fields=["status", "opened_at"])

    return Entry.objects.create(
        # Taken from the work item, so a progress cannot land in another team.
        team_season=work_item.team_season,
        author=author,
        work_item=work_item,
        type=Entry.Type.PROGRESS,
        body=body,
        step=step,
    )
