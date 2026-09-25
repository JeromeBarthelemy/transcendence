"""Which attached files someone must look at before a publication: those
with people on them, in a team where a member's refusal is in force now —
not at the photo's date. With no refusal, the usual case, nothing."""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from django.core.files.base import ContentFile

from club.models import (
    Attachment,
    Consent,
    Entry,
    Membership,
    Season,
    Team,
    TeamSeason,
    User,
)


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


def team_season(number=12345):
    season, _ = Season.objects.get_or_create(start_year=2026, game_name="BioBuzz")
    team = Team.objects.create(number=number, name=f"Équipe {number}")
    return TeamSeason.objects.create(team=team, season=season)


def member_of(team_season, name):
    user = User.objects.create_user(f"{name}@example.org", name)
    Membership.objects.create(user=user, team_season=team_season)
    return user


def attached(team_season, author, recognisable=True, name="photo.jpg"):
    entry = Entry.objects.create(
        team_season=team_season, author=author, type=Entry.Type.NOTE
    )
    return Attachment.objects.create(
        entry=entry,
        uploaded_by=author,
        file=ContentFile(b"\xff\xd8\xff", name="stored.jpg"),
        name=name,
        content_type="image/jpeg",
        people_recognisable=recognisable,
    )


def decides(user, decision, month):
    Consent.objects.create(
        user=user,
        decision=decision,
        granted_by=Consent.GrantedBy.LEGAL_GUARDIAN,
        decided_at=datetime(2026, month, 1, tzinfo=ZoneInfo("Europe/Paris")),
    )


def test_nothing_is_to_check_when_nobody_refused():
    rouages = team_season()
    attached(rouages, member_of(rouages, "lina"))

    assert not Attachment.objects.to_check().exists()


def test_a_file_with_people_on_it_is_to_check_when_a_member_of_its_team_refused():
    rouages = team_season()
    photo = attached(rouages, member_of(rouages, "lina"))
    decides(member_of(rouages, "jade"), Consent.Decision.REFUSED, month=9)

    assert list(Attachment.objects.to_check()) == [photo]


def test_a_file_without_people_on_it_is_never_to_check():
    rouages = team_season()
    attached(rouages, member_of(rouages, "lina"), recognisable=False)
    decides(member_of(rouages, "jade"), Consent.Decision.REFUSED, month=9)

    assert not Attachment.objects.to_check().exists()


def test_a_refusal_in_another_team_flags_nothing_here():
    rouages = team_season(12345)
    attached(rouages, member_of(rouages, "lina"))
    decides(member_of(team_season(67890), "jade"), Consent.Decision.REFUSED, month=9)

    assert not Attachment.objects.to_check().exists()


def test_a_grant_after_a_refusal_lifts_the_check():
    rouages = team_season()
    attached(rouages, member_of(rouages, "lina"))
    jade = member_of(rouages, "jade")
    decides(jade, Consent.Decision.REFUSED, month=9)
    decides(jade, Consent.Decision.GRANTED, month=10)

    assert not Attachment.objects.to_check().exists()


def test_the_admin_lists_only_the_files_to_check(client):
    rouages = team_season()
    lina = member_of(rouages, "lina")
    attached(rouages, lina, name="demo-college.jpg")
    attached(rouages, lina, recognisable=False, name="plan-intake.pdf")
    decides(member_of(rouages, "jade"), Consent.Decision.REFUSED, month=9)
    client.force_login(User.objects.create_superuser("admin@example.org", "admin"))

    page = client.get("/admin/club/attachment/?a_verifier=oui").content.decode()

    assert "demo-college.jpg" in page
    assert "plan-intake.pdf" not in page


def test_the_admin_cannot_add_a_file(client):
    client.force_login(User.objects.create_superuser("admin@example.org", "admin"))

    assert client.get("/admin/club/attachment/add/").status_code == 403


def test_the_admin_clears_the_flag_but_cannot_replace_the_file(client):
    rouages = team_season()
    photo = attached(rouages, member_of(rouages, "lina"))
    stored = photo.file.name
    client.force_login(User.objects.create_superuser("admin@example.org", "admin"))

    client.post(
        f"/admin/club/attachment/{photo.pk}/change/",
        {
            "entry": photo.entry_id,
            "uploaded_by": photo.uploaded_by_id,
            "file": ContentFile(b"<script>", name="page.html"),
            "name": "page.html",
            "content_type": "text/html",
        },
    )

    photo.refresh_from_db()
    assert not photo.people_recognisable
    assert photo.file.name == stored
    assert (photo.name, photo.content_type) == ("photo.jpg", "image/jpeg")
