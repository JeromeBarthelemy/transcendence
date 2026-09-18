"""The project's URL map. One instance serves one club, so there is no
per-client routing: the admin, and in development the media files."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import URLPattern, URLResolver, path

from config.views import health_check

urlpatterns: list[URLPattern | URLResolver] = [
    path("api/health/", health_check, name="api-health"),
    path("admin/", admin.site.urls),
]

# Development only: private media must never be served as plain static files,
# since that would bypass the consent check.
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
