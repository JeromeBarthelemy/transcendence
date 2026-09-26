"""Files attached to an entry: added by anyone on the team, removed by whoever
added them or a mentor, served to the team and its mentors only, and checked
on what they contain rather than on their name."""

import struct
from io import BytesIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from club.models import Entry, Membership, Season, Team, TeamSeason, User, WorkItem

ORIENTATION = 0x0112
CAMERA_MAKE = 0x010F
MEGABYTE = 1024 * 1024


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


def team_season(number=12345):
    season, _ = Season.objects.get_or_create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=number, name=f"Équipe {number}")
    return TeamSeason.objects.create(team=team, season=season)


def member_of(team_season, name="lina"):
    user = User.objects.create_user(f"{name}@example.org", name)
    Membership.objects.create(user=user, team_season=team_season)
    return user


def mentor(name="paul"):
    return User.objects.create_user(
        f"{name}@example.org", name, club_role=User.ClubRole.MENTOR
    )


def note(team_season, author, work_item=None):
    return Entry.objects.create(
        team_season=team_season,
        author=author,
        work_item=work_item,
        type=Entry.Type.NOTE,
        body="Démonstration au collège",
    )


def photo(format="PNG", size=(64, 48), exif=None):
    buffer = BytesIO()
    Image.new("RGB", size, "teal").save(
        buffer, format, **({"exif": exif} if exif else {})
    )
    return SimpleUploadedFile(f"photo.{format.lower()}", buffer.getvalue())


