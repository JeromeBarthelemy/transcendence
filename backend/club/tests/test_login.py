from django.contrib.auth import authenticate
from django.test import Client
from rest_framework.throttling import ScopedRateThrottle

from club.models import User

PASSWORD = "rouage-bleu-2026"


def test_the_address_still_signs_in():
    # The subject's minimum, untouched: email and password.
    ada = User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)

    assert authenticate(username="ada@club.fr", password=PASSWORD) == ada


def test_the_display_name_signs_in_too():
    ada = User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)

    assert authenticate(username="Ada", password=PASSWORD) == ada


def test_the_display_name_signs_in_whatever_case_is_typed():
    ada = User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)

    assert authenticate(username="aDa", password=PASSWORD) == ada


def test_a_wrong_password_is_refused_on_the_display_name_path_too():
    User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)

    assert authenticate(username="Ada", password="pas-le-bon") is None


def test_an_unknown_display_name_is_refused():
    assert authenticate(username="Personne", password=PASSWORD) is None


def test_a_deactivated_account_is_refused_on_the_display_name_path():
    # A member who left keeps their account, deactivated, so their traces
    # stay attributed — it must not sign in.
    User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD, is_active=False)

    assert authenticate(username="Ada", password=PASSWORD) is None


def test_an_account_without_a_usable_password_is_refused():
    User.objects.create_user("ada@club.fr", "Ada")

    assert authenticate(username="Ada", password=PASSWORD) is None


def test_an_accented_name_signs_in():
    # The folding happens in Python on both sides. Were it left to SQLite,
    # Élodie could not sign in by name at all — not even by typing it right.
    elodie = User.objects.create_user("elodie@club.fr", "Élodie", password=PASSWORD)

    assert authenticate(username="Élodie", password=PASSWORD) == elodie


def test_an_accented_name_signs_in_whatever_case_is_typed():
    elodie = User.objects.create_user("elodie@club.fr", "Élodie", password=PASSWORD)

    assert authenticate(username="ÉLODIE", password=PASSWORD) == elodie


LOGIN = "/api/auth/login/"
LOGOUT = "/api/auth/logout/"
ME = "/api/auth/me/"


def signed_in(client):
    """Who the session belongs to — None for nobody."""
    response = client.get(ME)
    assert response.status_code == 200
    return response.json()


def login(client, username, password=PASSWORD, **extra):
    return client.post(
        LOGIN,
        {"username": username, "password": password},
        content_type="application/json",
        **extra,
    )


def test_the_api_opens_a_session_for_an_address(client):
    User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)

    assert login(client, "ada@club.fr").status_code == 200
    assert client.get(ME).json()["display_name"] == "Ada"


def test_the_api_opens_a_session_for_a_display_name(client):
    User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)

    assert login(client, "Ada").status_code == 200
    assert client.get(ME).json()["display_name"] == "Ada"


def test_a_wrong_password_opens_nothing(client):
    User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)

    assert login(client, "Ada", "pas-le-bon").status_code == 400
    assert signed_in(client) is None


def test_the_refusal_does_not_say_which_of_the_two_was_wrong(client):
    # Naming the unknown identifier would turn the login form into a roster.
    User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)

    unknown = login(client, "Personne").json()
    wrong = login(client, "Ada", "pas-le-bon").json()

    assert unknown == wrong
    assert unknown["non_field_errors"][0]["code"] == "bad_credentials"


# --- throttling repeated failures (#203) ---


def throttled_at(monkeypatch, rate):
    """Overriding settings.REST_FRAMEWORK would not do it: SimpleRateThrottle
    reads DEFAULT_THROTTLE_RATES once, into a class attribute, when the
    module first imports — not per request. This mutates that same dict
    directly instead, restored once the test ends."""
    monkeypatch.setitem(ScopedRateThrottle.THROTTLE_RATES, "login", rate)


def test_repeated_failed_logins_are_throttled(client, monkeypatch):
    throttled_at(monkeypatch, "3/min")
    User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)

    for _ in range(3):
        response = login(client, "Ada", "pas-le-bon")
        assert response.status_code == 400
        assert response.json()["non_field_errors"][0]["code"] == "bad_credentials"

    response = login(client, "Ada", "pas-le-bon")

    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "login_throttled"


