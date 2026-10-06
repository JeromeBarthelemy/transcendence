"""Verify the club's accounts against an AssoConnect season export."""

from pathlib import Path
from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser

from club.assoconnect.apply import Applied, apply
from club.assoconnect.export import ExportError, ExportRow, read_export
from club.assoconnect.matching import Reconciliation, reconcile


class Command(BaseCommand):
    help = "Vérifie les comptes du club à partir d'un export AssoConnect."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("export", type=Path, help="Le fichier .xlsx exporté.")

    def handle(self, *args: Any, **options: Any) -> None:
        path = options["export"]
        try:
            rows = read_export(path)
        except FileNotFoundError as missing:
            raise CommandError(f"Fichier introuvable : {path}") from missing
        except ExportError as refused:
            # The reader already says, in French, what the admin must fix.
            raise CommandError(str(refused)) from refused
        reconciliation = reconcile(rows)
        applied = apply(reconciliation)
        self.stdout.write(_report(reconciliation, applied))


def _report(reconciliation: Reconciliation, applied: Applied) -> str:
    """What the import did, then what it leaves the club admin to do."""
    done = (
        _plural(len(applied.verified), "compte vérifié", "comptes vérifiés")
        + ", "
        + _plural(
            len(applied.decided),
            "décision de droit à l'image enregistrée",
            "décisions de droit à l'image enregistrées",
        )
        + "."
    )
    return "\n".join(
        [
            done,
            *_section(
                "À décider",
                [
                    f"{_who(doubt.row)}{doubt.account.email}\n        {doubt.reason}"
                    for doubt in reconciliation.to_decide
                ],
            ),
            *_section(
                "En attente d'un compte",
                [f"{_who(row)}{row.email}" for row in reconciliation.waiting],
            ),
            *_section(
                "Absents de cet export",
                [
                    f"  {account.assoconnect_id:<8}"
                    f"{account.display_name:<22}{account.email}"
                    for account in reconciliation.departed
                ],
            ),
            *_section(
                "Comptes non rattachés",
                [
                    f"  {account.display_name:<22}{account.email}"
                    for account in reconciliation.untied
                ],
            ),
        ]
    )


def _section(title: str, entries: list[str]) -> list[str]:
    """Nothing to say, nothing printed: a faultless import is one line long."""
    if not entries:
        return []
    return ["", f"{title} ({len(entries)})", *entries]


def _who(row: ExportRow) -> str:
    return f"  {row.assoconnect_id:<8}{row.first_name + ' ' + row.last_name:<22}"


def _plural(count: int, singular: str, plural: str) -> str:
    # Zero takes the singular in French.
    return f"{count} {singular if count < 2 else plural}"
