from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from club.assoconnect.matching import CLOSE_NAME
from club.models import User
from club.tests.builders import MARIE, account, verified_account, write_export


def test_the_command_verifies_the_account_the_export_states(tmp_path):
    user = account()

    call_command("import_assoconnect", str(write_export(tmp_path, [MARIE])))

    user.refresh_from_db()
    assert user.assoconnect_id == "4521"


def test_the_command_refuses_a_path_that_does_not_exist(tmp_path):
    with pytest.raises(CommandError, match="introuvable"):
        call_command("import_assoconnect", str(tmp_path / "absent.xlsx"))


def test_the_command_refuses_a_file_it_cannot_read(tmp_path):
    path = tmp_path / "export.csv"
    path.write_text("ID participant;Nom participant\n")

    with pytest.raises(CommandError, match="classeur"):
        call_command("import_assoconnect", str(path))


def report(tmp_path, rows):
    """What the command prints for this export."""
    out = StringIO()
    call_command("import_assoconnect", str(write_export(tmp_path, rows)), stdout=out)
    return out.getvalue()


def test_the_report_counts_what_the_import_changed(tmp_path):
    account()

    printed = report(tmp_path, [MARIE])

    assert "1 compte vérifié" in printed
    assert "1 décision" in printed


def test_a_second_import_of_the_same_file_reports_no_change(tmp_path):
    account()
    report(tmp_path, [MARIE])

    printed = report(tmp_path, [MARIE])

    assert "0 compte vérifié" in printed
    assert "0 décision" in printed


def test_the_report_lists_what_needs_a_decision_with_its_reason(tmp_path):
    account(email="lea@example.org", first_name="Léa")

    printed = report(tmp_path, [MARIE])

    assert "À décider" in printed
    assert "4521" in printed
    assert "lea@example.org" in printed
    assert CLOSE_NAME in printed


def test_the_report_lists_the_lines_waiting_for_an_account(tmp_path):
    printed = report(tmp_path, [MARIE])

    assert "En attente" in printed
    assert "Marie Dubois" in printed


def test_the_report_lists_the_members_absent_from_this_export(tmp_path):
    verified_account("9912", email="gone@example.org")

    printed = report(tmp_path, [MARIE])

    assert "Absents de cet export" in printed
    assert "gone@example.org" in printed


def test_the_report_lists_the_accounts_no_line_ties(tmp_path):
    User.objects.create_user("trial@example.org", "trial")

    printed = report(tmp_path, [MARIE])

    assert "Comptes non rattachés (1)" in printed
    assert "trial@example.org" in printed


def test_a_section_with_nothing_in_it_is_not_printed(tmp_path):
    account()

    printed = report(tmp_path, [MARIE])

    assert "À décider" not in printed
    assert "En attente" not in printed
    assert "Absents de cet export" not in printed
    assert "Comptes non rattachés" not in printed
