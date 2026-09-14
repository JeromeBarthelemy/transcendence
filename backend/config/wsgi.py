"""WSGI entry point, kept for management commands and plain HTTP serving.

The project is served through ASGI (see asgi.py); this module exists because
some tooling still expects it.
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

application = get_wsgi_application()
