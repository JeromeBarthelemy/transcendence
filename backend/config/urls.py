"""Root URL configuration.

Only the admin for now: slice 1 is the foundation, and nothing in it is meant
to be seen. The admin is what makes it inspectable while the screens do not
exist yet.
"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path

urlpatterns = [
    path("admin/", admin.site.urls),
]

# Development only. Media files are served by the application server in
# production — and private media must never be served as plain static files,
# since that would bypass the consent check entirely.
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
