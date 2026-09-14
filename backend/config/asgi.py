"""ASGI entry point.

ASGI rather than WSGI from the start: Channels needs it, and swapping later
would mean changing how the project is served at the same time as adding
real-time features. One change at a time.
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

application = get_asgi_application()
