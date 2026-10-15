import pytest
from club.presence import _open_sockets
from django.core.cache import cache


# DRF's throttles (club/api/views.py, LoginView) count requests in the
# default cache, which outlives any one test's own transaction rollback —
# without this, a test that trips the throttle would leave it tripped for
# whichever test runs next.
@pytest.fixture(autouse=True)
def clear_throttle_cache():
    cache.clear()


# Online status (club/presence.py, #267) counts open sockets in a plain
# module-level dict, which outlives any one test's own transaction rollback
# too — without this, a socket left "open" by a test that never
# disconnected it would leave that member online for whichever test runs
# next.
@pytest.fixture(autouse=True)
def clear_presence():
    _open_sockets.clear()


# Without this, any test touching the database fails unless it carries
# @pytest.mark.django_db — the classic trap with pytest-django. Most of our
# tests are about models, so every test gets the database.
@pytest.fixture(autouse=True)
def enable_db_access_for_all_tests(db):
    pass


# No test here is about to reach a real Ollama: without this, `ask()` would
# retry a real HTTP call against RAG_OLLAMA_URL and only fail (slowly, up to
# GENERATION_TIMEOUT_SECONDS) once no server answers. Mirrors what that
# failure already degrades to, so existing `ask()` tests read the same as
# before generation existed; a test about generation itself overrides this.
@pytest.fixture(autouse=True)
def stub_rag_generation(monkeypatch):
    monkeypatch.setattr("club.rag.generate_answer", lambda question, chunks: "")


# Production's hasher is slow on purpose, against guessing; tests sign
# hundreds of members up and in, and would spend most of their time on it.
@pytest.fixture(autouse=True)
def fast_password_hasher(settings):
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
