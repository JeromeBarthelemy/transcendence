"""Ranging the export's lines against the club's accounts.

Nothing is written here: this pass only says what the import may do, so that
what it decides can be shown to the club admin before anything happens.
"""

import unicodedata
from dataclasses import dataclass

from club.models import User, VerificationRequest

from .export import ExportRow

# Read by the club admin on the screen that asks them to decide.
CLOSE_NAME = "Même date de naissance, et un seul des deux noms identique."
SEVERAL_ACCOUNTS = "Plusieurs comptes déclarent ces nom, prénom et date de naissance."
DISPUTED_NUMBER = "Ce numéro d'adhérent est déjà rattaché à un autre compte."


@dataclass(frozen=True)
class Match:
    """A line and the account it belongs to."""

    row: ExportRow
    account: User


@dataclass(frozen=True)
class Doubt:
    """A line, an account that could be it, and why nobody but the club admin
    can settle it."""

    row: ExportRow
    account: User
    reason: str


@dataclass(frozen=True)
class Reconciliation:
    """What one export says about the club's accounts, ranged."""

    matched: list[Match]
    to_decide: list[Doubt]
    waiting: list[ExportRow]
    departed: list[User]
    untied: list[User]


def reconcile(rows: list[ExportRow]) -> Reconciliation:
    """What the club's accounts become in the light of this export: which
    lines go home by themselves, which need the club admin, which wait for an
    account to exist, who this season no longer states, and which accounts no
    line reaches at all."""
    # The whole roster at once: a club counts its members in dozens, and the
    # names are compared in Python, where accents and hyphens can be ignored.
    requests = list(VerificationRequest.objects.select_related("user"))
    matched: list[Match] = []
    to_decide: list[Doubt] = []
    waiting: list[ExportRow] = []

    for row in rows:
        # The member number is stable from season to season, so a line that
        # already has one goes home without its names being read at all.
        carrier = _carrying(row.assoconnect_id)
        claimants = [
            request.user
            for request in requests
            if _says_this_person(request, row) and request.user != carrier
        ]
        if carrier is not None:
            # Someone else typed this very person at sign-up: two people claim
            # one membership, and only the club can say whose it is.
            if claimants:
                to_decide += [
                    Doubt(row, account, DISPUTED_NUMBER) for account in claimants
                ]
            else:
                matched.append(Match(row, carrier))
        elif len(claimants) == 1:
            matched.append(Match(row, claimants[0]))
        elif claimants:
            to_decide += [
                Doubt(row, account, SEVERAL_ACCOUNTS) for account in claimants
            ]
        else:
            neighbours = [
                request.user for request in requests if _looks_like(request, row)
            ]
            if neighbours:
                to_decide += [Doubt(row, account, CLOSE_NAME) for account in neighbours]
            else:
                waiting.append(row)

    return Reconciliation(
        matched=matched,
        to_decide=to_decide,
        waiting=waiting,
        departed=_departed(rows),
        untied=_untied(matched, to_decide),
    )


def _carrying(assoconnect_id: str) -> User | None:
    """The account a past import already tied to this member number."""
    return User.objects.filter(assoconnect_id=assoconnect_id).first()


def _says_this_person(request: VerificationRequest, row: ExportRow) -> bool:
    """Both names and the birth date, the three the sign-up form asks for."""
    return (
        _key(request.last_name) == _key(row.last_name)
        and _key(request.first_name) == _key(row.first_name)
        and request.birth_date == row.birth_date
    )


def _looks_like(request: VerificationRequest, row: ExportRow) -> bool:
    """Same birth date and one of the two names: close enough to be worth a
    human's look, far enough from a coincidence to be worth their time."""
    return request.birth_date == row.birth_date and (
        _key(request.last_name) == _key(row.last_name)
        or _key(request.first_name) == _key(row.first_name)
    )


def _departed(rows: list[ExportRow]) -> list[User]:
    """Verified members this export no longer states. Nothing is deactivated:
    late renewals are common, and the club admin decides when a period is over.
    """
    return list(
        User.objects.exclude(assoconnect_id=None).exclude(
            assoconnect_id__in=[row.assoconnect_id for row in rows]
        )
    )


def _untied(matched: list[Match], to_decide: list[Doubt]) -> list[User]:
    """Active accounts no member number ties and no line claims, even closely:
    the club admin ties them by hand, lets them wait, or deactivates them."""
    claimed = [match.account.pk for match in matched] + [
        doubt.account.pk for doubt in to_decide
    ]
    return list(
        User.objects.filter(assoconnect_id=None, is_active=True).exclude(pk__in=claimed)
    )


def _key(name: str) -> str:
    """Names are typed twice — once at sign-up, once by the club — so they are
    compared without what typing changes: case, accents, hyphens, apostrophes
    and double spaces."""
    without_accents = "".join(
        letter
        for letter in unicodedata.normalize("NFKD", name)
        if not unicodedata.combining(letter)
    )
    return " ".join(without_accents.lower().replace("-", " ").replace("'", " ").split())
