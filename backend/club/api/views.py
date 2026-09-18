"""The club's HTTP surface. One instance serves one club, so there is no
tenant to resolve: every route below is about the person calling it."""

from django.contrib.auth import login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from club.models import User

from .serializers import LoginSerializer, SignUpSerializer


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


class LoginView(APIView):
    """Session and cookie, not a token: the front end is served from the same
    origin, behind the one proxy, so Django's own session machinery applies
    and nothing has to be stored in the browser."""

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
