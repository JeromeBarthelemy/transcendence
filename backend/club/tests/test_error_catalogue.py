import json
import subprocess
import sys
from pathlib import Path

import check_error_codes
import pytest
from check_error_codes import ROOT, catalogue_problems, check_catalogue, declared_codes


def test_extracts_literal_refusal_codes_and_model_and_exception_defaults():
    source = """
# code="comment_only"
description = 'code="text_only"'
raise ValidationError("Message", code="literal")
raise Conflict("Message", code="branch_a" if condition else "branch_b")
raise ErrorDetail("Message", code=exc.code or "invalid")
UniqueConstraint(fields=["name"], violation_error_code="constraint")
class Refusal:
    default_code = "default"
class OtherRefusal:
    default_code: str = "annotated_default"
raise Refused("Message", code=exc.code)
"""
    assert declared_codes(source) == {
        "literal",
        "branch_a",
        "branch_b",
        "invalid",
        "constraint",
        "default",
        "annotated_default",
    }


def test_translated_and_deliberately_fallback_codes_are_accepted():
    assert (
        catalogue_problems(
            {"known", "fallback"},
            {"known": "Traduit."},
            {"fallback": "Use the server sentence."},
        )
        == []
    )


def test_a_new_untranslated_unlisted_code_fails_with_actionable_guidance():
    problems = catalogue_problems({"new_refusal"}, {}, {})
    assert len(problems) == 1
    assert "new_refusal" in problems[0]
    assert "fr.json" in problems[0]
    assert "fallback" in problems[0]


@pytest.mark.parametrize("reason", ["", "   "])
def test_a_fallback_needs_a_real_reason(reason):
    assert (
        "non-empty reason"
        in catalogue_problems({"refusal"}, {}, {"refusal": reason})[0]
    )


def test_a_translated_code_cannot_also_be_a_fallback():
    assert (
        "now has a translation"
        in catalogue_problems(
            {"refusal"}, {"refusal": "Traduit."}, {"refusal": "Reason"}
        )[0]
    )


def test_a_removed_backend_code_cannot_leave_a_stale_fallback():
    assert "stale" in catalogue_problems(set(), {}, {"removed": "Reason"})[0]


def test_an_empty_catalogue_entry_does_not_count_as_a_translation():
    assert (
        "non-empty sentence" in catalogue_problems({"refusal"}, {"refusal": ""}, {})[0]
    )


def write_fixture(root: Path, source: str) -> None:
    (root / "backend").mkdir()
    (root / "backend/refusals.py").write_text(source, encoding="utf-8")
    locales = root / "frontend/src/locales"
    locales.mkdir(parents=True)
    (locales / "fr.json").write_text(
        json.dumps({"errors": {"known": "Traduit."}}), encoding="utf-8"
    )
    (locales / "server-error-fallbacks.json").write_text("{}", encoding="utf-8")


def test_a_new_code_in_an_actual_source_file_fails_the_check(tmp_path):
    write_fixture(tmp_path, 'raise ValidationError("Refus", code="known")')
    assert check_catalogue(tmp_path) == []
    (tmp_path / "backend/refusals.py").write_text(
        'raise ValidationError("Refus", code="new_refusal")', encoding="utf-8"
    )
    assert "new_refusal" in check_catalogue(tmp_path)[0]


def test_test_and_migration_and_environment_codes_are_not_frontend_requirements(
    tmp_path,
):
    write_fixture(tmp_path, 'raise ValidationError("Refus", code="known")')
    for directory in ["tests", "migrations", ".venv", "venv", ".cache"]:
        path = tmp_path / "backend" / directory
        path.mkdir()
        (path / "example.py").write_text('example(code="ignored")', encoding="utf-8")
    assert check_catalogue(tmp_path) == []


def test_real_project_catalogue_has_no_unacknowledged_codes():
    assert check_catalogue() == []


def test_the_command_works_from_outside_the_repository(tmp_path):
    result = subprocess.run(
        [sys.executable, str(ROOT / "backend/check_error_codes.py")],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "translated or documented" in result.stdout


def test_command_returns_a_failing_status_for_an_unacknowledged_code(
    monkeypatch, capsys
):
    monkeypatch.setattr(
        check_error_codes, "check_catalogue", lambda: ["new_refusal: not acknowledged"]
    )
    assert check_error_codes.main() == 1
    assert "new_refusal" in capsys.readouterr().err


def test_command_returns_a_failing_status_if_catalogue_cannot_be_read(
    monkeypatch, capsys
):
    def missing_catalogue():
        raise FileNotFoundError("Missing catalogue")

    monkeypatch.setattr(check_error_codes, "check_catalogue", missing_catalogue)
    assert check_error_codes.main() == 1
    assert "could not run" in capsys.readouterr().err
