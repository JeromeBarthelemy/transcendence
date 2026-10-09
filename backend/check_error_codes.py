"""Check repo-defined refusal codes against the frontend error catalogue.

Read Python syntax, without importing Django or executing application code.
Framework codes forwarded dynamically (e.g. exc.code) belong to Django/DRF;
this check covers literal code=, violation_error_code= and default_code values.
"""

import ast
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def literal_codes(node: ast.AST) -> set[str]:
    """Also find literals in a conditional or a forwarded-code fallback."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return {node.value}
    if isinstance(node, ast.IfExp):
        return literal_codes(node.body) | literal_codes(node.orelse)
    if isinstance(node, ast.BoolOp):
        return set().union(*(literal_codes(value) for value in node.values))
    return set()


def declared_codes(source: str) -> set[str]:
    codes: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.keyword) and node.arg in {
            "code",
            "violation_error_code",
        }:
            codes.update(literal_codes(node.value))
        elif isinstance(node, ast.Assign):
            if any(
                isinstance(target, ast.Name) and target.id == "default_code"
                for target in node.targets
            ):
                codes.update(literal_codes(node.value))
        elif (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Name)
            and node.target.id == "default_code"
            and node.value is not None
        ):
            codes.update(literal_codes(node.value))
    return codes


def catalogue_problems(
    codes: set[str], translations: dict[str, str], fallbacks: dict[str, str]
) -> list[str]:
    problems = [
        f"{code}: add errors.{code} to fr.json or document its server-message fallback"
        for code in sorted(codes - translations.keys() - fallbacks.keys())
    ]
    problems.extend(
        f"{code}: the server-message fallback needs a non-empty reason"
        for code, reason in sorted(fallbacks.items())
        if not isinstance(reason, str) or not reason.strip()
    )
    problems.extend(
        f"{code}: remove the fallback declaration; the code now has a translation"
        for code in sorted(translations.keys() & fallbacks.keys())
    )
    problems.extend(
        f"{code}: remove the stale fallback declaration; no backend code declares it"
        for code in sorted(fallbacks.keys() - codes)
    )
    problems.extend(
        f"{code}: the catalogue translation must be a non-empty sentence"
        for code in sorted(codes & translations.keys())
        if not isinstance(translations[code], str) or not translations[code].strip()
    )
    return problems


def check_catalogue(root: Path = ROOT) -> list[str]:
    codes: set[str] = set()
    for path in sorted((root / "backend").rglob("*.py")):
        if {"tests", "migrations", ".venv", "venv", ".cache"}.intersection(
            path.relative_to(root / "backend").parts
        ) or path.name.startswith("test_"):
            continue
        codes.update(declared_codes(path.read_text(encoding="utf-8")))
    translations = json.loads(
        (root / "frontend/src/locales/fr.json").read_text(encoding="utf-8")
    )["errors"]
    fallbacks = json.loads(
        (root / "frontend/src/locales/server-error-fallbacks.json").read_text(
            encoding="utf-8"
        )
    )
    return catalogue_problems(codes, translations, fallbacks)


def main() -> int:
    try:
        problems = check_catalogue()
    except (OSError, ValueError, SyntaxError, KeyError) as error:
        print(f"Error catalogue check could not run: {error}", file=sys.stderr)
        return 1
    if problems:
        print("Error catalogue check failed:", file=sys.stderr)
        for problem in problems:
            print(f"- {problem}", file=sys.stderr)
        return 1
    print("Error catalogue: every declared backend code is translated or documented.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
