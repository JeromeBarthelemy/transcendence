"""The club's HTTP surface. One instance serves one club, so there is no
tenant to resolve: every route below is about the person calling it."""

from django.contrib.auth import login, logout
from django.db import transaction
from django.db.models import ProtectedError
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from club.models import Entry, Membership, Team, User, WorkItem

from .errors import Conflict
from .permissions import IsClubAdmin, team_season_acted_on
from .serializers import (
    AddMembershipSerializer,
    CreateTeamSerializer,
    LoginSerializer,
    OpenWorkItemSerializer,
    RenameTeamSerializer,
    SignUpSerializer,
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
    return {
        "id": item.id,
        "title": item.title,
        "on_robot": item.on_robot,
        "status": item.status,
        # The latest progress already carries it: read once, not twice.
        "current_step": latest.step if latest else None,
        "handover": item.handover,
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
