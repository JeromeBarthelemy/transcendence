import pytest


# Without this, any test touching the database fails unless it carries
# @pytest.mark.django_db — the classic trap with pytest-django. Most of our
# tests are about models, so every test gets the database.
@pytest.fixture(autouse=True)
def enable_db_access_for_all_tests(db):
    pass
