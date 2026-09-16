"""Verify the club's accounts against an AssoConnect season export."""

from pathlib import Path
from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser

from club.assoconnect.apply import apply
from club.assoconnect.export import ExportError, read_export
from club.assoconnect.matching import reconcile


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
        apply(reconciliation)
        self.stdout.write(f"{len(reconciliation.matched)} adhérent(s) rapproché(s).")
