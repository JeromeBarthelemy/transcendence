def test_health_check(client):
    response = client.get("/api/health/", secure=True)

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_check_rejects_post(client):
    response = client.post("/api/health/", secure=True)

    assert response.status_code == 405
