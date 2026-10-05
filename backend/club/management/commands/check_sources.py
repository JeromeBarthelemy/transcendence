"""Check the rulebook's sources against their official pages, once a day in
production (the `sources-check` service in compose.prod.yml)."""

from typing import Any

from django.core.management.base import BaseCommand

from club.sources import check_all, latest_documents


class Command(BaseCommand):
    help = "Vérifie le manuel et le Q&A contre leur page officielle."

    def handle(self, *args: Any, **options: Any) -> None:
        for outcome in check_all(latest_documents()):
            document = outcome.document
            detail = f" — {outcome.detail}" if outcome.detail else ""
            self.stdout.write(f"« {document.title} » : {outcome.status}{detail}")
