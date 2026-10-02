from django.test import override_settings


def test_health_check(client):
    response = client.get("/api/health/", secure=True)

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_check_rejects_post(client):
    response = client.post("/api/health/", secure=True)

    assert response.status_code == 405


@override_settings(SECURE_SSL_REDIRECT=True)
def test_health_check_is_exempt_from_the_https_redirect(client):
    # compose.prod.yml's healthcheck calls this in plain HTTP, straight to
    # Daphne, never through the proxy — SECURE_SSL_REDIRECT (on whenever
    # DEBUG is off) would otherwise send it a 301 to an HTTPS URL on a port
    # that only ever speaks plain HTTP, and the healthcheck would never see
    # a 200 again. Only SECURE_SSL_REDIRECT is overridden here, not
    # SECURE_REDIRECT_EXEMPT: that way this exercises the real value in
    # settings.py, and actually fails if that line is ever lost.
    response = client.get("/api/health/")

    assert response.status_code == 200


@override_settings(SECURE_SSL_REDIRECT=True)
def test_only_the_health_check_is_exempt_from_the_https_redirect(client):
    response = client.get("/admin/")

    assert response.status_code == 301
    assert response.url.startswith("https://")
