"""Fill an empty database with a demo club: what a fresh install, a teammate's
clone or an evaluator's machine shows instead of empty screens. Never for the
club's own instance, whose data is real."""

from datetime import date, datetime, time, timedelta
from typing import Any

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from club.models import (
    Consent,
    Entry,
    Membership,
    Season,
    Team,
    TeamSeason,
    User,
    VerificationRequest,
    WorkItem,
    WorkshopSlot,
    fold_title,
)
from club.progress import join, record_progress
from club.workdays import workday

PASSWORD = "rouage-demo-2026"
DOMAIN = "demo.invalid"
WEEKS = 4

Step = Entry.Step
Weekday = WorkshopSlot.Weekday

# The slots the concept note describes, start and end. Entries are dated at
# most 105 minutes after the start, so within even the two-hour Friday slot.
SLOTS = {
    Weekday.WEDNESDAY: (time(14), time(17)),
    Weekday.FRIDAY: (time(17), time(19)),
}

TEAMS = [
    (24601, "Rouages", ["Lina", "Tom", "Inès"]),
    (25317, "Court-Circuit", ["Hugo", "Chloé", "Maël"]),
    (26088, "Les Boulons", ["Jade", "Nathan", "Emma"]),
    (27442, "Engrenage", ["Lucas", "Sarah", "Yanis"]),
]
ADMIN, MENTOR = "Paul", "Claire"
# The one refusal of image rights, and the one account AssoConnect has not
# confirmed yet: both cases exist in a real club, so the demo has them.
REFUSED, UNVERIFIED = "Jade", "Yanis"

# One step per progress, in order: the intake goes back to prototyping after
# a failed test zero, which is what iterating looks like to a judge.
ROBOT = {
    "Intake": [Step.PROTOTYPING, Step.BUILDING, Step.TEST_ZERO, Step.PROTOTYPING],
    "Bras": [Step.BRAINSTORMING, Step.PROTOTYPING, Step.PROTOTYPING, Step.BUILDING],
    "Châssis": [Step.BUILDING, Step.INTEGRATION, Step.TUNING, Step.TUNING],
}
OFF_ROBOT = "Dossier de sponsoring"
SUGGESTED = "Vision"
DONE = "Châssis"

SAID = {
    Step.BRAINSTORMING: "Trois idées au tableau, on garde la plus simple à construire.",
    Step.PROTOTYPING: "Maquette en carton et impression 3D rapide pour valider les cotes.",
    Step.BUILDING: "Montage des pièces définitives, deux vis à remplacer.",
    Step.DRY_TESTS: "Essais moteur coupé : le mouvement est libre sur toute la course.",
    Step.INTEGRATION: "Monté sur le robot, câblage refait proprement.",
    Step.TEST_ZERO: "Premier essai sur le terrain : ça accroche, il faut revoir la prise.",
    Step.TUNING: "Réglage des vitesses, le robot tient la ligne droite.",
    Step.REPAIR: "Pièce cassée remplacée.",
}
SPONSORING = [
    "Liste des entreprises du coin à contacter.",
    "Première version du dossier, il manque les photos du robot.",
    "Deux réponses positives, rendez-vous à caler.",
]


class Command(BaseCommand):
    help = "Remplit une base vide avec un club de démonstration."

    def handle(self, *args: Any, **options: Any) -> None:
        if User.objects.exists() or Team.objects.exists() or Season.objects.exists():
            raise CommandError(
                "La base contient déjà des données : seed_demo ne remplit "
                "qu'une base vide, et n'écrase jamais rien."
            )
        with transaction.atomic():
            Demo(workday(timezone.now())).build()
        self.stdout.write(
            f"Club de démonstration créé. Mot de passe de tous les comptes : "
            f"{PASSWORD}\nAdministrateur : {ADMIN} · mentor : {MENTOR} · élèves : "
            + ", ".join(name for _, _, students in TEAMS for name in students)
        )


