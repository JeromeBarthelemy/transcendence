from config.settings import hosts_of


def test_a_dev_origin_lets_its_address_open_the_live_socket_too():
    # The live socket checks its Origin against ALLOWED_HOSTS, not against
    # the CSRF origins: one line in DJANGO_DEV_ORIGINS must cover both.
    origins = ["http://localhost:5173", "http://192.168.1.40:5173"]

    assert hosts_of(origins) == ["localhost", "192.168.1.40"]