def test_the_throttle_is_per_client_not_per_account(client, monkeypatch):
    # The whole point (#203): guessing against one account must not be able
    # to keep its own owner, asking from somewhere else, from signing in —
    # unlike the lockout this replaces, which blocked the account itself
    # regardless of who was asking.
    throttled_at(monkeypatch, "1/min")
    User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)

    guessed = login(client, "Ada", "pas-le-bon", REMOTE_ADDR="10.0.0.1")
    assert guessed.status_code == 400
    guessed_again = login(client, "Ada", "pas-le-bon", REMOTE_ADDR="10.0.0.1")
    assert guessed_again.status_code == 429

    response = login(client, "Ada", REMOTE_ADDR="10.0.0.2")

    assert response.status_code == 200


def test_a_suspended_members_own_correct_password_is_still_just_refused(client):
    # Reaches authenticate() the same way a wrong password does (ModelBackend
    # refuses an inactive user before checking it) and must read the same —
    # "suspended" would otherwise tell an admin-suspended account apart from
    # every other refusal.
    ada = User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)
    ada.is_active = False
    ada.save(update_fields=["is_active"])

    response = login(client, "Ada")

    assert response.status_code == 400
    assert response.json()["non_field_errors"][0]["code"] == "bad_credentials"


def test_the_session_route_hands_out_the_csrf_cookie(client):
    # The page calls this on boot to learn who it is talking to. It must come
    # back carrying the token even when nobody is signed in, or the login POST
    # that follows would have none to send and be refused.
    response = client.get(ME)

    assert "csrftoken" in response.cookies


def test_nobody_signed_in_is_an_answer_not_an_error(client):
    # Every page asks this on load; a 4xx would put a red line in the
    # browser's console for every visitor, and the subject allows none.
    response = client.get(ME)

    assert response.status_code == 200
    assert response.json() is None


def test_a_visitor_still_cannot_delete_an_account(client):
    response = client.delete(ME, {"password": "x"}, content_type="application/json")

    assert response.status_code == 403


def test_logging_out_closes_the_session(client):
    User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)
    login(client, "Ada")

    assert client.post(LOGOUT).status_code == 204
    assert signed_in(client) is None


def test_signing_up_then_logging_in_with_the_built_address(client):
    # The whole point, end to end: no address of one's own, and it still works.
    client.post(
        "/api/auth/signup/",
        {
            "email": "",
            "password": PASSWORD,
            "display_name": "Marie",
            "club_role": "student",
            "last_name": "Dubois",
            "first_name": "Marie",
            "birth_date": "2009-06-08",
        },
        content_type="application/json",
    )

    assert login(client, "marie.dubois@rouages.invalid").status_code == 200
    client.post(LOGOUT)
    assert login(client, "Marie").status_code == 200


def test_the_identity_says_only_what_an_interface_has_to_draw(client):
    # Pinned as an exact set, not a subset: the decision this asserts is what
    # the payload leaves out. A field added by habit — a birth date, a surname,
    # a minority flag — fails here rather than reaching a browser unnoticed.
    User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)

    identity = login(client, "Ada").json()

    assert set(identity) == {
        "display_name",
        "club_role",
        "is_club_admin",
        "avatar",
        "team_seasons",
    }


def csrf_client():
    """enforce_csrf_checks is off by default in tests, which is exactly how a
    missing CSRF guard stays invisible until production."""
    return Client(enforce_csrf_checks=True)


def test_an_anonymous_login_without_a_token_is_refused():
    # SessionAuthentication only enforces CSRF once it has found a session, so
    # the route that hands one out is the one it never protects. Without the
    # explicit guard a third-party page can sign a member into an account that
    # is not theirs.
    User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)
    client = csrf_client()

    refused = client.post(
        LOGIN,
        {"username": "Ada", "password": PASSWORD},
        content_type="application/json",
        HTTP_ORIGIN="http://ailleurs.example",
    )

    assert refused.status_code == 403
    assert "_auth_user_id" not in client.session


def test_an_anonymous_login_with_a_token_still_works():
    # The other half: the guard must refuse the forgery without refusing the
    # form. The page gets its token from GET /api/auth/me/, 403 included.
    User.objects.create_user("ada@club.fr", "Ada", password=PASSWORD)
    client = csrf_client()
    client.get(ME)
    token = client.cookies["csrftoken"].value

    accepted = client.post(
        LOGIN,
        {"username": "Ada", "password": PASSWORD},
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
    )

    assert accepted.status_code == 200
    assert "_auth_user_id" in client.session
