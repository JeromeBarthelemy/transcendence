"""ASGI entry point.

ASGI rather than WSGI from the start: Channels needs it, and swapping later
would mean changing how the project is served at the same time as adding
real-time features. One change at a time.

WebSockets go through the same session as the API (AuthMiddlewareStack),
and only from this site's own pages: AllowedHostsOriginValidator is to a
WebSocket what the CSRF check is to a form, since a browser opens one from
any page with the member's cookies.
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
# Before anything that imports models: it sets the app registry up.
django_application = get_asgi_application()

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from club.live import websocket_urlpatterns

application = ProtocolTypeRouter(
    {
        "http": django_application,
        "websocket": AllowedHostsOriginValidator(
            AuthMiddlewareStack(
                URLRouter(websocket_urlpatterns)  # type: ignore[arg-type]
            )
        ),
    }
)
