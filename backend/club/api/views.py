"""The club's HTTP surface. One instance serves one club, so there is no
tenant to resolve: every route below is about the person calling it."""

import tempfile
from itertools import islice
from typing import Any

from django.contrib.auth import login, logout
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError, QuerySet
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticatedOrReadOnly
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from club.analytics.activity import summarize_activity, to_csv, to_report_csv
from club.attachments import DOWNLOAD_ONLY
from club.corrections import (
    EntryChanged,
    can_correct,
    can_remove,
    can_remove_attachment,
    correct,
)
from club.export import gather, to_markdown_zip
from club.gdpr import request_deletion, send_export
from club.live import broadcast
from club.models import (
    Attachment,
    Document,
    Entry,
    Membership,
    Notification,
    Season,
    SourceUpdate,
    Team,
    TeamSeason,
    User,
    WorkItem,
    fold_title,
    remove_after_commit,
)
from club.notifications import record_change
from club.progress import (
    ProgressChanged,
    WorkItemClosed,
    check_open,
    edit_progress,
    join,
    leave_todays_progress,
    record_progress,
)
from club.rag import ask, glossary_for, serialize
from club.sources import (
    CheckOutcome,
    NoPassage,
    accept_update,
    add_source,
    check_all,
    latest_documents,
)
from club.workdays import (
    attendance,
    day_entries,
    gaps,
    month_activity,
    neighbours,
    progress_of_the_day,
    workday,
)

from .errors import Conflict
from .permissions import (
    IsClubAdmin,
    not_anonymized,
    not_self,
    not_staff_target,
    team_season_acted_on,
    team_seasons_open_to,
)
from .serializers import (
    ActivityAnalyticsSerializer,
    AddMembershipSerializer,
    AddSourceSerializer,
    AskSerializer,
    AttachmentSerializer,
    AvatarSerializer,
    CorrectionSerializer,
    CreateTeamSerializer,
    DaySerializer,
    DecisionSerializer,
    DeleteAccountSerializer,
    ExportSerializer,
    LoginSerializer,
    MonthSerializer,
    NoteSerializer,
    OpenWorkItemSerializer,
    PeriodSerializer,
    ReadNotificationsSerializer,
    RenameTeamSerializer,
    SignUpSerializer,
    TickSerializer,
    UserRoleSerializer,
    UserSearchSerializer,
    WorkItemStatusSerializer,
    WriteProgressSerializer,
)


@method_decorator(csrf_protect, name="dispatch")
class SignUpView(APIView):
    """The one route that has to be open: nobody has an account yet."""

    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = SignUpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        # The address is echoed because it may have been built rather than
        # given: whoever signs up must be told what they will type next time.
        return Response(
            {"email": user.email, "display_name": user.display_name},
            status=status.HTTP_201_CREATED,
        )


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    """Session and cookie, not a token: the front end is served from the same
    origin, behind the one proxy, so Django's own session machinery applies
    and nothing has to be stored in the browser.

    csrf_protect is spelled out because SessionAuthentication would not do it
    here: it only enforces CSRF once it has *found* a session, so an anonymous
    caller skips the check entirely — and this is the route that hands out a
    session. Without it a third-party page can log a member into an account
    that is not theirs, and everything they write next is readable by whoever
    set the trap."""

    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        # Rotates the session key, which is what makes session fixation fail.
        login(request, user)
        return Response(_identity(user))


class LogoutView(APIView):
    """Only a signed-in caller can sign out, so that a forged request cannot
    log somebody out of their session."""

    def post(self, request: Request) -> Response:
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class MeView(APIView):
    """What the front end needs to know before drawing anything — and, on the
    way, the CSRF token it will need to post anything.

    Asking who is signed in is open to anyone, and "nobody" is an answer
    (`null`), not a refusal: every page asks it on load, and a 403 would put
    a red line in every visitor's browser console. The cookie is set on that
    same call, which is precisely the one that has to arm the login form.
    Deleting one's account still requires being signed in."""

    permission_classes = [IsAuthenticatedOrReadOnly]

    def get(self, request: Request) -> Response | JsonResponse:
        if not isinstance(request.user, User):
            # DRF sends an empty body for None; the page expects JSON `null`.
            return JsonResponse(None, safe=False)
        return Response(_identity(request.user))

    def delete(self, request: Request) -> Response:
        """The right to erasure, for one's own account only — an admin
        manages everyone else's through `UserDetailView.delete` or the
        Django admin's own action. `password` confirms it: a session left
        open on a shared computer must not delete the account in one
        click."""
        user = request.user
        assert isinstance(user, User)
        serializer = DeleteAccountSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        sent_to = request_deletion(user, password=serializer.validated_data["password"])
        logout(request)
        return Response({"sent_to": sent_to})


class MemberDataExportView(APIView):
    """The right of access (docs/modules.md §10): a copy of one's own data,
    by e-mail — never shown on screen, since the confirmation is the point."""

    def post(self, request: Request) -> Response:
        user = request.user
        assert isinstance(user, User)
        return Response({"sent_to": send_export(user)}, status=status.HTTP_202_ACCEPTED)


