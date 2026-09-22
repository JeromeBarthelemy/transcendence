"""A member's own photo: uploaded, replaced and deleted over the API, and
shown to signed-in members only."""

from io import BytesIO
from pathlib import Path

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test.client import BOUNDARY, MULTIPART_CONTENT, encode_multipart
from PIL import Image

from club.models import User

ORIENTATION = 0x0112
CAMERA_MAKE = 0x010F


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


def member(email="lina@club.fr", display_name="lina"):
    return User.objects.create_user(email, display_name)


def photo(format="PNG", size=(1024, 768), exif=None):
    buffer = BytesIO()
    Image.new("RGB", size, "teal").save(
        buffer, format, **({"exif": exif} if exif else {})
    )
    return SimpleUploadedFile(f"photo.{format.lower()}", buffer.getvalue())


def upload(client, file):
    return client.put(
        "/api/auth/me/avatar/",
        encode_multipart(BOUNDARY, {"avatar": file}),
        content_type=MULTIPART_CONTENT,
    )


def stored(user):
    user.refresh_from_db()
    return Image.open(user.avatar.path)


# --- uploading ---


def test_a_member_uploads_their_avatar_and_their_identity_points_to_it(client):
    lina = member()
    client.force_login(lina)

    response = upload(client, photo())

    assert response.status_code == 200
    assert response.json()["avatar"] == f"/api/users/{lina.pk}/avatar/"
    assert (
        client.get("/api/auth/me/").json()["avatar"] == f"/api/users/{lina.pk}/avatar/"
    )


def test_a_member_without_an_avatar_has_none_in_their_identity(client):
    client.force_login(member())

    assert client.get("/api/auth/me/").json()["avatar"] is None


def test_the_stored_avatar_is_a_webp_no_larger_than_512_pixels(client):
    lina = member()
    client.force_login(lina)

    upload(client, photo("JPEG", size=(4000, 3000)))

    image = stored(lina)
    assert image.format == "WEBP"
    assert image.size == (512, 384)


def test_a_photo_taken_sideways_is_stored_upright(client):
    lina = member()
    client.force_login(lina)
    exif = Image.Exif()
    exif[ORIENTATION] = 6  # the camera was turned a quarter clockwise

    upload(client, photo("JPEG", size=(400, 300), exif=exif))

    assert stored(lina).size == (300, 400)


def test_an_avatar_is_stored_without_the_metadata_of_the_photo(client):
    lina = member()
    client.force_login(lina)
    exif = Image.Exif()
    exif[CAMERA_MAKE] = "Téléphone de Lina"

    upload(client, photo("JPEG", exif=exif))

    assert not stored(lina).getexif()


def test_an_anonymous_caller_cannot_upload_an_avatar(client):
    assert upload(client, photo()).status_code == 403


# --- refusals ---


def test_a_file_that_is_not_an_image_is_refused(client):
    lina = member()
    client.force_login(lina)

    response = upload(client, SimpleUploadedFile("photo.png", b"not an image"))

    assert response.status_code == 400
    assert response.json()["avatar"][0]["code"] == "avatar_not_an_image"
    lina.refresh_from_db()
    assert not lina.avatar


def test_an_image_in_a_format_outside_jpeg_png_and_webp_is_refused(client):
    client.force_login(member())

    response = upload(client, photo("GIF"))

    assert response.status_code == 400
    assert response.json()["avatar"][0]["code"] == "avatar_format_refused"


def test_a_file_over_ten_megabytes_is_refused(client):
    client.force_login(member())

    too_large = SimpleUploadedFile("photo.png", b"0" * (10 * 1024 * 1024 + 1))
    response = upload(client, too_large)

    assert response.status_code == 400
    assert response.json()["avatar"][0]["code"] == "avatar_too_large"


# --- replacing and deleting ---


def test_replacing_an_avatar_removes_the_previous_file(
    client, django_capture_on_commit_callbacks
):
    lina = member()
    client.force_login(lina)
    upload(client, photo())
    lina.refresh_from_db()
    previous = Path(lina.avatar.path)

    with django_capture_on_commit_callbacks(execute=True):
        upload(client, photo("JPEG"))

    lina.refresh_from_db()
    assert not previous.exists()
    assert Path(lina.avatar.path).exists()


def test_deleting_an_avatar_removes_it_and_its_file(
    client, django_capture_on_commit_callbacks
):
    lina = member()
    client.force_login(lina)
    upload(client, photo())
    lina.refresh_from_db()
    previous = Path(lina.avatar.path)

    with django_capture_on_commit_callbacks(execute=True):
        response = client.delete("/api/auth/me/avatar/")

    assert response.status_code == 204
    assert not previous.exists()
    assert client.get("/api/auth/me/").json()["avatar"] is None


# --- serving ---


def test_another_member_sees_the_avatar(client):
    lina = member()
    client.force_login(lina)
    upload(client, photo())
    client.force_login(member("tom@club.fr", "tom"))

    response = client.get(f"/api/users/{lina.pk}/avatar/")

    assert response.status_code == 200
    assert response["Content-Type"] == "image/webp"


def test_an_anonymous_caller_cannot_see_an_avatar(client):
    lina = member()
    client.force_login(lina)
    upload(client, photo())
    client.logout()

    assert client.get(f"/api/users/{lina.pk}/avatar/").status_code == 403


def test_asking_for_the_avatar_of_a_member_who_has_none_finds_nothing(client):
    lina = member()
    client.force_login(member("tom@club.fr", "tom"))

    assert client.get(f"/api/users/{lina.pk}/avatar/").status_code == 404
