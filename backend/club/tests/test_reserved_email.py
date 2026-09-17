from club.models import User
from club.signup import reserved_email


def test_an_address_is_built_from_the_name_on_a_reserved_domain():
    # RFC 2606 reserves .invalid: nothing can ever be delivered there, and
    # the identifier says so on its face.
    assert reserved_email("Marie", "Dubois") == "marie.dubois@rouages.invalid"


def test_accents_and_spaces_are_flattened():
    assert reserved_email("Élodie", "Le Gall") == "elodie.le-gall@rouages.invalid"


def test_a_second_namesake_gets_a_distinct_address():
    # Two Marie Dubois in one club is not a mistake to refuse; it is a
    # collision to number.
    User.objects.create_user("marie.dubois@rouages.invalid", "Marie D.")

    assert reserved_email("Marie", "Dubois") == "marie.dubois2@rouages.invalid"


def test_a_name_that_flattens_to_nothing_still_yields_an_address():
    # A name written only in a script slugify drops must not produce "@domain".
    built = reserved_email("色", "空")

    assert built.endswith("@rouages.invalid")
    assert built.split("@")[0]