def _identity(user: User) -> dict[str, object]:
    """Deliberately small: a session tells the interface what to draw, not
    what the account holds. Minority is absent on purpose — it says who may
    grant an image right, not whether one was granted, and that answer lives
    in the Consent log rather than on the account."""
    return {
        "display_name": user.display_name,
        "club_role": user.club_role,
        "is_club_admin": user.is_club_admin,
        "avatar": _avatar_url(user),
        "team_seasons": [
            {
                "id": team_season.id,
                "team": _team(team_season.team),
                "season": {
                    "start_year": team_season.season.start_year,
                    "game_name": team_season.season.game_name,
                },
            }
            for team_season in team_seasons_open_to(user)
        ],
    }


def _avatar_url(user: User) -> str | None:
    return f"/api/users/{user.pk}/avatar/" if user.avatar else None


def _member(user: User) -> dict[str, object]:
    """A member wherever a list of them is shown: a face next to the name."""
    return {"display_name": user.display_name, "avatar": _avatar_url(user)}


class AvatarView(APIView):
    """One's own photo, and no one else's: the route names no member, so
    there is nobody else's to reach."""

    def put(self, request: Request) -> Response:
        assert isinstance(request.user, User)
        serializer = AvatarSerializer(request.user, data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(_identity(serializer.save()))

    def delete(self, request: Request) -> Response:
        user = request.user
        assert isinstance(user, User)
        previous = user.avatar.name
        user.avatar.name = ""
        user.save(update_fields=["avatar"])
        remove_after_commit(user, previous)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MemberAvatarView(APIView):
    """Served through a view rather than from a media URL, so that only a
    signed-in member ever sees a face."""

    def get(self, request: Request, pk: int) -> FileResponse:
        user = get_object_or_404(User, pk=pk)
        if not user.avatar:
            raise Http404
        response = FileResponse(user.avatar.open("rb"), content_type="image/webp")
        # The address stays the same when the photo changes: the browser asks
        # again each time instead of showing the old face, and no proxy on
        # the way keeps a copy.
        response["Cache-Control"] = "private, no-cache"
        return response


def _user(user: User) -> dict[str, object]:
    return {
        "id": user.id,
        "display_name": user.display_name,
        "email": user.email,
        "club_role": user.club_role,
        "is_club_admin": user.is_club_admin,
        "is_active": user.is_active,
        "is_anonymized": user.is_anonymized,
        "avatar": _avatar_url(user),
    }


class UserListView(APIView):
    """Every account, active or not: an admin managing roles has to see who
    left as well as who is here, or a name would just vanish from the list
    with no explanation.

    With `search`, it is the team screen's typeahead instead: active accounts
    only, whose display name contains what was typed, ignoring case and
    accents so « elo » finds Élodie. Not on display_name_folded: that column
    keeps accents because it decides which names are duplicates, and a club's
    worth of active accounts is few enough to fold here. With `team_season` as
    well, those already on that team are left out before the cap, or a page of
    them could hide the matches still to add."""

    permission_classes = [IsClubAdmin]
    SEARCH_LIMIT = 10

    def get(self, request: Request) -> Response:
        query = UserSearchSerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        if "search" not in query.validated_data:
            users = User.objects.order_by("display_name")
            return Response([_user(user) for user in users])
        search = fold_title(query.validated_data["search"])
        if not search:
            return Response([])
        candidates = User.objects.filter(is_active=True)
        team_season = query.validated_data.get("team_season")
        if team_season is not None:
            candidates = candidates.exclude(memberships__team_season=team_season)
        matches = (
            user for user in candidates if search in fold_title(user.display_name)
        )
        return Response([_user(user) for user in islice(matches, self.SEARCH_LIMIT)])


class UserDetailView(APIView):
    permission_classes = [IsClubAdmin]

    def get(self, request: Request, pk: int) -> Response:
        return Response(_user(get_object_or_404(User, pk=pk)))

    @transaction.atomic
    def patch(self, request: Request, pk: int) -> Response:
        # The read has to be inside the same transaction as the write, not
        # just before it: two overlapping PATCHes each validating a
        # different field against their own stale read can each pass —
        # "club_role": "student" against an instance still showing
        # is_club_admin=False, "is_club_admin": true against one still
        # showing club_role=mentor — and together leave a row neither
        # request alone would have written. `transaction_mode: "IMMEDIATE"`
        # (config/settings.py) takes SQLite's write lock the moment this
        # transaction opens, so a genuinely concurrent second request
        # blocks here until this one commits, and then reads the row this
        # one actually left — not select_for_update(), which SQLite
        # silently ignores (see club/gdpr.py, `request_deletion`).
        user = get_object_or_404(User, pk=pk)
        not_self(request, user)
        not_staff_target(request, user)
        not_anonymized(user)
        serializer = UserRoleSerializer(user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        return Response(_user(serializer.save()))

    def delete(self, request: Request, pk: int) -> Response:
        # A member never disappears — their traces stay attributed
        # (club/models.py, `User`) — so "delete" here is the same
        # anonymization the Django admin's own action and a member's own
        # request both call (club/gdpr.py, `anonymize`), never a
        # suspension: that one is temporary and stays on `PATCH
        # {"is_active": …}`. `not_the_last_admin` is `request_deletion`'s
        # own guard, checked inside its transaction; `not_self` and
        # `not_staff_target` are this surface's own, since neither
        # self-service deletion nor a staff sign-in needs them.
        user = get_object_or_404(User, pk=pk)
        not_self(request, user)
        not_staff_target(request, user)
        not_anonymized(user)
        request_deletion(user, password=None)
        return Response(status=status.HTTP_204_NO_CONTENT)


def _team(team: Team) -> dict[str, object]:
    return {"id": team.id, "number": team.number, "name": team.name}


def _managed_team(team_season: TeamSeason) -> dict[str, object]:
    """A team as the management screen shows it: its roster this season, each
    member with the membership that removes them."""
    memberships = sorted(
        team_season.memberships.all(),
        key=lambda membership: membership.user.display_name_folded,
    )
    return {
        **_team(team_season.team),
        "team_season": team_season.id,
        "members": [
            {
                "membership": membership.id,
                "user": membership.user_id,
                **_member(membership.user),
            }
            for membership in memberships
        ],
    }


class TeamListView(APIView):
    permission_classes = [IsClubAdmin]

    def get(self, request: Request) -> Response:
        """The current season's teams — the newest one, which is the one a
        roster is drawn up for. An earlier season's roster is history, left
        to the Django admin rather than offered for editing here."""
        season = Season.objects.first()
        if season is None:
            return Response({"season": None, "teams": []})
        team_seasons = (
            season.team_seasons.select_related("team")
            .prefetch_related("memberships__user")
            .order_by("team__number")
        )
        return Response(
            {
                "season": {
                    "start_year": season.start_year,
                    "game_name": season.game_name,
                },
                "teams": [_managed_team(team_season) for team_season in team_seasons],
            }
        )

    def post(self, request: Request) -> Response:
        serializer = CreateTeamSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        team = serializer.save()
        return Response(_team(team), status=status.HTTP_201_CREATED)


class TeamDetailView(APIView):
    permission_classes = [IsClubAdmin]

    def patch(self, request: Request, pk: int) -> Response:
        team = get_object_or_404(Team, pk=pk)
        serializer = RenameTeamSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        team.name = serializer.validated_data["name"]
        team.save(update_fields=["name"])
        return Response(_team(team))

    def delete(self, request: Request, pk: int) -> Response:
        team = get_object_or_404(Team, pk=pk)
        # `TeamSeason.team` is PROTECT (club/models.py): deleting a team with
        # more than the one season just opened for it must not silently wipe
        # that history away by cascading it first.
        if team.team_seasons.count() > 1:
            raise Conflict(
                "Cette équipe a un historique de plusieurs saisons : "
                "elle ne peut pas être supprimée.",
                code="team_has_history",
            )
        # A second, independent guard: even a single team_season can carry a
        # real roster today (Membership.team_season is CASCADE), and cascading
        # it away with the team would delete that roster with no trace beyond
        # a 204. Refusing while members remain makes the admin remove them
        # first — a deliberate act, same spirit as PROTECT elsewhere.
        if Membership.objects.filter(team_season__team=team).exists():
            raise Conflict(
                "Cette équipe a encore des membres affectés : "
                "retirez-les avant de la supprimer.",
                code="team_has_members",
            )
        try:
            with transaction.atomic():
                team.team_seasons.all().delete()
                team.delete()
        except ProtectedError as blocked:
            # Work items and entries are the only PROTECT links to a team
            # season, so this is the cause; a new one must change the message.
            raise Conflict(
                "Cette équipe a déjà des chantiers ou des traces : elle fait "
                "partie de l'histoire du club et ne peut pas être supprimée.",
                code="team_has_work",
            ) from blocked
        return Response(status=status.HTTP_204_NO_CONTENT)


class MembershipCreateView(APIView):
    permission_classes = [IsClubAdmin]

    def post(self, request: Request) -> Response:
        serializer = AddMembershipSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        membership: Membership = serializer.save()
        return Response(
            {
                "id": membership.id,
                "user": membership.user_id,
                "team_season": membership.team_season_id,
            },
            status=status.HTTP_201_CREATED,
        )


class MembershipDetailView(APIView):
    permission_classes = [IsClubAdmin]

    def delete(self, request: Request, pk: int) -> Response:
        membership = get_object_or_404(Membership, pk=pk)
        membership.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _work_item(item: WorkItem) -> dict[str, object]:
    latest = (
        item.entries.filter(type=Entry.Type.PROGRESS)
        .order_by("-occurred_at", "-id")
        .first()
    )
    handover = item.last_handover
    return {
        "id": item.id,
        "team_season": item.team_season_id,
        "title": item.title,
        "on_robot": item.on_robot,
        "status": item.status,
        "opened_at": item.opened_at,
        "closed_at": item.closed_at,
        # The latest progress already carries it: read once, not twice.
        "current_step": latest.step if latest else None,
        "handover": {
            "body": handover.handover,
            "author": handover.author.display_name,
            "step": handover.step,
            "occurred_at": handover.occurred_at,
            "day": workday(handover.occurred_at),
        }
        if handover
        else None,
        "last_progress": {
            "occurred_at": latest.occurred_at,
            "day": workday(latest.occurred_at),
            "participants": [_member(user) for user in latest.participants.all()],
        }
        if latest
        else None,
    }


class WorkItemListView(APIView):
    def get(self, request: Request, team_season_id: int) -> Response:
        assert isinstance(request.user, User)
        team_season = team_season_acted_on(request.user, team_season_id)
        return Response([_work_item(item) for item in team_season.work_items.all()])

    @transaction.atomic
    def post(self, request: Request, team_season_id: int) -> Response:
        assert isinstance(request.user, User)
        team_season = team_season_acted_on(request.user, team_season_id)
        serializer = OpenWorkItemSerializer(
            data=request.data, context={"team_season": team_season}
        )
        serializer.is_valid(raise_exception=True)
        item = serializer.save()
        record_change(
            request.user,
            Notification.Verb.WORK_ITEM_OPENED,
            team_season=team_season,
            work_item=item,
        )
        return Response(_work_item(item), status=status.HTTP_201_CREATED)


def _entry(entry: Entry, reader: User) -> dict[str, object]:
    """`reader` is who asks: the rights it carries are theirs, from the same
    rules the API applies (club/corrections.py)."""
    return {
        "id": entry.id,
        "work_item": {"id": entry.work_item.id, "title": entry.work_item.title}
        if entry.work_item
        else None,
        "type": entry.type,
        "body": entry.body,
        "step": entry.step,
        "handover": entry.handover,
        "occurred_at": entry.occurred_at,
        "author": entry.author.display_name,
        "participants": [_member(user) for user in entry.participants.all()],
        "attachments": [_attachment(file, reader) for file in entry.attachments.all()],
        "can_remove": can_remove(entry, reader),
        "can_correct": can_correct(entry, reader),
    }


def _attachment(attachment: Attachment, reader: User) -> dict[str, object]:
    return {
        "id": attachment.id,
        "name": attachment.name,
        "content_type": attachment.content_type,
        "url": f"/api/attachments/{attachment.id}/",
        "people_recognisable": attachment.people_recognisable,
        "uploaded_by": attachment.uploaded_by.display_name,
        "can_remove": can_remove_attachment(attachment, reader),
    }


def _work_item_acted_on(user: User, work_item_id: int) -> WorkItem:
    item = get_object_or_404(WorkItem, pk=work_item_id)
    team_season_acted_on(user, item.team_season_id)
    return item


class WorkItemDetailView(APIView):
    def get(self, request: Request, pk: int) -> Response:
        assert isinstance(request.user, User)
        item = _work_item_acted_on(request.user, pk)
        thread = (
            item.entries.select_related("author", "work_item")
            .prefetch_related("participants", "attachments__uploaded_by")
            .order_by("-occurred_at", "-id")
        )
        current_progress = progress_of_the_day(item, workday(timezone.now()))
        return Response(
            {
                **_work_item(item),
                "current_progress": _entry(current_progress, request.user)
                if current_progress
                else None,
                "current_user_participates": bool(
                    current_progress
                    and current_progress.participants.filter(
                        pk=request.user.pk
                    ).exists()
                ),
                "thread": [_entry(entry, request.user) for entry in thread],
            }
        )

    @transaction.atomic
    def patch(self, request: Request, pk: int) -> Response:
        assert isinstance(request.user, User)
        item = _work_item_acted_on(request.user, pk)
        # Only a reopening changes a closed work item; said before the reason
        # is asked for, which would only lead to this refusal, and checked
        # again right before writing, as every other write path does.
        asked = request.data.get("status") if isinstance(request.data, dict) else None
        if asked != WorkItem.Status.OPEN:
            _open_for_work(item)
        serializer = WorkItemStatusSerializer(
            item, data=request.data, context={"author": request.user}
        )
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data["status"] != WorkItem.Status.OPEN:
            _open_for_work(item)
        serializer.save()
        record_change(
            request.user,
            {
                WorkItem.Status.OPEN: Notification.Verb.WORK_ITEM_REOPENED,
                WorkItem.Status.DONE: Notification.Verb.WORK_ITEM_DONE,
                WorkItem.Status.DROPPED: Notification.Verb.WORK_ITEM_DROPPED,
            }[WorkItem.Status(item.status)],
            team_season=item.team_season,
            work_item=item,
        )
        return Response(_work_item(item))

    def delete(self, request: Request, pk: int) -> Response:
        """Only a work item opened by mistake: one with any trace is dropped
        instead, and `Entry.work_item` being PROTECT makes the database the
        judge, even for a progress ticked in the same instant."""
        assert isinstance(request.user, User)
        item = _work_item_acted_on(request.user, pk)
        try:
            # Told while the work item still exists; a refused deletion
            # takes its notices back with it.
            with transaction.atomic():
                record_change(
                    request.user,
                    Notification.Verb.WORK_ITEM_DELETED,
                    team_season=item.team_season,
                    work_item=item,
                )
                item.delete()
        except ProtectedError:
            raise Conflict(
                "Ce chantier a déjà des traces : abandonnez-le plutôt.",
                code="work_item_has_traces",
            ) from None
        return Response(status=status.HTTP_204_NO_CONTENT)


def _open_for_work(item: WorkItem | None) -> None:
    """Called inside the transaction that writes: see `check_open`."""
    try:
        check_open(item)
    except WorkItemClosed as closed:
        raise _work_item_closed() from closed


def _work_item_closed() -> Conflict:
    return Conflict(
        "Ce chantier est fermé : rouvrez-le pour le reprendre.",
        code="work_item_closed",
    )


class TickView(APIView):
    """Ticking a work item is signing up to today's progress on it, which the
    first to tick creates. Ticking at another step than today's opens a
    second progress: the day moved from one step to the next."""

    # With SQLite in IMMEDIATE mode (settings.py), the transaction takes the
    # write lock before looking for today's progress: two students ticking in
    # the same second are served one after the other, and the second joins
    # the progress the first created instead of creating another.
    @transaction.atomic
    def post(self, request: Request, pk: int) -> Response:
        user = request.user
        assert isinstance(user, User)
        item = _work_item_acted_on(user, pk)
        _open_for_work(item)
        serializer = TickSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        step = serializer.validated_data.get("step")

        entry = progress_of_the_day(item, workday(timezone.now()))
        created = entry is None or (step is not None and step != entry.step)
        if created:
            entry = record_progress(item, user, "", step=step)
        assert entry is not None
        joined = not entry.participants.filter(pk=user.pk).exists()
        if joined:
            join(entry, user)
        # Joining tells nobody, only the open screens: ten students ticking at
        # the start of a session would bury the notices that matter. A tick
        # made twice changes nothing at all.
        if created:
            record_change(
                user,
                Notification.Verb.ENTRY_ADDED,
                team_season=item.team_season,
                work_item=item,
                entry=entry,
            )
        elif joined:
            broadcast(item.team_season_id, item.id)
        return Response(
            _entry(entry, user),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    @transaction.atomic
    def delete(self, request: Request, pk: int) -> Response:
        """Leaving today's progress, ticked by mistake: see
        `leave_todays_progress`."""
        user = request.user
        assert isinstance(user, User)
        item = _work_item_acted_on(user, pk)
        emptied = leave_todays_progress(item, user)
        if emptied is None:
            # Like joining: the open screens only.
            broadcast(item.team_season_id, item.id)
        else:
            record_change(
                user,
                Notification.Verb.ENTRY_REMOVED,
                team_season=item.team_season,
                work_item=item,
                entry=emptied,
            )
            emptied.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class EntryAttachmentsView(APIView):
    """Anyone on the team adds to any of its entries: an outing's photos come
    from everyone who was there, not from whoever wrote it up."""

    @transaction.atomic
    def post(self, request: Request, pk: int) -> Response:
        user = request.user
        assert isinstance(user, User)
        entry = get_object_or_404(Entry, pk=pk)
        team_season_acted_on(user, entry.team_season_id)
        _open_for_work(entry.work_item)
        serializer = AttachmentSerializer(
            data=request.data, context={"entry": entry, "user": user}
        )
        serializer.is_valid(raise_exception=True)
        # Told first: notices that fail roll back before the file is written,
        # which a rollback would leave on disk.
        record_change(
            user,
            Notification.Verb.ENTRY_UPDATED,
            team_season=entry.team_season,
            work_item=entry.work_item,
            entry=entry,
        )
        attachment = serializer.save()
        return Response(_attachment(attachment, user), status=status.HTTP_201_CREATED)


class AttachmentView(APIView):
    """Served through a view rather than from a media URL, so that only the
    team and its mentors ever reach a file."""

    def get(self, request: Request, pk: int) -> FileResponse:
        attachment = self._acted_on(request, pk)
        return FileResponse(
            attachment.file.open("rb"),
            content_type=attachment.content_type,
            as_attachment=attachment.content_type == DOWNLOAD_ONLY,
            filename=attachment.name,
        )

    @transaction.atomic
    def delete(self, request: Request, pk: int) -> Response:
        attachment = self._acted_on(request, pk)
        user = request.user
        assert isinstance(user, User)
        if not can_remove_attachment(attachment, user):
            raise PermissionDenied(
                "Seuls la personne qui l'a déposé et les mentors retirent un fichier.",
                code="delete_not_uploader",
            )
        attachment.delete()
        entry = attachment.entry
        record_change(
            user,
            Notification.Verb.ENTRY_UPDATED,
            team_season=entry.team_season,
            work_item=entry.work_item,
            entry=entry,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _acted_on(self, request: Request, pk: int) -> Attachment:
        assert isinstance(request.user, User)
        attachment = get_object_or_404(
            Attachment.objects.select_related("entry"), pk=pk
        )
        team_season_acted_on(request.user, attachment.entry.team_season_id)
        return attachment


class EntryDetailView(APIView):
    @transaction.atomic
    def patch(self, request: Request, pk: int) -> Response:
        user = request.user
        assert isinstance(user, User)
        entry = get_object_or_404(Entry, pk=pk)
        team_season_acted_on(user, entry.team_season_id)
        if "body" in request.data:
            if can_correct(entry, user):
                return self._correct(request, entry, user)
            # A progress is added to, and its serializer says so; a note or a
            # decision has nothing to add to.
            if entry.type != Entry.Type.PROGRESS:
                raise PermissionDenied(
                    "Seuls les mentors corrigent une trace.",
                    code="correct_not_allowed",
                )
        serializer = WriteProgressSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            edit_progress(
                entry,
                user,
                addition=data.get("addition", ""),
                step=data.get("step"),
                handover=data.get("handover"),
                handover_was=data.get("handover_was"),
            )
        except ProgressChanged as changed:
            raise Conflict(
                "Cette avancée a été modifiée pendant que vous écriviez.",
                code="progress_changed",
            ) from changed
        except WorkItemClosed as closed:
            raise _work_item_closed() from closed
        record_change(
            user,
            Notification.Verb.ENTRY_UPDATED,
            team_season=entry.team_season,
            work_item=entry.work_item,
            entry=entry,
        )
        return Response(_entry(entry, user))

    def _correct(self, request: Request, entry: Entry, user: User) -> Response:
        serializer = CorrectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            correct(entry, user, **serializer.validated_data)
        except EntryChanged as changed:
            raise Conflict(
                "Ce texte a été modifié pendant que vous le corrigiez.",
                code="entry_changed",
            ) from changed
        record_change(
            user,
            Notification.Verb.ENTRY_UPDATED,
            team_season=entry.team_season,
            work_item=entry.work_item,
            entry=entry,
        )
        return Response(_entry(entry, user))

    def delete(self, request: Request, pk: int) -> Response:
        user = request.user
        assert isinstance(user, User)
        entry = get_object_or_404(Entry, pk=pk)
        team_season_acted_on(user, entry.team_season_id)
        if not can_remove(entry, user):
            raise PermissionDenied(
                "Seuls son auteur et les mentors retirent cette trace ; "
                "d'une avancée, on se retire.",
                code="remove_not_allowed",
            )
        # Told while the trace still exists, so its followers are still found.
        with transaction.atomic():
            record_change(
                user,
                Notification.Verb.ENTRY_REMOVED,
                team_season=entry.team_season,
                work_item=entry.work_item,
                entry=entry,
            )
            entry.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class NoteCreateView(APIView):
    """A note sent twice with the same `client_id` (an offline save replayed
    after reconnection) is stored once: the second answer is the first note,
    with 200 rather than 201."""

    @transaction.atomic
    def post(self, request: Request, team_season_id: int) -> Response:
        user = request.user
        assert isinstance(user, User)
        team_season = team_season_acted_on(user, team_season_id)
        serializer = NoteSerializer(
            data=request.data, context={"team_season": team_season, "author": user}
        )
        serializer.is_valid(raise_exception=True)
        client_id = serializer.validated_data.get("client_id")
        work_item = serializer.validated_data.get("work_item")
        if client_id is None:
            # Nothing to replay, so none of the collision handling below
            # applies: a failure here is a real error, not a sign this
            # request was already answered once.
            _open_for_work(work_item)
            entry = serializer.save()
        else:
            existing = Entry.objects.filter(author=user, client_id=client_id).first()
            if existing is not None:
                return _replayed_note(existing, team_season, user)
            _open_for_work(work_item)
            try:
                with transaction.atomic():
                    entry = serializer.save()
            except IntegrityError:
                existing = Entry.objects.get(author=user, client_id=client_id)
                return _replayed_note(existing, team_season, user)
        record_change(
            user,
            Notification.Verb.ENTRY_ADDED,
            team_season=team_season,
            work_item=entry.work_item,
            entry=entry,
        )
        return Response(_entry(entry, user), status=status.HTTP_201_CREATED)


def _replayed_note(existing: Entry, team_season: TeamSeason, reader: User) -> Response:
    if existing.team_season_id != team_season.id:
        raise Conflict(
            "Cet identifiant appartient déjà à une remarque d'une autre équipe.",
            code="client_id_taken",
        )
    return Response(_entry(existing, reader), status=status.HTTP_200_OK)


class DecisionCreateView(APIView):
    @transaction.atomic
    def post(self, request: Request, team_season_id: int) -> Response:
        user = request.user
        assert isinstance(user, User)
        team_season = team_season_acted_on(user, team_season_id)
        serializer = DecisionSerializer(
            data=request.data, context={"team_season": team_season, "author": user}
        )
        serializer.is_valid(raise_exception=True)
        _open_for_work(serializer.validated_data.get("work_item"))
        entry = serializer.save()
        record_change(
            user,
            Notification.Verb.ENTRY_ADDED,
            team_season=team_season,
            work_item=entry.work_item,
            entry=entry,
        )
        return Response(_entry(entry, user), status=status.HTTP_201_CREATED)


def _notification(notice: Notification) -> dict[str, object]:
    """What the header shows of one change. The work item's title and the
    trace's type are the copies kept on the notice, so a deleted one is
    still named."""
    return {
        "id": notice.id,
        "verb": notice.verb,
        "actor": _member(notice.actor),
        "team_season": notice.team_season_id,
        "work_item": {"id": notice.work_item_id, "title": notice.work_item_title}
        if notice.work_item_title
        else None,
        "entry": {"id": notice.entry_id, "type": notice.entry_type}
        if notice.entry_type
        else None,
        "created_at": notice.created_at,
        "read": notice.read_at is not None,
    }


def _notifications_open_to(user: User) -> QuerySet[Notification]:
    """A notification leads to its team: once the member may no longer open
    it, it leaves their list and their unread count."""
    return user.notifications.filter(team_season__in=team_seasons_open_to(user))


class NotificationListView(APIView):
    """The member's own, newest first: the unread count and the latest few,
    for the header (#151)."""

    LATEST = 20

    def get(self, request: Request) -> Response:
        user = request.user
        assert isinstance(user, User)
        mine = _notifications_open_to(user).select_related("actor")
        return Response(
            {
                "unread": mine.filter(read_at=None).count(),
                "items": [_notification(notice) for notice in mine[: self.LATEST]],
            }
        )


class NotificationReadView(APIView):
    """Marks the member's own as read — all, or those named by `ids`; another
    member's id is ignored, not refused, since it reveals nothing either way."""

    def post(self, request: Request) -> Response:
        user = request.user
        assert isinstance(user, User)
        serializer = ReadNotificationsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        unread = _notifications_open_to(user).filter(read_at=None)
        ids = serializer.validated_data.get("ids")
        (unread if ids is None else unread.filter(pk__in=ids)).update(
            read_at=timezone.now()
        )
        return Response({"unread": unread.count()})


class ActivityCalendarView(APIView):
    def get(self, request: Request, team_season_id: int) -> Response:
        user = request.user
        assert isinstance(user, User)
        team_season = team_season_acted_on(user, team_season_id)
        serializer = MonthSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        month = serializer.validated_data["month"]
        return Response(
            {
                "month": f"{month.year:04d}-{month.month:02d}",
                "today": workday(timezone.now()),
                "days": month_activity(team_season, month),
            }
        )


class DayView(APIView):
    def get(self, request: Request, team_season_id: int, day: str) -> Response:
        user = request.user
        assert isinstance(user, User)
        team_season = team_season_acted_on(user, team_season_id)
        if day == "today":
            the_day = workday(timezone.now())
        else:
            serializer = DaySerializer(data={"day": day})
            serializer.is_valid(raise_exception=True)
            the_day = serializer.validated_data["day"]
        entries = list(
            day_entries(team_season, the_day).select_related("author", "work_item")
        )
        roster = team_season.memberships.roster()
        previous, following = neighbours(team_season, the_day)
        return Response(
            {
                "day": the_day,
                "previous": previous,
                "next": following,
                "entries": [_entry(entry, user) for entry in entries],
                "advanced_work_items": len(
                    {
                        entry.work_item_id
                        for entry in entries
                        if entry.type == Entry.Type.PROGRESS
                        and entry.work_item_id is not None
                    }
                ),
                "present": [_member(user) for user in attendance(team_season, the_day)],
                "roster": roster.count(),
            }
        )


class GapsView(APIView):
    def get(self, request: Request, team_season_id: int) -> Response:
        user = request.user
        assert isinstance(user, User)
        team_season = team_season_acted_on(user, team_season_id)
        serializer = PeriodSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        period = serializer.validated_data
        return Response(gaps(team_season, period["since"], period["until"]))


class ActivityAnalyticsView(APIView):
    """Period analytics as JSON, daily CSV or a complete CSV report."""

    def get(self, request: Request, team_season_id: int) -> Response | HttpResponse:
        user = request.user
        assert isinstance(user, User)
        team_season = team_season_acted_on(user, team_season_id)
        # A missing query filter is not an unchecked HTML checkbox (False).
        serializer = ActivityAnalyticsSerializer(data=request.query_params.dict())
        serializer.is_valid(raise_exception=True)
        period = serializer.validated_data
        on_robot = period.get("on_robot")
        data = summarize_activity(
            team_season, period["since"], period["until"], on_robot=on_robot
        )
        if period["format"] == "csv":
            full_report = period["report"] == "full"
            response = HttpResponse(
                to_report_csv(data, on_robot)
                if full_report
                else to_csv(data["activity_by_day"]),
                content_type="text/csv; charset=utf-8",
            )
            suffix = "" if on_robot is None else "-robot" if on_robot else "-hors-robot"
            if full_report:
                suffix += "-complet"
            name = (
                f"activite-{team_season.team.number}-"
                f"{period['since']}-{period['until']}{suffix}.csv"
            )
            response["Content-Disposition"] = f'attachment; filename="{name}"'
            return response
        return Response(data)


class ExportView(APIView):
    def get(self, request: Request, team_season_id: int) -> FileResponse:
        user = request.user
        assert isinstance(user, User)
        team_season = team_season_acted_on(user, team_season_id)
        serializer = ExportSerializer(
            data=request.query_params, context={"team_season": team_season}
        )
        serializer.is_valid(raise_exception=True)
        query = serializer.validated_data
        notebook = gather(team_season, query.get("category"), query.get("work_item"))
        name = f"cahier-{team_season.team.number}-{team_season.season.start_year}.zip"
        # No `with`: the response closes it once sent, and the system then
        # removes it.
        archive = tempfile.TemporaryFile()  # noqa: SIM115
        to_markdown_zip(notebook, archive)
        archive.seek(0)
        return FileResponse(
            archive, as_attachment=True, filename=name, content_type="application/zip"
        )


class RuleQuestionView(APIView):
    """Ask the rulebook RAG a question, against the current season's
    ingested documents."""

    def post(self, request: Request) -> Response:
        user = request.user
        assert isinstance(user, User)
        serializer = AskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        season = Season.objects.first()
        if season is None:
            raise DjangoValidationError(
                "Aucune saison n'est ouverte.", code="no_season"
            )
        query = ask(serializer.validated_data["question"], season, user)
        return Response(serialize(query), status=status.HTTP_201_CREATED)


class RuleGlossaryView(APIView):
    """The current season's glossary (#136): the manual's own last
    chapter, read into terms at ingestion so a student can find their
    question's word without already knowing the manual's own one for
    it. Quietly empty without a season to read it from — the ask route
    is where that absence is actually an error worth stopping someone
    over."""

    def get(self, request: Request) -> Response:
        season = Season.objects.first()
        terms = glossary_for(season) if season else []
        return Response(
            [{"term": term.term, "definition": term.definition} for term in terms]
        )


def _rule_sources(checks: list[CheckOutcome] | None = None) -> list[dict[str, Any]]:
    season = Season.objects.first()
    if season is None:
        return []
    current = {
        document.source: document
        for document in reversed(
            list(Document.objects.filter(season=season).order_by("-fetched_at", "-id"))
        )
    }
    pending = {
        update.source: update for update in SourceUpdate.objects.filter(season=season)
    }
    outcome_of = {outcome.document.source: outcome for outcome in checks or []}
    rows: list[dict[str, Any]] = []
    for source in Document.Source:
        document = current.get(source.value)
        update = pending.get(source.value)
        outcome = outcome_of.get(source.value)
        rows.append(
            {
                "source": source.value,
                "title": document.title if document else None,
                "url": document.url if document else "",
                "fetched_at": document.fetched_at if document else None,
                "checked_at": document.checked_at if document else None,
                "pending": (
                    {"detected_at": update.detected_at, "summary": update.summary}
                    if update
                    else None
                ),
                # Only on the answer to a check just run: a failed check must not
                # look like the previous state, which is all the rows would show.
                "check": (
                    {"status": outcome.status, "detail": outcome.detail}
                    if outcome
                    else None
                ),
            }
        )
    return rows


class RuleSourcesView(APIView):
    """What an administrator sees about the rulebook's sources: the copy the
    RAG searches, when it was last checked, and the change waiting for them.
    Posting a URL adds a copy from FIRST's own page, and the checks follow it."""

    permission_classes = [IsClubAdmin]

    def get(self, request: Request) -> Response:
        return Response(_rule_sources())

    def post(self, request: Request) -> Response:
        serializer = AddSourceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        season = Season.objects.first()
        if season is None:
            raise DjangoValidationError(
                "Aucune saison n'est ouverte.", code="no_season"
            )
        try:
            add_source(
                season=season,
                source=serializer.validated_data["source"],
                url=serializer.validated_data["url"],
            )
        except NoPassage as error:
            raise DjangoValidationError(
                "La page ne contient aucun passage à indexer.", code="no_passage"
            ) from error
        except (OSError, ValueError) as error:
            raise DjangoValidationError(
                "La page n'a pas pu être récupérée.", code="fetch_failed"
            ) from error
        return Response(_rule_sources(), status=status.HTTP_201_CREATED)


class RuleSourcesCheckView(APIView):
    permission_classes = [IsClubAdmin]

    def post(self, request: Request) -> Response:
        return Response(_rule_sources(check_all(latest_documents())))


class RuleSourceAcceptView(APIView):
    """Replaces the searched copy with the fetched one, once an administrator
    has read what changed. Nothing is replaced before this."""

    permission_classes = [IsClubAdmin]

    def post(self, request: Request, source: str) -> Response:
        season = Season.objects.first()
        update = (
            SourceUpdate.objects.filter(season=season, source=source).first()
            if season
            else None
        )
        if update is None:
            raise Http404("Aucune mise à jour en attente pour cette source.")
        accept_update(update)
        return Response(_rule_sources())
