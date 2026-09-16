"""What the AssoConnect tests need to set a scene: an export line, and the
accounts it may or may not find. Shared, because reading and applying an
import are two subjects looking at the same objects."""

from datetime import date

from openpyxl import Workbook

from club.assoconnect.export import ExportRow
from club.models import User, VerificationRequest

BORN = date(2009, 6, 8)
ORDERED_ON = date(2026, 9, 12)


def line(**overrides):
    """One line of an export, Marie's unless told otherwise."""
    fields = {
        "assoconnect_id": "4521",
        "first_name": "Marie",
        "last_name": "Dubois",
        "birth_date": BORN,
        "email": "marie.dubois@example.org",
        "guardian_email": "",
        "image_rights_signed": True,
        "image_rights_refused": False,
        "decided_on": ORDERED_ON,
    }
    return ExportRow(**(fields | overrides))


def account(email="marie@example.org", display_name="Marie", **asked):
    """An account with the verification request it typed at sign-up."""
    user = User.objects.create_user(email, display_name)
    VerificationRequest.objects.create(
        user=user,
        last_name=asked.get("last_name", "Dubois"),
        first_name=asked.get("first_name", "Marie"),
        birth_date=asked.get("birth_date", BORN),
    )
    return user


def verified_account(assoconnect_id="4521", email="verified@example.org"):
    """An account a past import already tied to its membership: it carries the
    member number, and its request is long gone."""
    return User.objects.create_user(
        email, "Déjà vérifiée", assoconnect_id=assoconnect_id, birth_date=BORN
    )


REFUSAL = (
    "Pour plus de facilité, en cas de refus du droit à l'image, merci de "
    "l'indiquer également ici."
)

# The headers the club admin's export carries, in its own order, with two
# columns we never read left in place.
HEADERS = [
    "ID participant",
    "Prénom participant",
    "Nom participant",
    "Date de naissance",
    "Taille de polo",
    "Adresse email",
    "Mail du responsable légal à contacter (si différent du mail principal)",
    "Droit à l'image rempli et signé (formulaire à télécharger sur la première page)",
    REFUSAL,
    "Date de la commande",
    "Equipe à rejoindre",
]

MARIE = {
    "ID participant": "4521",
    "Prénom participant": "Marie",
    "Nom participant": "Dubois",
    "Date de naissance": "08/06/2009",
    "Taille de polo": "M",
    "Adresse email": "marie.dubois@example.org",
    "Mail du responsable légal à contacter (si différent du mail principal)": (
        "claire.dubois@example.org"
    ),
    "Droit à l'image rempli et signé (formulaire à télécharger sur la première page)": (
        "https://assoconnect.example/doc/4521"
    ),
    REFUSAL: "",
    "Date de la commande": "12/09/2026",
    "Equipe à rejoindre": "Les Robotiqueurs",
}


def write_export(tmp_path, rows, headers=None):
    """An export built in memory: a versioned .xlsx would be a blob nobody can
    read in a diff."""
    headers = HEADERS if headers is None else headers
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(headers)
    for row in rows:
        sheet.append([row.get(header, "") for header in headers])
    path = tmp_path / "export.xlsx"
    workbook.save(path)
    return path
