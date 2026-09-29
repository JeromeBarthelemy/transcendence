"""Feed the rulebook RAG a game manual or official Q&A export."""

from pathlib import Path
from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser
from pypdf import PdfReader

from club.models import Document, Season
from club.rag import ingest_document


class Command(BaseCommand):
    help = "Ingère un document (manuel ou Q&A) dans le RAG règlement."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("path", type=Path, help="Le fichier .pdf ou .txt à lire.")
        parser.add_argument(
            "--season", type=int, required=True, help="L'année de début de la saison."
        )
        parser.add_argument(
            "--source",
            choices=[choice.value for choice in Document.Source],
            required=True,
        )
        parser.add_argument("--title", required=True)
        parser.add_argument("--url", default="")

    def handle(self, *args: Any, **options: Any) -> None:
        path: Path = options["path"]
        if not path.exists():
            raise CommandError(f"Fichier introuvable : {path}")
        try:
            season = Season.objects.get(start_year=options["season"])
        except Season.DoesNotExist:
            raise CommandError(f"Saison {options['season']} inconnue.") from None

        text = _read_text(path)
        if not text.strip():
            raise CommandError("Le fichier ne contient aucun texte lisible.")

        document = ingest_document(
            season=season,
            source=options["source"],
            title=options["title"],
            text=text,
            url=options["url"],
        )
        self.stdout.write(
            f"« {document.title} » ingéré : {document.chunks.count()} passages."
        )


def _read_text(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        reader = PdfReader(str(path))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        # A .txt someone saved from Notepad on the club's own Windows
        # machine, most likely — never the PDF, which pypdf always hands
        # back as a real str regardless of the platform reading it.
        return path.read_text(encoding="cp1252")
