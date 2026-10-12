import pytest
from club.generation import Answer


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
    monkeypatch.setattr(
        "club.rag.generate_answer",
        lambda question, rules: Answer("", [rules[0][0]]),
    )
