"""What a file attached to an entry may be, read from what it contains: its
name and the type the browser announces are whatever the sender chose.

A closed list, because every file is served back to other members from the
application's own address: an HTML or SVG page opened there would run with
the session of whoever opened it."""

import struct
from io import BytesIO
from pathlib import Path
from typing import NamedTuple
from uuid import uuid4

from django.core.files.base import ContentFile, File
from django.core.files.uploadedfile import UploadedFile
from PIL import ImageOps
from rest_framework.exceptions import ValidationError

from club import images

MEGABYTE = 1024 * 1024
# Downloaded rather than shown: no browser displays a CAD file.
DOWNLOAD_ONLY = "application/octet-stream"


class Kind(NamedTuple):
    content_type: str
    extension: str
    max_bytes: int


JPEG = Kind("image/jpeg", ".jpg", 20 * MEGABYTE)
PNG = Kind("image/png", ".png", 20 * MEGABYTE)
WEBP = Kind("image/webp", ".webp", 20 * MEGABYTE)
PDF = Kind("application/pdf", ".pdf", 20 * MEGABYTE)
MP4 = Kind("video/mp4", ".mp4", 200 * MEGABYTE)
MOV = Kind("video/quicktime", ".mov", 200 * MEGABYTE)
WEBM = Kind("video/webm", ".webm", 200 * MEGABYTE)
STEP = Kind(DOWNLOAD_ONLY, ".step", 50 * MEGABYTE)
STL = Kind(DOWNLOAD_ONLY, ".stl", 50 * MEGABYTE)

PHOTOS = {JPEG: "JPEG", PNG: "PNG", WEBP: "WEBP"}

# MP4, MOV and HEIC photos are all ISO media files, told apart by the brand
# that follows `ftyp`. Android films in MP4, an iPhone in MOV and takes its
# photos in HEIC.
MP4_BRANDS = {b"isom", b"iso2", b"iso4", b"iso5", b"iso6", b"mp41", b"mp42"}
MP4_BRANDS |= {b"avc1", b"M4V "}
HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"}


class Checked(NamedTuple):
    name: str
    content_type: str
    file: File


def check(value: UploadedFile) -> Checked:
    # Django sizes every file it receives; the type allows None only for
    # files built by hand.
    assert value.size is not None
    head = value.read(84)
    value.seek(0)
    kind = _kind(head, value.size)
    if value.size > kind.max_bytes:
        raise ValidationError(
            f"Ce fichier dépasse {kind.max_bytes // MEGABYTE} Mo.",
            code="attachment_too_large",
        )
    name = value.name or "fichier"
    if _is_heic(head):
        # Its name follows what it becomes, or the download would be a JPEG
        # that the computer tries to open as HEIC.
        name = f"{Path(name).stem}.jpg"
    stored = f"{uuid4().hex}{kind.extension}"
    if kind in PHOTOS:
        return Checked(name, kind.content_type, _without_metadata(value, kind, stored))
    value.name = stored
    return Checked(name, kind.content_type, value)


def _kind(head: bytes, size: int) -> Kind:
    if head.startswith(b"\xff\xd8\xff"):
        return JPEG
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return PNG
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return WEBP
    if head.startswith(b"%PDF-"):
        return PDF
    if _is_heic(head):
        # Kept as a JPEG: only Safari shows HEIC, and a JPEG is what the
        # photo becomes once its metadata is gone anyway.
        return JPEG
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand == b"qt  ":
            return MOV
        if brand in MP4_BRANDS:
            return MP4
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return WEBM
    if head.startswith(b"ISO-10303-21;"):
        return STEP
    # A binary STL says how many triangles follow its 80-byte header, 50
    # bytes each; checked first, since some start that header with "solid".
    if len(head) == 84 and size == 84 + 50 * struct.unpack("<I", head[80:])[0]:
        return STL
    if head.startswith(b"solid"):
        return STL
    raise ValidationError(
        "Formats acceptés : photos JPEG, PNG ou WebP, vidéos MP4, MOV ou WebM, "
        "PDF, fichiers de CAO STEP ou STL.",
        code="attachment_type_refused",
    )


def _is_heic(head: bytes) -> bool:
    return head[4:8] == b"ftyp" and head[8:12] in HEIC_BRANDS


def _without_metadata(value: UploadedFile, kind: Kind, name: str) -> ContentFile:
    """A phone photo records where it was taken, and most members are
    minors. The photo keeps its size and format; only what describes it goes."""
    try:
        image = images.decode(value)
    except images.TooManyPixels:
        raise ValidationError(
            "Cette photo compte trop de pixels.", code="attachment_too_many_pixels"
        ) from None
    except images.Unreadable:
        raise ValidationError(
            "Ce fichier n'est pas une photo lisible.", code="attachment_type_refused"
        ) from None
    # Stored upright, since the tag saying which way is up goes with the rest.
    upright = ImageOps.exif_transpose(image)
    # A HEIC photo may carry transparency, which JPEG cannot hold.
    if PHOTOS[kind] == "JPEG" and upright.mode not in ("RGB", "L"):
        upright = upright.convert("RGB")
    encoded = BytesIO()
    # The colour profile is not metadata about anyone, and an iPhone photo
    # looks washed out without it.
    options = {"icc_profile": image.info.get("icc_profile")}
    if kind != PNG:
        options["quality"] = 95
    upright.save(encoded, PHOTOS[kind], **options)
    return ContentFile(encoded.getvalue(), name=name)