def pdf():
    return SimpleUploadedFile("plan.pdf", b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n")


def iso_media(brand, name):
    """The start of an MP4, a MOV or a HEIC photo: all three are ISO media
    files, told apart by the brand after `ftyp`."""
    box = struct.pack(">I", 24) + b"ftyp" + brand + b"\x00\x00\x00\x00" + brand
    return SimpleUploadedFile(name, box + b"\x00" * 64)


def webm():
    return SimpleUploadedFile("essai.webm", b"\x1a\x45\xdf\xa3" + b"\x00" * 64)


def step():
    return SimpleUploadedFile(
        "intake.step", b"ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n"
    )


def stl_text():
    return SimpleUploadedFile("roue.stl", b"solid roue\nendsolid roue\n")


def stl_binary():
    triangle = b"\x00" * 50
    return SimpleUploadedFile(
        "roue.stl", b"\x00" * 80 + struct.pack("<I", 1) + triangle
    )


def attach(client, entry, file, people_recognisable="false", **fields):
    return client.post(
        f"/api/entries/{entry.id}/attachments/",
        {"file": file, "people_recognisable": people_recognisable, **fields},
    )


def download(client, attachment):
    return client.get(attachment["url"])


# --- who may attach ---


def test_a_member_attaches_a_file_to_an_entry_a_teammate_wrote(client):
    rouages = team_season()
    entry = note(rouages, member_of(rouages, "lina"))
    client.force_login(member_of(rouages, "tom"))

    response = attach(client, entry, pdf())

    assert response.status_code == 201
    assert response.json()["name"] == "plan.pdf"
    assert response.json()["uploaded_by"] == "tom"


def test_a_mentor_attaches_a_file_to_any_team(client):
    rouages = team_season()
    entry = note(rouages, member_of(rouages))
    client.force_login(mentor())

    assert attach(client, entry, pdf()).status_code == 201


def test_a_student_of_another_team_cannot_attach_a_file(client):
    rouages = team_season(12345)
    entry = note(rouages, member_of(rouages))
    client.force_login(member_of(team_season(67890), "hugo"))

    response = attach(client, entry, pdf())

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "not_a_member"


def test_an_attachment_records_whether_people_are_recognisable_on_it(client):
    rouages = team_season()
    entry = note(rouages, member_of(rouages))
    client.force_login(entry.author)

    flagged = attach(client, entry, photo(), people_recognisable="true").json()
    unflagged = attach(client, entry, photo(), people_recognisable="false").json()

    assert flagged["people_recognisable"] is True
    assert unflagged["people_recognisable"] is False


def test_whoever_attaches_a_file_must_say_whether_people_are_recognisable(client):
    rouages = team_season()
    entry = note(rouages, member_of(rouages))
    client.force_login(entry.author)

    response = client.post(f"/api/entries/{entry.id}/attachments/", {"file": photo()})

    assert response.status_code == 400
    assert response.json()["people_recognisable"][0]["code"] == "required"
    assert not entry.attachments.exists()


# --- where attachments show ---


def test_an_entry_lists_its_attachments_in_the_work_item_thread(client):
    rouages = team_season()
    lina = member_of(rouages)
    intake = WorkItem.objects.create(team_season=rouages, title="Intake")
    entry = note(rouages, lina, work_item=intake)
    client.force_login(lina)
    attached = attach(client, entry, pdf()).json()

    thread = client.get(f"/api/work-items/{intake.id}/").json()["thread"]

    assert thread[0]["attachments"] == [attached]


# --- who may download ---


def test_the_team_downloads_an_attachment(client):
    rouages = team_season()
    entry = note(rouages, member_of(rouages, "lina"))
    client.force_login(entry.author)
    attached = attach(client, entry, pdf()).json()
    client.force_login(member_of(rouages, "tom"))

    response = download(client, attached)

    assert response.status_code == 200
    assert b"".join(response.streaming_content).startswith(b"%PDF-")


def test_a_student_of_another_team_cannot_download_an_attachment(client):
    rouages = team_season(12345)
    entry = note(rouages, member_of(rouages))
    client.force_login(entry.author)
    attached = attach(client, entry, pdf()).json()
    client.force_login(member_of(team_season(67890), "hugo"))

    assert download(client, attached).status_code == 403


def test_an_anonymous_caller_cannot_download_an_attachment(client):
    rouages = team_season()
    entry = note(rouages, member_of(rouages))
    client.force_login(entry.author)
    attached = attach(client, entry, pdf()).json()
    client.logout()

    assert download(client, attached).status_code == 403


# --- who may delete ---


def test_a_member_cannot_delete_a_file_a_teammate_attached(client):
    rouages = team_season()
    entry = note(rouages, member_of(rouages, "lina"))
    client.force_login(entry.author)
    attached = attach(client, entry, pdf()).json()
    client.force_login(member_of(rouages, "tom"))

    response = client.delete(attached["url"])

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "delete_not_uploader"


def test_a_mentor_deletes_a_file_a_student_attached(client):
    rouages = team_season()
    entry = note(rouages, member_of(rouages))
    client.force_login(entry.author)
    attached = attach(client, entry, pdf()).json()
    client.force_login(mentor())

    assert client.delete(attached["url"]).status_code == 204
    assert download(client, attached).status_code == 404


def test_deleting_an_attachment_removes_its_file(
    client, media_root, django_capture_on_commit_callbacks
):
    rouages = team_season()
    entry = note(rouages, member_of(rouages))
    client.force_login(entry.author)
    attached = attach(client, entry, pdf()).json()
    stored = next((media_root / "attachments").iterdir())

    with django_capture_on_commit_callbacks(execute=True):
        client.delete(attached["url"])

    assert not stored.exists()


def test_deleting_an_entry_removes_its_files(
    client, media_root, django_capture_on_commit_callbacks
):
    rouages = team_season()
    entry = note(rouages, member_of(rouages))
    client.force_login(entry.author)
    attach(client, entry, pdf())
    stored = next((media_root / "attachments").iterdir())

    with django_capture_on_commit_callbacks(execute=True):
        entry.delete()

    assert not stored.exists()


# --- what is accepted, and how it is kept ---


def upload_and_fetch(client, file, **fields):
    rouages = team_season()
    entry = note(rouages, member_of(rouages))
    client.force_login(entry.author)
    response = attach(client, entry, file, **fields)
    assert response.status_code == 201, response.json()
    return download(client, response.json())


def content(response):
    return b"".join(response.streaming_content)


def test_a_photo_keeps_its_resolution_and_format(client):
    response = upload_and_fetch(client, photo("JPEG", size=(4000, 3000)))

    image = Image.open(BytesIO(content(response)))
    assert response["Content-Type"] == "image/jpeg"
    assert (image.format, image.size) == ("JPEG", (4000, 3000))


def test_a_photo_is_stored_without_its_metadata(client):
    exif = Image.Exif()
    exif[CAMERA_MAKE] = "Téléphone de Lina"

    response = upload_and_fetch(client, photo("JPEG", exif=exif))

    assert not Image.open(BytesIO(content(response))).getexif()


def test_a_photo_taken_sideways_is_stored_upright(client):
    exif = Image.Exif()
    exif[ORIENTATION] = 6  # the camera was turned: display rotated 90°

    response = upload_and_fetch(client, photo("JPEG", size=(64, 48), exif=exif))

    assert Image.open(BytesIO(content(response))).size == (48, 64)


@pytest.mark.parametrize(
    ("file", "content_type"),
    [
        (lambda: pdf(), "application/pdf"),
        (lambda: iso_media(b"mp42", "essai.mp4"), "video/mp4"),
        (lambda: iso_media(b"qt  ", "essai.mov"), "video/quicktime"),
        (lambda: webm(), "video/webm"),
    ],
    ids=["pdf", "android video", "iphone video", "webm video"],
)
def test_documents_and_videos_are_kept_as_sent_and_shown_in_the_browser(
    client, file, content_type
):
    sent = file()
    original = sent.read()
    sent.seek(0)

    response = upload_and_fetch(client, sent)

    assert response["Content-Type"] == content_type
    assert response["Content-Disposition"].startswith("inline")
    assert content(response) == original


@pytest.mark.parametrize(
    "file",
    [step, stl_text, stl_binary],
    ids=["step", "text stl", "binary stl"],
)
def test_cad_files_are_accepted_and_only_downloaded(client, file):
    response = upload_and_fetch(client, file())

    assert response["Content-Type"] == "application/octet-stream"
    assert response["Content-Disposition"].startswith("attachment")


def test_the_browser_is_told_not_to_guess_the_type_of_a_file(client):
    response = upload_and_fetch(client, pdf())

    assert response["X-Content-Type-Options"] == "nosniff"


# --- refusals ---


def refused(client, file):
    rouages = team_season()
    entry = note(rouages, member_of(rouages))
    client.force_login(entry.author)
    response = attach(client, entry, file)
    assert response.status_code == 400
    return response.json()["file"][0]["code"]


def test_a_refused_file_leaves_nothing_on_disk(client, media_root):
    refused(client, SimpleUploadedFile("page.html", b"<html></html>"))

    assert not (media_root / "attachments").exists()


@pytest.mark.parametrize(
    "file",
    [
        SimpleUploadedFile("essai.mp4", b"not a video at all"),
        SimpleUploadedFile("page.html", b"<html><script>alert(1)</script>"),
        SimpleUploadedFile("dessin.svg", b"<svg xmlns='http://www.w3.org/2000/svg'/>"),
    ],
    ids=["renamed file", "html", "svg"],
)
def test_a_file_matching_no_accepted_type_is_refused_whatever_its_name(client, file):
    assert refused(client, file) == "attachment_type_refused"


def test_a_gif_is_refused_though_it_is_an_image(client):
    assert refused(client, photo("GIF")) == "attachment_type_refused"


def test_a_heic_photo_is_refused_with_its_own_message(client):
    assert refused(client, iso_media(b"heic", "IMG_0042.HEIC")) == (
        "attachment_heic_refused"
    )


def test_a_pdf_over_twenty_megabytes_is_refused(client):
    too_large = SimpleUploadedFile("plan.pdf", b"%PDF-" + b"0" * (20 * MEGABYTE))

    assert refused(client, too_large) == "attachment_too_large"


def test_a_file_that_claims_to_be_a_photo_but_does_not_decode_is_refused(client):
    broken = SimpleUploadedFile("photo.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)

    assert refused(client, broken) == "attachment_type_refused"


def test_a_small_photo_decoding_to_too_many_pixels_is_refused(client, monkeypatch):
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)

    assert refused(client, photo(size=(40, 40))) == "attachment_too_many_pixels"
