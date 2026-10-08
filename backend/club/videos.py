"""A phone video records where it was filmed, and most members are minors.
ffmpeg copies its picture and sound as they are, without re-encoding, and
leaves everything that describes it behind."""

import shutil
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.files.base import File
from django.core.files.uploadedfile import UploadedFile

# Far above what copying 200 MB takes on a disk.
TIMEOUT_SECONDS = 60


class Unreadable(Exception):
    """ffmpeg could not copy it, so it is not known to be clean."""


def without_metadata(value: UploadedFile, reader: str, writer: str, name: str) -> File:
    """`reader` is forced rather than guessed: left to guess, ffmpeg also
    reads playlists and lists of files, which open other files on the server
    or addresses on the network. Data tracks are left out, since an iPhone
    may record its position in one, beyond what `-map_metadata` clears."""
    with TemporaryDirectory() as directory:
        sent = Path(directory) / "sent"
        cleaned = Path(directory) / name
        with sent.open("wb") as copy:
            shutil.copyfileobj(value, copy)
        command = [
            "ffmpeg", "-nostdin", "-v", "error",
            "-protocol_whitelist", "file", "-f", reader, "-i", str(sent),
            "-map", "0:v", "-map", "0:a?", "-c", "copy",
            "-map_metadata", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1",
            "-fflags", "+bitexact", "-f", writer, str(cleaned),
        ]  # fmt: skip
        try:
            subprocess.run(
                command, check=True, capture_output=True, timeout=TIMEOUT_SECONDS
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            raise Unreadable from error
        # Still open once the directory is gone: the file goes with its last
        # handle, after Django has stored it.
        return File(cleaned.open("rb"), name=name)
