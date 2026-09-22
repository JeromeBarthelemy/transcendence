import pytest
from django.test import Client

from club.api.serializers import SignUpSerializer
from club.models import User, VerificationRequest

URL = "/api/auth/signup/"

MARIE = {
    "email": "marie@example.org",
    "password": "rouage-bleu-2026",
    "display_name": "Marie",
    "last_name": "Dubois",
    "first_name": "Marie",
    "birth_date": "2009-06-08",
}


def signup(client, **overrides):
    return client.post(URL, MARIE | overrides, content_type="application/json")


def test_signing_up_creates_an_account(client):
    response = signup(client)

    assert response.status_code == 201
    assert User.objects.get(display_name="Marie").email == "marie@example.org"


def test_a_new_account_is_an_unverified_minor_with_no_team(client):
    signup(client)

    marie = User.objects.get(display_name="Marie")
    assert marie.is_minor
    assert marie.assoconnect_id is None
    assert not marie.memberships.exists()
    assert not marie.is_club_admin
    assert not marie.is_staff


def test_the_declared_birth_date_never_reaches_the_account(client):
    # It serves the AssoConnect matching and nothing else: a minor could
    # type any date, so only a verified one may decide adulthood.
    signup(client)

    marie = User.objects.get(display_name="Marie")
    assert marie.birth_date is None
    assert marie.verification_request.birth_date.isoformat() == "2009-06-08"


def test_signing_up_records_what_the_matching_will_need(client):
    signup(client)

    request = VerificationRequest.objects.get(user__display_name="Marie")
    assert (request.first_name, request.last_name) == ("Marie", "Dubois")


def test_the_password_is_hashed_and_signs_in(client):
    signup(client)

    marie = User.objects.get(display_name="Marie")
    assert marie.password != "rouage-bleu-2026"
    assert marie.check_password("rouage-bleu-2026")


def test_the_response_never_echoes_the_password(client):
    response = signup(client)

    assert "rouage-bleu-2026" not in response.content.decode()


def test_a_member_with_no_address_gets_one_on_the_reserved_domain(client):
    response = signup(client, email="")

    assert response.status_code == 201
    assert User.objects.get(display_name="Marie").email == (
        "marie.dubois@rouages.invalid"
    )


def test_every_refusal_carries_a_code_and_a_sentence(client):
    # The contract the front end is built against: never one without the other.
    response = signup(client, password="1234")

    (refusal, *_) = response.json()["password"]
    assert refusal["code"] == "password_too_short"
    assert "8 caractères" in refusal["message"]


def test_an_address_differing_only_by_case_is_refused(client):
    User.objects.create_user("marie@example.org", "Déjà là")

    response = signup(client, email="Marie@example.org")

    assert response.status_code == 400
    assert response.json()["email"][0]["code"] == "email_taken"


def test_a_display_name_differing_only_by_case_is_refused(client):
    User.objects.create_user("autre@example.org", "marie")

    response = signup(client, display_name="MARIE")

    assert response.status_code == 400
    (refusal,) = response.json()["display_name"]
    assert refusal["code"] == "display_name_taken"
    assert "initiale" in refusal["message"]


def test_a_weak_password_is_refused_in_french(client):
    # Django's own validators, which is what satisfies the subject.
    response = signup(client, password="1234")

    assert response.status_code == 400
    assert "password" in response.json()


def test_a_display_name_holding_an_at_sign_is_refused(client):
    response = signup(client, display_name="marie@example.org")

    assert response.status_code == 400
    assert response.json()["display_name"][0]["code"] == "display_name_has_at_sign"


def test_nothing_is_left_behind_when_sign_up_is_refused(client):
    signup(client, password="1234")

    assert not User.objects.filter(display_name="Marie").exists()
    assert not VerificationRequest.objects.exists()


@pytest.mark.parametrize(
    "missing", ["password", "display_name", "last_name", "first_name", "birth_date"]
)
def test_every_required_field_is_required(client, missing):
    response = signup(client, **{missing: ""})

    assert response.status_code == 400
    assert missing in response.json()


def test_a_declared_role_is_ignored(client):
    # Sign-up is open to whoever has the address, so a role it accepted would
    # be a role granted by asking. #52 builds permissions on this field.
    signup(client, club_role="mentor")

    assert User.objects.get(email="marie@example.org").club_role == "student"


def overtaken_by(monkeypatch, **rival):
    """Lets a rival sign-up through between the validation of the request under
    test and its write: the interleaving two simultaneous requests produce."""
    save = SignUpSerializer.save
    answers = []

    def rival_first(serializer, **kwargs):
        # The rival goes through the real save, or it would be overtaken too.
        monkeypatch.setattr(SignUpSerializer, "save", save)
        answers.append(signup(Client(), **rival).status_code)
        return save(serializer, **kwargs)

    monkeypatch.setattr(SignUpSerializer, "save", rival_first)
    return answers


def test_of_two_simultaneous_sign_ups_on_one_display_name_the_second_is_refused(
    client, monkeypatch
):
    rival = overtaken_by(monkeypatch, email="autre@example.org", display_name="marie")

    response = signup(client)

    assert rival == [201]
    assert response.status_code == 400
    (refusal,) = response.json()["display_name"]
    assert refusal["code"] == "display_name_taken"
    assert User.objects.count() == VerificationRequest.objects.count() == 1


def test_of_two_simultaneous_sign_ups_on_one_address_the_second_is_refused(
    client, monkeypatch
):
    rival = overtaken_by(monkeypatch, display_name="Marie D.")

    response = signup(client)

    assert rival == [201]
    assert response.status_code == 400
    (refusal,) = response.json()["email"]
    assert refusal["code"] == "email_taken"
    assert User.objects.count() == VerificationRequest.objects.count() == 1
