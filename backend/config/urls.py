"""The project's URL map. One instance serves one club, so there is no
per-client routing: the API and the admin.

No media URL, not even in development: every uploaded file is private and
reaches the browser through a view that checks who is asking."""

from django.contrib import admin
from django.urls import URLPattern, URLResolver, include, path

from config.views import health_check

urlpatterns: list[URLPattern | URLResolver] = [
    path("api/health/", health_check, name="api-health"),
    path("api/", include("club.api.urls")),
    path("admin/", admin.site.urls),
]
