import pytest
from django.core.cache import cache


# Without this, any test touching the database fails unless it carries
# @pytest.mark.django_db — the classic trap with pytest-django. Most of our
# tests are about models, so every test gets the database.
@pytest.fixture(autouse=True)
def enable_db_access_for_all_tests(db):
    pass


# The login throttle (club/api/throttling.py) counts in Django's cache, which
# a database rollback between tests does not touch — without this, a common
# fixture name like "lina" would carry its attempt count from one test's
# login calls into the next one's, the whole suite running well inside the
# throttle's own window.
@pytest.fixture(autouse=True)
def clear_cache_between_tests():
    cache.clear()
