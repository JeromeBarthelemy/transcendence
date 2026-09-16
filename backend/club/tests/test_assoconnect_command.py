import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from club.tests.builders import MARIE, account, write_export


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
