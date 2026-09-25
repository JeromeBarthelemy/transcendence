"""Opening a photo a member sent, without letting it take the server down."""

from typing import IO

from PIL import Image


class TooManyPixels(Exception):
    pass


class Unreadable(Exception):
    pass


def decode(file: IO[bytes]) -> Image.Image:
    """Pillow only warns between its threshold and twice it, and would decode
    such a file whole: a few hundred kilobytes can take hundreds of megabytes
    in the one process serving the club."""
    try:
        image = Image.open(file)
        # None would switch the guard off, which nothing here does.
        assert Image.MAX_IMAGE_PIXELS is not None
        if image.width * image.height > Image.MAX_IMAGE_PIXELS:
            raise TooManyPixels
        image.load()
    except Image.DecompressionBombError:
        raise TooManyPixels from None
    except OSError:
        raise Unreadable from None
    return image
