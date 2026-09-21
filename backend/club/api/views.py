"""The club's HTTP surface. One instance serves one club, so there is no
tenant to resolve: every route below is about the person calling it."""

from django.contrib.auth import login, logout
from django.db import transaction
from django.db.models import ProtectedError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from club.models import Entry, Membership, Team, User, WorkItem
from club.progress import edit_progress, join, record_progress
from club.workdays import attendance, day_entries, gaps, progress_of_the_day, workday

from .errors import Conflict
from .permissions import IsClubAdmin, team_season_acted_on
from .serializers import (
    AddMembershipSerializer,
    CloseWorkItemSerializer,
    CreateTeamSerializer,
    DaySerializer,
    LoginSerializer,
    NoteSerializer,
    OpenWorkItemSerializer,
    PeriodSerializer,
    RenameTeamSerializer,
    SignUpSerializer,
    TickSerializer,
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

    The decorator sits on dispatch, not on get, so the cookie is set even when
    the answer is 403: the page calls this before anyone is signed in, and that
    call is precisely the one that has to arm the login form."""

    def get(self, request: Request) -> Response:
        # This route does not declare a permission, so it inherits the
        # project's fail-closed default and DRF has already refused an
        # anonymous caller. The assertion states that invariant rather than
        # casting it away: if the default ever opens, this fails loudly here
        # instead of an AttributeError deeper down.
        assert isinstance(request.user, User)
        return Response(_identity(request.user))


def _identity(user: User) -> dict[str, object]:
    """Deliberately small: a session tells the interface what to draw, not
    what the account holds. Minority is absent on purpose — it says who may
    grant an image right, not whether one was granted, and that answer lives
    in the Consent log rather than on the account."""
    return {
        "display_name": user.display_name,
        "club_role": user.club_role,
        "is_club_admin": user.is_club_admin,
    }


def _team(team: Team) -> dict[str, object]:
    return {"id": team.id, "number": team.number, "name": team.name}


class TeamCreateView(APIView):
    """No `GET` here yet — nothing drives it in #50, and it belongs to
    whichever screen first needs a team list (#51)."""

    permission_classes = [IsClubAdmin]

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
            # Backstop for whatever the count() check above does not yet
            # know to look for.
            raise Conflict(code="team_has_history") from blocked
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
        "title": item.title,
        "on_robot": item.on_robot,
        "status": item.status,
        # The latest progress already carries it: read once, not twice.
        "current_step": latest.step if latest else None,
        "handover": {
            "body": handover.handover,
            "author": handover.author.display_name,
            "step": handover.step,
            "occurred_at": handover.occurred_at,
        }
        if handover
        else None,
        "last_progress": {
            "occurred_at": latest.occurred_at,
            "participants": [user.display_name for user in latest.participants.all()],
        }
        if latest
        else None,
    }


class WorkItemListView(APIView):
    def get(self, request: Request, team_season_id: int) -> Response:
        assert isinstance(request.user, User)
        team_season = team_season_acted_on(request.user, team_season_id)
        return Response([_work_item(item) for item in team_season.work_items.all()])

    def post(self, request: Request, team_season_id: int) -> Response:
        assert isinstance(request.user, User)
        team_season = team_season_acted_on(request.user, team_season_id)
        serializer = OpenWorkItemSerializer(
            data=request.data, context={"team_season": team_season}
        )
        serializer.is_valid(raise_exception=True)
        return Response(_work_item(serializer.save()), status=status.HTTP_201_CREATED)


def _entry(entry: Entry) -> dict[str, object]:
    return {
        "id": entry.id,
        "type": entry.type,
        "body": entry.body,
        "step": entry.step,
        "handover": entry.handover,
        "occurred_at": entry.occurred_at,
        "author": entry.author.display_name,
        "participants": [user.display_name for user in entry.participants.all()],
    }


def _work_item_acted_on(user: User, work_item_id: int) -> WorkItem:
    item = get_object_or_404(WorkItem, pk=work_item_id)
    team_season_acted_on(user, item.team_season_id)
    return item


class WorkItemDetailView(APIView):
    def get(self, request: Request, pk: int) -> Response:
        assert isinstance(request.user, User)
        item = _work_item_acted_on(request.user, pk)
        thread = item.entries.select_related("author").order_by("-occurred_at", "-id")
        return Response(
            {**_work_item(item), "thread": [_entry(entry) for entry in thread]}
        )

    def patch(self, request: Request, pk: int) -> Response:
        assert isinstance(request.user, User)
        item = _work_item_acted_on(request.user, pk)
        serializer = CloseWorkItemSerializer(item, data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(_work_item(serializer.save()))


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
        serializer = TickSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        step = serializer.validated_data.get("step")

        entry = progress_of_the_day(item, workday(timezone.now()))
        created = entry is None or (step is not None and step != entry.step)
        if created:
            entry = record_progress(item, user, "", step=step)
        assert entry is not None
        if not entry.participants.filter(pk=user.pk).exists():
            join(entry, user)
        return Response(
            _entry(entry),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class EntryDetailView(APIView):
    def patch(self, request: Request, pk: int) -> Response:
        user = request.user
        assert isinstance(user, User)
        entry = get_object_or_404(Entry, pk=pk)
        team_season_acted_on(user, entry.team_season_id)
        serializer = WriteProgressSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        edit_progress(
            entry,
            user,
            data.get("body", entry.body),
            step=data.get("step"),
            handover=data.get("handover"),
        )
        return Response(_entry(entry))


class NoteCreateView(APIView):
    def post(self, request: Request, team_season_id: int) -> Response:
        user = request.user
        assert isinstance(user, User)
        team_season = team_season_acted_on(user, team_season_id)
        serializer = NoteSerializer(
            data=request.data, context={"team_season": team_season, "author": user}
        )
        serializer.is_valid(raise_exception=True)
        return Response(_entry(serializer.save()), status=status.HTTP_201_CREATED)


class DayView(APIView):
    def get(self, request: Request, team_season_id: int, day: str) -> Response:
        user = request.user
        assert isinstance(user, User)
        team_season = team_season_acted_on(user, team_season_id)
        serializer = DaySerializer(data={"day": day})
        serializer.is_valid(raise_exception=True)
        the_day = serializer.validated_data["day"]
        # The roster the attendance is counted against: students, as mentors
        # are never counted present.
        roster = team_season.memberships.filter(user__club_role=User.ClubRole.STUDENT)
        return Response(
            {
                "day": the_day,
                "entries": [
                    _entry(entry) for entry in day_entries(team_season, the_day)
                ],
                "present": [
                    user.display_name for user in attendance(team_season, the_day)
                ],
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
