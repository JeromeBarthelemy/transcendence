from datetime import date

import pytest
from openpyxl import Workbook

from club.assoconnect.export import ExportError, read_export

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


def test_a_row_becomes_a_member_of_the_season(tmp_path):
    (member,) = read_export(write_export(tmp_path, [MARIE]))

    assert member.assoconnect_id == "4521"
    assert member.first_name == "Marie"
    assert member.last_name == "Dubois"
    assert member.birth_date == date(2009, 6, 8)
    assert member.email == "marie.dubois@example.org"
    assert member.guardian_email == "claire.dubois@example.org"
    assert member.image_rights_signed is True
    assert member.image_rights_refused is False
    assert member.decided_on == date(2026, 9, 12)


def test_a_real_date_cell_is_read_like_a_typed_one(tmp_path):
    path = write_export(tmp_path, [MARIE | {"Date de naissance": date(2009, 6, 8)}])

    (member,) = read_export(path)

    assert member.birth_date == date(2009, 6, 8)


def test_any_value_in_the_refusal_box_counts_as_a_refusal(tmp_path):
    path = write_export(tmp_path, [MARIE | {REFUSAL: "Je refuse"}])

    (member,) = read_export(path)

    assert member.image_rights_refused is True


def test_a_missing_expected_column_stops_the_import(tmp_path):
    headers = [header for header in HEADERS if header != "Date de naissance"]
    path = write_export(tmp_path, [MARIE], headers=headers)

    with pytest.raises(ExportError, match="Date de naissance"):
        read_export(path)


def test_an_unreadable_birth_date_stops_the_import(tmp_path):
    path = write_export(tmp_path, [MARIE | {"Date de naissance": "8 juin 2009"}])

    with pytest.raises(ExportError, match="Ligne 2"):
        read_export(path)


def test_a_row_without_a_member_number_stops_the_import(tmp_path):
    path = write_export(tmp_path, [MARIE | {"ID participant": ""}])

    with pytest.raises(ExportError, match="Ligne 2"):
        read_export(path)


def test_a_member_number_used_twice_stops_the_import(tmp_path):
    path = write_export(tmp_path, [MARIE, MARIE | {"Prénom participant": "Léa"}])

    with pytest.raises(ExportError, match="4521"):
        read_export(path)


def test_a_file_without_a_single_line_stops_the_import(tmp_path):
    path = tmp_path / "export.xlsx"
    Workbook().save(path)

    with pytest.raises(ExportError, match="vide"):
        read_export(path)


def test_a_file_that_is_not_a_workbook_stops_the_import(tmp_path):
    path = tmp_path / "export.csv"
    path.write_text("ID participant;Nom participant\n4521;Dubois\n")

    with pytest.raises(ExportError, match="classeur"):
        read_export(path)


def test_a_file_that_only_claims_to_be_a_workbook_stops_the_import(tmp_path):
    path = tmp_path / "export.xlsx"
    path.write_text("ID participant;Nom participant\n4521;Dubois\n")

    with pytest.raises(ExportError, match="classeur"):
        read_export(path)


def test_a_member_number_stored_as_a_number_reads_as_text(tmp_path):
    path = write_export(tmp_path, [MARIE | {"ID participant": 4521}])

    (member,) = read_export(path)

    assert member.assoconnect_id == "4521"
