"""Plain-text data-rights mail in the language of the member's request.

The browser's language is not an account preference. API callers choose one
of these languages; older callers and administrative deletions use French.
Keep the four texts together so every language supplies both complete mails.
"""

from dataclasses import dataclass

DATA_EMAIL_LANGUAGES = ("fr", "en", "es")
DEFAULT_DATA_EMAIL_LANGUAGE = "fr"


@dataclass(frozen=True)
class DataEmailCopy:
    export_subject: str
    export_body: str
    deletion_subject: str
    deletion_body: str


_COPY = {
    "fr": DataEmailCopy(
        export_subject="Export de vos données — Fieldnotes",
        export_body=(
            "Bonjour,\n\n"
            "Voici l'export des données du compte « {display_name} », "
            "en pièce jointe, au format lisible (JSON).\n"
        ),
        deletion_subject="Suppression de compte confirmée — Fieldnotes",
        deletion_body=(
            "Bonjour,\n\n"
            "Le compte « {display_name} » a été supprimé à sa demande : "
            "son identité a été effacée. Ce qu'il a écrit reste dans le "
            "cahier de l'équipe.\n"
        ),
    ),
    "en": DataEmailCopy(
        export_subject="Your data export — Fieldnotes",
        export_body=(
            "Hello,\n\n"
            'The data export for the account "{display_name}" is attached '
            "in a readable format (JSON).\n"
        ),
        deletion_subject="Account deletion confirmed — Fieldnotes",
        deletion_body=(
            "Hello,\n\n"
            'The account "{display_name}" has been deleted as requested: '
            "its identifying information has been erased. What the member "
            "wrote remains in the team's notebook.\n"
        ),
    ),
    "es": DataEmailCopy(
        export_subject="Exportación de tus datos — Fieldnotes",
        export_body=(
            "Hola:\n\n"
            "Se adjunta la exportación de los datos de la cuenta «{display_name}» "
            "en un formato legible (JSON).\n"
        ),
        deletion_subject="Eliminación de la cuenta confirmada — Fieldnotes",
        deletion_body=(
            "Hola:\n\n"
            "La cuenta «{display_name}» se ha eliminado según lo solicitado: "
            "se han borrado sus datos identificativos. Lo que escribió "
            "el miembro permanece en el cuaderno del equipo.\n"
        ),
    ),
}


def data_email_copy(language: str) -> DataEmailCopy:
    # API input is validated before acting; direct/internal callers retain
    # the club's default rather than depending on Django's ambient locale.
    return _COPY.get(language, _COPY[DEFAULT_DATA_EMAIL_LANGUAGE])
