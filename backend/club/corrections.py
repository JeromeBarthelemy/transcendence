"""Undoing a mistake in the notebook: who may remove a trace or a file, and
who may correct a text. The same predicates decide in the API and tell the
screens which buttons to show, so the rule is written once.

A student never removes a progress, even their own: they leave it
(`progress.leave_todays_progress`), since others may have done it with them.
Correcting is for mentors, who step in on any team: the text of a progress
is shared, and a student only adds to it.
"""

from django.utils import timezone

from club.models import Attachment, Entry, User


def _is_mentor(user: User) -> bool:
    return user.club_role == User.ClubRole.MENTOR


def can_remove(entry: Entry, user: User) -> bool:
    return _is_mentor(user) or (
        entry.type != Entry.Type.PROGRESS and entry.author_id == user.pk
    )


def can_remove_attachment(attachment: Attachment, user: User) -> bool:
    return _is_mentor(user) or attachment.uploaded_by_id == user.pk


def can_correct(entry: Entry, user: User) -> bool:
    return _is_mentor(user)


class EntryChanged(Exception):
    """The text moved since the correction started: refused, not erased."""


def correct(entry: Entry, user: User, *, body: str, body_was: str) -> None:
    """Tested by the database in the update itself, like a handover change:
    a student's addition made meanwhile refuses the correction."""
    changed = Entry.objects.filter(pk=entry.pk, body=body_was).update(
        body=body, updated_by=user, updated_at=timezone.now()
    )
    entry.refresh_from_db()
    if not changed:
        raise EntryChanged
