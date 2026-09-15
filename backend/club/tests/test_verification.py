from datetime import date

import pytest
from django.db import IntegrityError

from club.models import User, VerificationRequest


def test_an_account_has_at_most_one_verification_request():
    # The request is what sign-up typed to match the AssoConnect export; a
    # second one would leave the import unsure which to believe.
    ada = User.objects.create_user("ada@club.fr", "Ada")
    VerificationRequest.objects.create(
        user=ada, last_name="Lovelace", first_name="Ada", birth_date=date(2008, 12, 10)
    )

    with pytest.raises(IntegrityError):
        VerificationRequest.objects.create(
            user=ada,
            last_name="Lovelace",
            first_name="Ada",
            birth_date=date(2008, 12, 10),
        )
