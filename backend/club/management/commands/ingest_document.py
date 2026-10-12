"""Feed the rulebook RAG a game manual or official Q&A export."""

from pathlib import Path
from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser

from club.models import Document, Season
from club.rag import ingest_document
from club.sources import PAGE_ENCODING_OF


class Command(BaseCommand):
    help = "Ingère un document (manuel ou Q&A) dans le RAG règlement."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "path", type=Path, help="Le fichier HTML (.htm ou .html) à lire."
        )
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
        source = options["source"]
        if path.suffix.lower() not in (".htm", ".html"):
            # chunk_manual and chunk_qa both read HTML tags (chunk_qa reads
            # the JSON the board's page embeds) — fed a PDF or a .txt,
            # either would find no passage at all and silently ingest zero
            # chunks instead of failing loudly.
            if source == Document.Source.GAME_MANUAL:
                raise CommandError(
                    "Le manuel se lit depuis l'export HTML de FIRST "
                    "(ftc-resources.firstinspires.org/ftc/game/cm-html/...), "
                    "pas un PDF ni un .txt : la structure des règles ne "
                    "survit qu'à l'export HTML."
                )
            raise CommandError(
                "Le Q&A se lit depuis la page HTML du board FIRST "
                "(game-qa.firstinspires.org/boards/.../QA), pas un PDF ni "
                "un .txt : ses réponses ne sont lisibles que dans cet export."
            )
        try:
            season = Season.objects.get(start_year=options["season"])
        except Season.DoesNotExist:
            raise CommandError(f"Saison {options['season']} inconnue.") from None

        text = _read_text(path, source)
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


def _read_text(path: Path, source: str) -> str:
    # handle() already refused anything but .htm/.html before this is
    # called: both chunkers read HTML tags directly (chunk_qa the JSON a
    # board page embeds), never extracted or plain text. Each site
    # declares its own encoding in its own markup — PAGE_ENCODING_OF is
    # the same mapping the live check (club/sources.py) decodes a fetched
    # page with.
    return path.read_text(encoding=PAGE_ENCODING_OF[source])