class Demo:
    def __init__(self, today: date) -> None:
        self.today = today
        # Hashed once for every account: hashing is slow on purpose.
        self.password = make_password(PASSWORD)
        self.first = today - timedelta(weeks=WEEKS)
        # Today is left out: its slot may not have happened yet.
        self.slot_days = [
            self.first + timedelta(days=n)
            for n in range((today - self.first).days)
            if (self.first + timedelta(days=n)).weekday() in SLOTS
        ]

    def build(self) -> None:
        start_year = self.today.year if self.today.month >= 9 else self.today.year - 1
        season = Season.objects.create(start_year=start_year, game_name="BioBuzz")
        for weekday, (start, end) in SLOTS.items():
            WorkshopSlot.objects.create(
                season=season,
                weekday=weekday,
                start_time=start,
                end_time=end,
                valid_from=self.first,
            )
        self.mentor = self.person(MENTOR, 0, club_role=User.ClubRole.MENTOR)
        self.person(ADMIN, 1, club_role=User.ClubRole.MENTOR, is_club_admin=True)
        number = 2
        for rank, (team_number, name, students) in enumerate(TEAMS):
            team = Team.objects.create(number=team_number, name=name)
            team_season = TeamSeason.objects.create(team=team, season=season)
            members = []
            for student in students:
                members.append(self.person(student, number))
                number += 1
                Membership.objects.create(user=members[-1], team_season=team_season)
            self.season_of(team_season, members, rank)

    def person(self, name: str, number: int, **extra: Any) -> User:
        slug = fold_title(name)
        student = extra.get("club_role", User.ClubRole.STUDENT) == User.ClubRole.STUDENT
        born = date(self.today.year - (13 + number % 5 if student else 45), 3, 14)
        user = User.objects.create_user(f"{slug}@{DOMAIN}", name, **extra)
        user.password = self.password
        user.save(update_fields=["password"])
        if name == UNVERIFIED:
            VerificationRequest.objects.create(
                user=user, last_name="Martin", first_name=name, birth_date=born
            )
            return user
        user.assoconnect_id = str(1000 + number)
        user.birth_date = born
        user.contact_email = f"parent.{slug}@{DOMAIN}" if student else user.email
        user.save(update_fields=["assoconnect_id", "birth_date", "contact_email"])
        Consent.objects.create(
            user=user,
            decision=Consent.Decision.REFUSED
            if name == REFUSED
            else Consent.Decision.GRANTED,
            granted_by=Consent.GrantedBy.LEGAL_GUARDIAN
            if student
            else Consent.GrantedBy.SELF,
            decided_at=self.moment(self.first, time(12)),
        )
        return user

    def season_of(
        self, team_season: TeamSeason, members: list[User], rank: int
    ) -> None:
        items = {
            title: WorkItem.objects.create(
                team_season=team_season,
                title=title,
                on_robot=True,
                status=WorkItem.Status.SUGGESTED,
            )
            for title in ROBOT
        }
        sponsoring = WorkItem.objects.create(
            team_season=team_season,
            title=OFF_ROBOT,
            status=WorkItem.Status.SUGGESTED,
        )
        WorkItem.objects.create(
            team_season=team_season,
            title=SUGGESTED,
            on_robot=True,
            status=WorkItem.Status.SUGGESTED,
        )
        titles = list(ROBOT)
        done = {title: 0 for title in ROBOT}
        active = 0
        for index, day in enumerate(self.slot_days):
            # One slot day in four without progress, not the same for every
            # team: the gaps a mentor is meant to notice.
            if (index + rank) % 4 == 3:
                continue
            at = SLOTS[Weekday(day.weekday())][0]
            for turn in range(2):
                title = titles[(2 * active + turn) % len(titles)]
                path = ROBOT[title]
                step = path[done[title]] if done[title] < len(path) else None
                done[title] += 1
                author = members[(active + turn) % len(members)]
                entry = record_progress(
                    items[title],
                    author,
                    SAID[step or Step.TUNING],
                    step=step,
                    # The Friday crew leaves word for Wednesday's.
                    handover="Reprendre là où on s'est arrêté, pièces dans le bac."
                    if day.weekday() == Weekday.FRIDAY
                    else "",
                )
                join(entry, members[(active + turn + 1) % len(members)])
                self.date(entry, day, at, minutes=30 * (turn + 1))
            if active % 2 == 0:
                entry = record_progress(
                    sponsoring,
                    members[active % len(members)],
                    SPONSORING[(active // 2) % len(SPONSORING)],
                )
                self.date(entry, day, at, minutes=90)
            if active == 1:
                note = Entry.objects.create(
                    team_season=team_season,
                    author=members[0],
                    type=Entry.Type.NOTE,
                    body="Penser à charger les batteries avant vendredi.",
                )
                self.date(note, day, at, minutes=105)
            if active == 3:
                note = Entry.objects.create(
                    team_season=team_season,
                    author=self.mentor,
                    work_item=items["Intake"],
                    type=Entry.Type.NOTE,
                    body="Regardez comment les autres équipes guident la balle.",
                )
                self.date(note, day, at, minutes=105)
            active += 1
        for item in [*items.values(), sponsoring]:
            first = item.entries.order_by("occurred_at").first()
            if first is not None:
                item.opened_at = first.occurred_at
                item.save(update_fields=["opened_at"])
        closed = items[DONE]
        last = closed.entries.order_by("occurred_at").last()
        closed.status = WorkItem.Status.DONE
        closed.closed_at = (
            last.occurred_at if last else self.moment(self.today, time(12))
        )
        closed.save(update_fields=["status", "closed_at"])

    def moment(self, day: date, at: time, minutes: int = 0) -> datetime:
        return timezone.make_aware(datetime.combine(day, at)) + timedelta(
            minutes=minutes
        )

    def date(self, entry: Entry, day: date, at: time, minutes: int = 0) -> None:
        """Everything the application writes is dated now; a demo that reads
        as written on the day needs both dates moved together."""
        when = self.moment(day, at, minutes)
        Entry.objects.filter(pk=entry.pk).update(occurred_at=when, created_at=when)
