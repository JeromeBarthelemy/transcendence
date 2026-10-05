# transcendence

Web application for a FIRST Tech Challenge robotics club: teams, members,
matches and the engineering notebook. *ft_transcendence*, 42 common core.

Fieldnotes is a private working application, separate from the club's public
website. It records the teams' real work throughout the season so that it can
later be cited in the engineering portfolio.

One deployment serves one club, locally. The code is English, the interface
is French: model, field and function names, comments and docstrings are
English. Django keeps French labels for its own administration interface;
user-facing application text belongs to the frontend translation catalogue.

## Technical stack

### Frontend framework decision

The frontend framework is **React with TypeScript**, built with **Vite**.

React satisfies the subject's definition in the context of this project:

- **Structured architecture and conventions:** the application will be
  divided into routes, feature modules, reusable components, API clients and
  typed domain models.
- **Common application features:** React provides component rendering and
  state-management primitives; React Router handles routing, and TanStack
  Query handles API state, caching and invalidation.
- **Complete ecosystem:** React has established solutions for forms,
  validation, internationalization, testing, accessibility and PWA support.
  The subject also explicitly lists React as an accepted frontend framework.

Vite was selected instead of a full-stack React framework because Fieldnotes
is a private application, separate from the club's public website. It does not
require SEO or server-side rendering, while Django remains the single backend.

The frontend foundation installed by the initial skeleton is:

- **React and TypeScript** for the user interface and typed frontend
  contracts.
- **Vite** for the development server and production build.
- **React Router** for URL-based navigation and protected screens.
- **TanStack Query** for Django API requests, caching, loading states and cache
  invalidation.
- **react-i18next** for the centralized French user-interface catalogue.
- **Tailwind CSS** as the responsive styling foundation. The custom design
  system module will still require at least ten reusable components built on
  top of it.

**React Hook Form and Zod** validate the account forms in the browser, while
**Vitest and React Testing Library** exercise their user flows. The PWA will
add **vite-plugin-pwa/Workbox and IndexedDB** when it needs durable offline
support. IndexedDB will store pending progress entries; TanStack Query's
cache alone is not durable offline storage.

The backend stack is:

- **Django** as the backend framework.
- **Django REST Framework** for the JSON API.
- **Django Channels** for real-time features.
- **SQLite** as the local database.
- **Redis only if Channels runs with multiple workers.**
- **Docker Compose** for single-command deployment.

Together, React and Django satisfy the major *framework for both frontend and
backend* module. Django's ORM separately satisfies the ORM minor module.

### Language and API errors

The product interface is French, while source-code identifiers and API error
codes are English.

All user-facing frontend text belongs to the react-i18next French catalogue.
The Django administration interface may keep its existing French labels. API
validation failures return stable, machine-readable codes alongside French
messages, grouped by field:

```json
{
  "email": [
    {
      "code": "email_taken",
      "message": "Cette adresse est déjà utilisée."
    }
  ]
}
```

A refusal that names no field arrives under one of two other keys, and a
front end that only reads field names would miss both:

```json
{ "non_field_errors": [ { "code": "bad_credentials", "message": "…" } ] }
{ "detail": { "code": "permission_denied", "message": "…" } }
```

The backend's validation message is the reference wording. The frontend
catalogue mirrors it under the same `code` and displays it beside the field
named by the response. When a backend message changes, update its catalogue
entry in the same change. Unknown codes fall back to a generic French message.

Django remains responsible for validation, permissions, HTTP status codes and
preventing invalid operations. React is responsible for presenting API errors.

## Getting started

### Complete development stack with Docker Compose

Docker Compose starts Django and Vite together. Create the local backend
environment once, then start the stack with one command:

```sh
cp backend/.env.example backend/.env
# Fill in DJANGO_SECRET_KEY — see the comment in the file.
docker compose up --build
```

Open <http://localhost:5173/> for the landing, sign-up and log-in pages. Vite
proxies `/api` to Django, so the browser keeps one origin for session and CSRF
cookies. The Django admin remains available at <http://localhost:8000/admin/>.

This Compose stack is for development and proves the frontend/backend
integration — `runserver`, Vite's dev server, `DEBUG=true`, no certificate.

#### From a phone on the same Wi-Fi

For a supervised trial in the club's room, before the HTTPS stack: a phone
opens Vite on the laptop's address. The pages load as they are; logging in is
a `POST`, which Django refuses from an origin it doesn't know.

```sh
hostname -I    # the laptop's address on the Wi-Fi: the first one
```

Add `http://<address>:5173` to `DJANGO_DEV_ORIGINS` in `backend/.env`,
recreate the backend, then open `http://<address>:5173` on the phone:

```sh
docker compose up -d --force-recreate backend
```

- **`restart` is not enough**: Compose reads `env_file` only when it creates
  the container.
- **The Django admin isn't reachable from a phone**: it listens on port 8000,
  outside Vite's proxy. Use it from the laptop.
- **`permission denied` on the Docker socket right after installing
  Docker**: Ubuntu keeps the session's old groups — reboot, logging out isn't
  always enough.
- **Nothing answers**: the laptop's firewall (`sudo ufw status`), or a Wi-Fi
  that isolates its devices from each other, common on guest and school
  networks — then share a phone's connection and use the laptop's address on
  it.
- **After `requirements.txt` or `package.json` changed**: `--build`, and for
  the frontend also `docker volume rm transcendence_frontend_node_modules`,
  which otherwise keeps the old dependencies over the new image's.

Development mode shows Django's error pages to whoever triggers them, and
every device on the network reaches ports 5173 and 8000: stop the stack
(`docker compose stop`) once the trial is over. For the club's real use, the
HTTPS stack below serves phones too.

### Production stack over HTTPS

```sh
cp backend/.env.example backend/.env
# Fill in DJANGO_SECRET_KEY, set DJANGO_DEBUG=false, and read FIELDNOTES_HOST
# below if the club needs this from a phone, not just the machine itself.
docker compose -f compose.prod.yml up --build
```

Open <https://localhost/>. The browser warns once per device — the
certificate is a static, self-signed one `cert-init` generates the first time
the stack starts (10 years, kept in the `tls_certs` volume so later restarts
reuse it rather than minting a new one the browser has never seen) for
`FIELDNOTES_HOST`, which defaults to `localhost`. `http://` redirects to
`https://`.

**From a phone on the club's Wi-Fi**, not just the machine running the stack:
set `FIELDNOTES_HOST` in `backend/.env` to that machine's address on the
network (for example `192.168.0.119`, the address the in-room trial on 30
September used), and add the same address to `DJANGO_ALLOWED_HOSTS` and as
`https://<address>` to `DJANGO_CSRF_TRUSTED_ORIGINS` in the same file —
`cert-init` signs the certificate for whichever address `FIELDNOTES_HOST`
names, and the Caddyfile's `default_sni` hands it out even to a browser that
sends none, which is what every browser does for a bare IP (RFC 6066
excludes IP literals from the SNI extension). Changing the address after the
first run requires removing the `tls_certs` volume
(`docker volume rm transcendence_tls_certs`) so a new certificate gets
generated for the new one — `cert-init` runs from the backend's own image,
already local by then, so this needs no connection even if the room has
none, which is exactly when the club is most likely to be setting this for
the first time on the day.

Three containers: `cert-init` runs once and exits; `backend` runs the
migrations, `collectstatic`, then Daphne (ASGI — ready for Channels, ahead of
needing it) instead of `runserver`; `proxy` bakes the frontend's production
build into a Caddy image (`deploy/Dockerfile`) that terminates TLS, serves
`/static/` from what `collectstatic` wrote, and reverse-proxies `/api/` and
`/admin/` to `backend` — same origin as the frontend, so no CORS, same as
development. Named volumes keep the SQLite database, media and the RAG's
embedding model cache across a `down` and `up`; `db.sqlite3` moves under one
of them because this container, unlike the dev one, has no bind mount to keep
it on the host instead.

#### Backups

The database and media live in named volumes, not on the host, so copying
`backend/db.sqlite3` the way a non-Docker install would no longer reaches
them. Stop `backend` first: the database runs in WAL mode (`settings.py`),
so a recent commit can still sit in `db.sqlite3-wal` rather than
`db.sqlite3` itself while a connection is open, and closing the last one
checkpoints it back in. Pull both out together, then start `backend` again:

```sh
docker compose -f compose.prod.yml stop backend
mkdir -p "backup-$(date +%Y%m%d)"
docker compose -f compose.prod.yml cp backend:/app/data/db.sqlite3 "backup-$(date +%Y%m%d)/db.sqlite3"
docker compose -f compose.prod.yml cp backend:/app/media "backup-$(date +%Y%m%d)/media"
docker compose -f compose.prod.yml start backend
```

No scheduler runs this — the club runs it by hand, as often as the data is
worth not losing.

### Backend without containers

```sh
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements-dev.txt

cp backend/.env.example backend/.env
# Fill in DJANGO_SECRET_KEY — see the comment in the file.

python backend/manage.py migrate
python backend/manage.py createsuperuser
python backend/manage.py runserver
```

`.env` is never versioned: everyone keeps their own.

### Frontend without containers

The frontend requires Node.js 22.12 or later. Install its locked dependencies
and start the development server in a second terminal:

```sh
npm ci --prefix frontend
npm --prefix frontend run dev
```

`package.json` declares the frontend dependencies, while `package-lock.json`
locks their complete versions. Use `npm ci --prefix frontend` after cloning or
when the lock file changes; use `npm install --prefix frontend` only when
intentionally adding or updating a dependency.

## Trying it out

### Frontend

With the frontend development server running, open <http://localhost:5173/>.
From the landing page, create an account, keep the returned identifier, then
sign in with that identifier or the display name. Refresh the page to verify
the session persists, and use the header to sign out. Leaving the email blank
at sign-up shows the generated `.invalid` identifier on the success screen.

To verify the production build locally:

```sh
npm --prefix frontend run build
npm --prefix frontend run preview
```

Open the URL printed by Vite, normally <http://localhost:4173/>, to inspect
the built pages. Account actions need the development server's `/api` proxy or
the final deployment's reverse proxy.

### Backend

With the backend server running, open <http://127.0.0.1:8000/admin/> and sign in
with the email and password given to `createsuperuser`.

- Type the address with `http://`. The development server only speaks HTTP;
  a browser that tries HTTPS reports an SSL error. If it keeps switching to
  HTTPS, use <http://localhost:8000/admin/> instead.
- The site root returns 404: no product route exists there yet.
- `GET /api/health/` returns `{"status": "ok"}` and accepts only GET requests.

HTTPS, which the subject requires on every connection to the backend, is
handled by the production stack's reverse proxy ("Production stack over
HTTPS" above) — not by Django's or Vite's development servers, nor by this
development Compose stack.

### Demo data

A fresh database is empty. To give every screen and route something to show,
fill it with a demo club — before creating any account of your own:

```sh
python backend/manage.py migrate
python backend/manage.py seed_demo
python backend/manage.py createsuperuser   # afterwards, for the Django admin
```

It creates the current season (BioBuzz) with its Wednesday and Friday
workshop slots, four fictional teams of three students, a mentor (Claire) and
a club admin (Paul), and four weeks of work: work items at their steps, one
back in prototyping after its test zero, one done, progress with handovers,
notes, and slot days on which nothing moved. Dates are relative to the day it
runs, so the recent days are always filled. One
student has refused image rights and one is not yet matched with AssoConnect,
since a real club has both.

Every demo account signs in with its display name and the password
`rouage-demo-2026`. The command refuses a database that already holds
accounts, teams or seasons: it never overwrites anything, and it is never
meant for the club's own instance. To start over, delete
`backend/db.sqlite3` and migrate again.

## Accounts and sessions

The frontend uses these four routes from `/`, `/signup` and `/login`:

| route | answers |
| --- | --- |
| `POST /api/auth/signup/` | `201` with `email` and `display_name` |
| `POST /api/auth/login/` | `200` with the identity below; the same account is locked for 15 minutes after 5 wrong passwords running, told apart from a wrong password while it is |
| `POST /api/auth/logout/` | `204` |
| `GET /api/auth/me/` | `200` with the identity, or `null` when nobody is signed in |
| `PUT /api/auth/me/avatar/` | `200` with the identity — one's own photo, as `multipart/form-data` field `avatar` |
| `DELETE /api/auth/me/avatar/` | `204` |
| `GET /api/users/{id}/avatar/` | the photo, to signed-in members only; `404` if there is none |

The identity is deliberately small — `display_name`, `club_role`,
`is_club_admin`, `avatar`, the photo's address or `null`, and `team_seasons`,
the team seasons the account may open (its own teams for a student, every team
for a mentor), newest season first. A session tells the interface what to
draw, not what the account holds.

### Avatars

The server trusts neither a file's extension nor the type the browser
announces: it takes JPEG, PNG, WebP or an iPhone's HEIC up to 10 MB and about
89 million pixels (Pillow's own decompression-bomb threshold), as Pillow reads
them, and refuses anything else with `avatar_too_large`, `avatar_too_many_pixels`,
`avatar_not_an_image` or `avatar_format_refused`. What it stores is never the
file sent but a WebP re-encoded from it — upright, at most 512 pixels a side,
under a random name, and without the photo's metadata, which on a phone
includes where it was taken. A replaced or deleted photo leaves the disk once
the account no longer points at it.

No uploaded file has a public URL, not even in development: every one goes
through a view that checks the caller is signed in.

```sh
curl -X POST http://127.0.0.1:8000/api/auth/signup/ \
  -H 'Content-Type: application/json' \
  -d '{"email": "", "password": "rouage-bleu-2026", "display_name": "Marie",
       "last_name": "Dubois", "first_name": "Marie",
       "birth_date": "2009-06-08"}'
```

Sign-up takes no role. Every account starts a student, and a mentor is made
by the club admin, over the API below or from the Django admin — the latter
is still where a forgotten password is reset. The AssoConnect export confirms
names, never roles, so a role declared at sign-up would be a role granted by
asking for it.

The address is optional: a member who has none is given one on a reserved
`.invalid` domain, which can never deliver. Sign-up echoes the address back
because it may have been built rather than given — whoever signs up has to be
told what they will type next time. Logging in accepts either identifier, the
address or the display name, in a single `username` field.

An unknown identifier and a wrong password are refused by the same response,
`bad_credentials`, identical to the character. The login form must not become
a directory of the club, so it cannot report that an account does not exist.

There is no password reset by email, deliberately: one instance serves one
club, in one room. A member who forgets their password is standing in front of
the club admin, who sets a temporary one from the Django admin.

### Sessions

The session is a cookie, not a token: same origin, one proxy, nothing stored
where a script could read it. A page calls `GET /api/auth/me/` on boot — it
answers `null` until someone signs in, and sets the `csrftoken` cookie that
every later `POST` must echo in an `X-CSRFToken` header. The `null` answer
sets the cookie too, which is what arms the login form. "Nobody" is an
answer, not a refusal: a `403` on every visitor's first request would put a
red line in their browser's console, which the subject forbids.

Sign-up and log-in say `csrf_protect` explicitly. `SessionAuthentication`
enforces CSRF only once it has *found* a session, so the two routes that run
without one — the routes that hand a session out — are precisely the ones it
would not protect.

## Members and roles

The admin CRUD `docs/modules.md` §4 asks for, on top of the model it already
settles: `User.club_role` and `Membership` are enough to derive who may act
where, and this is its surface. The screen is `/users`, offered to club admins
only: the members, filtered by name or address (case and accents ignored),
status and role; each one's page changes their role, admin flag and
suspension, or deletes the account after a confirmation.

| route | answers |
| --- | --- |
| `GET /api/users/` | `200` with every account, active or not — or, with `search`, the team screen's typeahead (below) |
| `GET /api/users/{id}/` | `200` with one account |
| `PATCH /api/users/{id}/` | `200` — any of `club_role`, `is_club_admin`, `is_active` |
| `DELETE /api/users/{id}/` | `204` — anonymizes, the same as leaving |

Every route needs `is_club_admin`; anyone else gets a `403`. An admin cannot
target their own account through this surface — the refusal carries
`cannot_target_self` — because locking yourself out of your own admin rights,
or deactivating yourself, has no recovery path but another admin, and on a
single-admin club there may not be one. Nor a staff account, unless the
caller is staff too (`cannot_target_staff`) — staff is what resets a
forgotten password from the Django admin, and a non-staff admin locking that
out would leave the club with no recovery path but `manage.py`. Nor a
superuser, unless the caller is one too (`cannot_target_superuser`) — a
second, stricter boundary layered on top of the staff one, since `is_staff`
alone says nothing about `is_superuser`.

`PATCH` refuses a `club_role`/`is_club_admin` combination that would leave an
administrator who is not a mentor (`admin_must_be_mentor`) — checked against
the account's resulting state, not just the fields one request happens to
touch, inside the same transaction as the write: two admins editing the same
account's role and flag at once are ordered by the database's own write lock
rather than by whichever read either request happened to see first.

`DELETE` calls the same `anonymize` (`club/gdpr.py`) as a member's own
request and the Django admin's anonymize action — not `is_active=False`,
which is a suspension: temporary, reversible by `PATCH
{"is_active": true}`, and erases nothing (`docs/lexique.md`; the terms of
service). Deletion is final: the name, address, birth date and AssoConnect
id are erased, the password made unusable, and — an admin anonymized this
way is not exempt — `is_club_admin` cleared, since a password nobody can
use makes the flag meaningless but still able to mislead
`not_the_last_admin`. An account anonymized this way — or any other — is
final: the list flags it `is_anonymized`, read off its reserved name, and
`PATCH` and `DELETE` refuse it with `account_anonymized` (`409`), since
reactivating it or making it an admin would only add a phantom that
`not_the_last_admin` would count. What a member wrote stays in the team's notebook,
attributed (`club/models.py`, `User`) — a literal row delete would either
orphan it or be refused outright by the `PROTECT` relationships that hold
it. The confirmation e-mail goes out the same way it does for a
self-service deletion; `not_the_last_admin` is `request_deletion`'s own
guard, so deleting the club's only administrator is refused the same way
here as anywhere else.

### Data export and deletion

| route | answers |
| --- | --- |
| `POST /api/auth/me/export/` | `202` — a JSON copy of the account, plus the avatar, by e-mail |
| `DELETE /api/auth/me/` | `204` — `password` confirms it; anonymizes the account, confirmed by e-mail |

Neither goes to the login address: it identifies an account without being
assumed to deliver, and the youngest members have none that does. Both go to
`contact_email` instead — the member's own for an adult, their legal
guardian's for a minor — and both are refused with `no_contact_email` when
that column is empty, before anything changes. `DELETE` also takes the
account's own `password` in its body and refuses a missing or wrong one with
`wrong_password`, nothing changed — a session left open on a shared club
computer must not delete the account in one click.

`DELETE` anonymizes rather than deletes the row (`club/gdpr.py`,
`anonymize`): `Entry.author` and `EntryParticipant.user` are `PROTECT`, so
what a member wrote stays in the team's notebook, attributed — what goes is
the identity (name, address, birth date, AssoConnect id, avatar, password).
The consent log stays, since it still decides whether past content may be
published. The whole thing is one transaction, the confirmation e-mail last,
so a failed send leaves the account exactly as it was rather than deleted
with nobody told. The sole club admin is refused with
`last_admin_cannot_leave` — the club has no password-reset-by-email
fallback, so another admin is the only recovery path for everyone else, and
there has to be one left. That check is re-read inside the same
transaction, so two admins leaving at the same instant still serialize
correctly — `config/settings.py` takes the database's write lock the moment
the transaction opens, not through row locking (SQLite ignores
`select_for_update()` outright).

A club admin anonymizes a member who has left through the Django admin's own
"Anonymiser les membres sélectionnés" action on the user list — a
confirmation page first, the same shape as Django's own "Delete selected".
It calls the same `anonymize`, with the same guards and confirmation e-mail,
but no password: a staff sign-in already confirms who is acting.

## Teams and memberships

The team management screen, `/teams`, is the club admin's: every route below
answers `403` to anyone without `is_club_admin`, and the header only offers
the screen to them.

| route | does |
| --- | --- |
| `GET /api/teams/` | the newest season and its teams, each with its `team_season` and its members as `{"membership", "user", "display_name", "avatar"}` |
| `POST /api/teams/` | create a team — `number`, `name`, and the `season`'s start year — and open it for that season |
| `PATCH /api/teams/{id}/` | rename it; the number is FIRST's and never changes |
| `DELETE /api/teams/{id}/` | delete it — refused with `team_has_members` while anyone is on it, `team_has_history` once it has more than a season, `team_has_work` once its season holds a work item or a trace |
| `GET /api/users/?search=&team_season=` | the member list as the screen's typeahead: up to ten active accounts whose display name contains the text, regardless of case, less those already on `team_season` |
| `POST /api/memberships/` | put `user` on `team_season`; twice is `membership_exists` |
| `DELETE /api/memberships/{id}/` | take them off it |

## Work items and the day

What the three screens read and write. Every route needs a session; a student
acts on the team seasons they are a member of, a mentor on all four, and
anyone else gets a `403` with the code `not_a_member`.

| route | does |
| --- | --- |
| `GET /api/team-seasons/{id}/work-items/` | the team's work items, each with when it was opened, its current step, last progress and handover; progress dates include their 4 a.m.–4 a.m. workday |
| `POST /api/team-seasons/{id}/work-items/` | open one |
| `GET /api/work-items/{id}/` | one work item and its thread, newest first |
| `PATCH /api/work-items/{id}/` | close it, `done` or `dropped`; working on it again reopens it |
| `DELETE /api/work-items/{id}/` | delete one opened by mistake: refused with `work_item_has_traces` (`409`) once it has any trace, even an empty progress — drop it instead |
| `POST /api/work-items/{id}/tick/` | sign up to today's progress, created by the first to tick |
| `PATCH /api/entries/{id}/` | write a progress — sentence, step, handover — for its participants and mentors |
| `POST /api/entries/{id}/attachments/` | attach a file to any of the team's entries, as `multipart/form-data` fields `file` and `people_recognisable`, the latter always answered: left out, it is `required`, never read as no |
| `GET /api/attachments/{id}/` | the file, to the team and mentors |
| `DELETE /api/attachments/{id}/` | remove it — whoever attached it, or a mentor; anyone else gets `delete_not_uploader` |
| `POST /api/team-seasons/{id}/notes/` | a note for the team, or addressed to one of its work items |
| `POST /api/team-seasons/{id}/decisions/` | a decision, same fields as a note plus `attendees`: members of the team or mentors, ticked by the author; only the author counts as present |
| `GET /api/team-seasons/{id}/days/{YYYY-MM-DD}/` | the day's entries, number of work items advanced, who was there, the roster they count against, and the `previous` and `next` days the team left a trace; `today` resolves the current 4 a.m.–4 a.m. workday on the server |
| `GET /api/team-seasons/{id}/gaps/?since=&until=` | the workshop-slot days on which nothing moved forward |
| `GET /api/team-seasons/{id}/analytics/activity/?since=&until=` | progress activity by workday and member over the inclusive period, plus a current work-item snapshot |
| `GET /api/team-seasons/{id}/export/?format=markdown` | the season's notebook as a `.zip`, one Markdown file per category; `category` (`robot`, `outreach`, `team-life`) and `work_item` narrow it |

A day runs from 4 a.m. to 4 a.m., in Paris time: a late session belongs to
the day it started. Ticking at another step than today's opens a second
progress, and the handover shown on a work item is the latest one left,
with who left it, when, and at which step.

Every entry names its work item, `{"id", "title"}`, or `null` for a note to
the whole team. A day skips to the closest days with something in them: an
empty day has nothing to read, and the slots on which nothing moved are what
`gaps` lists.

Activity analytics are derived from the same records rather than stored a
second time. The period applies only to `progress` entries and follows the
same 4 a.m.–4 a.m. workday as the day screen. One progress shared by several
participants counts once for the team and once for each student participant;
mentors, notes and decision attendees do not count. Per-student `active_days`,
`progress_entries`, distinct `work_items`, and `last_progress_day` describe
recorded participation, not productivity. Former or anonymized participants
remain in the history with `is_current_member: false`.

The `snapshot` is deliberately current rather than historical: it groups all
of the team's work items by their present status and latest progress step,
and counts items with no progress yet. The calculation lives in
`club.analytics`, alongside the future match and trial analytics, so API
views only validate access and input.

The team home presents these figures in an “Activité de l'équipe” section.
It starts with the last 30 days and can show the whole September-to-August
season or a custom inclusive period. Summary cards describe the current work,
while the time chart and member table follow the selected period. Recharts is
the frontend's single charting library; each visual chart has the same values
in an accessible table, so colour and pointer interaction are never required.
The member table keeps the API's neutral order and wording: it describes days,
traces and distinct work items, without scores or rankings.

The export is raw material for the portfolio, which students write elsewhere:
the season's entries by category — building the robot (work items on the
robot), outreach (off the robot), team life (no work item) — each work item
as a chapter, oldest first, every entry with its date, step and participants.
A work item nobody worked on has nothing to give and is left out.

Attached files travel in the archive, not as links: under `fichiers/`, each
named by its id and its original name, and every entry lists its own as
relative links. The archive is written to a temporary file and streamed, so
a season of videos never has to fit in memory. At its root, `A-LIRE.md`
says the notebook is an internal working document, lists the refusals of
image rights in force among the team's members — "aucun" most of the time —
and the files to check before any publication: those with people on them,
in a team where a refusal is in force today. The Django admin filters the
attachments on the same rule, under "Refus dans l'équipe": a list to read
before publishing, not one to empty. A mentor corrects a wrong answer on
recognisable people there, but never clears it because the member who
refuses is not on the photo: someone else on it may refuse later.

The members a route lists — a progress's participants, who was there on a
day — each come as `{"display_name", "avatar"}`, so the interface can put a
face next to a name without asking again.

### Attachments

Every entry comes with its `attachments`, each as `{"id", "name",
"content_type", "url", "people_recognisable", "uploaded_by"}`. The server
reads what a file contains, never its name or the type the browser announces,
and takes a closed list — every file is served back from the application's
own address, where an HTML or SVG page would run with the session of whoever
opened it:

| kind | formats | up to | kept |
| --- | --- | --- | --- |
| photo | JPEG, PNG, WebP | 20 MB | same size and format, upright, without its metadata |
| iPhone photo | HEIC | 20 MB | the same, as a JPEG named after it — only Safari shows HEIC |
| video | MP4 (Android), MOV (iPhone), WebM | 200 MB | as sent |
| document | PDF | 20 MB | as sent |
| CAD | STEP, STL | 50 MB | as sent, downloaded rather than shown |

Anything else is refused with `attachment_type_refused`, a file over its limit
with `attachment_too_large`, a photo decoding to too many pixels with
`attachment_too_many_pixels`. HEIC is read through `pillow-heif`, registered
when the application starts; `libheif` applies the rotation an iPhone stores
in the file itself, so the photo comes out upright.

Files live under `backend/media/`, beside the database, and a backup takes
both: the database only records where each file is. A removed attachment, or
the entry it belongs to, leaves the disk once the deletion is committed.

## Rulebook questions

A member asks the current season's game manual a question and gets back the
passages that answer it, ranked first by how much they may be trusted, then
by how well they answer it — not a generated answer, so nothing is ever
invented past what the source says.

| route | does |
| --- | --- |
| `POST /api/rules/ask/` | a question, answered with up to five cited passages from this season's ingested documents |

"Current season" here means `Season.objects.first()` — the whole route has
no `team_season_id` to read it from, unlike everything else in this API, so
whichever season sorts first (`Season.Meta.ordering`, newest first) is the
one asked. A season with nothing ingested yet is refused by name ("Le manuel
de la saison 2026-2027 n'est pas encore chargé"), distinct from an ingested
manual simply not answering a question.

Ingesting a document is a management command, not a route — there is no
screen for uploading a manual, only for asking it questions:

```sh
python manage.py ingest_document "BIOBUZZ Competition Manual - TU02.htm" \
  --season 2026 --source game_manual --title "Manuel BioBuzz TU02"
```

The manual is read from FIRST's own HTML export
(`ftc-resources.firstinspires.org/ftc/game/cm-html/...`), never the PDF: a
PDF flattens the page into plain lines wherever it happens to wrap, and
nothing there tells a wrapped table row or a mid-sentence cross-reference
apart from a real rule or section opening. The HTML export needs no such
guessing — every rule carries its own anchor, and every heading already is
a real `<h1>`-`<h3>`. The command refuses a `.pdf` file for `game_manual`
outright rather than silently ingest one undifferentiated passage.

`--source` is one of `game_manual` or `official_qa`, and decides the
document's authority (respectively `binding`, `ruling`) — never asked for on
its own, so a typo can't file the Q&A as binding. Citations are ordered by
authority first, score second: the manual is explicit that it takes
precedence over the Q&A, so a `binding` passage is always quoted ahead of a
`ruling` one that merely scored higher, and every match above the threshold
is considered for this ordering before being cut to the five kept — cutting
by score first could otherwise drop a `binding` passage that a handful of
`ruling` ones outscored. A question is answered plainly when anything clears
the threshold; otherwise the response carries a refusal instead of a guess,
pointing to FIRST's own Q&A. Only the latest ingested document per
`(season, source)` is searched — FIRST republishes the manual with every
Team Update, and citing an amended rule alongside its own superseded
predecessor would leave a student unsure which to trust.

Each passage is one rule, one numbered section, or one Q&A entry, not a
sliding window over the text: both sources are built on their own numbering
(`G420 *Do not tip or entangle.`, `10.6.4 Violation Details`, `Q44 Blue
robot over their gate...`), and a fixed-size window cut across them would
leave a citation unable to say which one it was quoting — a Q&A answer also
references rules mid-sentence ("this would violate G410"), so it is chunked
by its own `Q<n>` numbering rather than the manual's rule chunker, which
would otherwise read every such reference as a new rule starting. A citation
carries its own `reference` (`G420`, `10.6.4`, `Q44`, or empty for front
matter) alongside its text.

The first `ingest_document` or `POST /api/rules/ask/` on a fresh install
downloads the embedding model once (1.1GB, cached under
`backend/.cache/fastembed`, inside the existing `backend/` bind mount in
`compose.yml` so a `down` and `up` does not re-download it) — the only
network access this module ever makes; every call after that is local.

There is no vector database behind this: a manual is a few thousand
passages, and ranking them against a question is a NumPy dot product, cheap
enough to redo on every question (measured on the real manual: ~10-20ms per
question, past the model's one-time load, ~1.5s). There *is* a real
embedding model — `intfloat/multilingual-e5-base` run through `fastembed`
(ONNX Runtime, not `sentence-transformers`/PyTorch — measured identical to
the third decimal place on the same 100 questions, for about a third the
per-question latency and without torch's own ~550MB of installed weight;
the one trade-off is ingestion, roughly twice as slow, since ONNX's CPU
provider favours short sequences over the long batches ingestion needs),
278M parameters, CPU-only, downloaded once and cached locally, nothing sent
anywhere at question time. An earlier version hashed a bag-of-words and
ranked it with Okapi BM25, which worked only when a question quoted the
manual's own English vocabulary — a member asking in French, the club's own
language, about a manual FIRST never publishes in French, shared no token
with the passage that answered them. A real embedding closes that gap:
"Est-ce que le robot peut toucher un autre robot pendant l'autonome ?"
retrieves the manual's English contact rules directly, nothing in common
between the two but what they mean. Calibrated on the real manual, chunked
by rule rather than by word window (364 passages, TU02), against 90 real
questions spanning every section and 10 off-topic controls: every off-topic
question fell below the threshold that still answered 89 of the 90 real
ones. The margin is thin, not a comfortable gap — the weakest real question
and the strongest off-topic one both score 0.808, tied to the thousandth —
so read 89/90 as what held on this one question set, not a guarantee a
different set of off-topic phrasings would preserve, and rerun the scan
after any change to chunking: the same question set scored this boundary at
0.805/0.806 against the previous, PDF-chunked manual, so re-chunking alone
moved it even though the threshold value (0.81) did not change. A bigger
corpus of nonsense phrasings would likely still find something that slips
through; closing that gap for good would need a classifier trained on real
off-topic traffic, which does not exist yet.

The embedding model itself is not pinned to a revision: `nixiesearch/multilingual-e5-base-onnx`
is a third-party ONNX export, and neither `fastembed`'s `ModelSource` nor the
download call it makes underneath accepts a revision to pin — a fresh
install always resolves to whatever that repository is at install time. If
it changes or disappears, ingestion either fails outright or silently
answers from a different model than the one `MIN_SCORE` above was
calibrated on.

## Checking

```sh
make check
```

Runs, from the activated virtual environment, Ruff (lint and formatting),
mypy, a check that no model change is missing its migration, the frontend
TypeScript check, and Biome (frontend lint and formatting). It must pass before
every commit. It only reports; `make format` applies the formatting on both
sides, for you to review before committing. CI runs `make check` on every pull
request, followed by the frontend production build:

```sh
npm --prefix frontend run build
```

`build` repeats the type check and creates the optimized assets in
`frontend/dist/`; a failure here that `make check` missed is a bundling
problem, not a type error.

## Testing

```sh
make test
```

Runs both suites, backend then frontend.

### Backend

Runs the suite with pytest and pytest-django — not `manage.py test`. Tests
live next to the code, under `backend/<app>/tests/`. Every test has database
access without `@pytest.mark.django_db` (see `backend/conftest.py`).

### Frontend

```sh
npm --prefix frontend test
```

Vitest runs the tests next to the code they exercise. The health client has
unit coverage; React Testing Library covers account creation without an email,
field and login refusals, and opening and closing a session with the rotated
CSRF cookie.

## Contributing

Work goes through pull requests; nobody pushes to `main`.

1. Pick an issue, assign yourself, and move it to *In Progress* on the
   project board.
2. Branch from an up-to-date `main`, named `<issue>-<topic>` — for example
   `1-pytest-django`.
3. Keep a pull request to one issue. A model change ships with its migration.
4. `make check` must pass before you push.
5. Give the pull request a prefixed title — `feat:`, `fix:`, `docs:`,
   `refactor:`, `test:`, `chore:` — and put `Closes #<issue>` in its
   description.
6. Another team member reviews and approves it. It is merged with
   *Squash and merge*, so its title becomes the commit message on `main`.

Code, commits, issues and pull requests are in English; only the interface is
in French. `docs/` is the one exception, and a deliberate one — see below.

## Documentation

- [`docs/lexique.md`](docs/lexique.md) — the model's vocabulary, **frozen**. One
  name per object, French for what is read and said, English for what is
  written in code. A pull request that names a model otherwise contradicts this
  file, which is the point: two issues once proposed `Chantier`, `Avancée` and
  `Séance` for tables already named `WorkItem`, `Entry` and `Meeting`.
- [`docs/fieldnotes.html`](docs/fieldnotes.html) — the concept note: the
  problem, the architecture, what the club's practice corrected, the schema in
  full, the build order and what is deliberately out of scope.
- [`docs/schema-socle.svg`](docs/schema-socle.svg) — the database schema of what
  is built so far, which the subject requires documented.
- [`docs/modules.md`](docs/modules.md) — the fifteen declared modules: what the
  club has in front of each requirement, and how each will be demonstrated.
  It is the defence rehearsal, not a specification — the README is what says
  what was built, and a milestone is what says it is done.

**These four are in French, on purpose.** The design is argued in the club's
language, and an argument loses something in translation; the lexicon exists
precisely so that the French of the interface and the English of the code never
drift apart. Everything a reviewer reads — code, commits, issues, pull
requests — stays English.

## What is here so far

- `backend/config/` — Django settings, read from `.env`.
- `backend/club/` — accounts, teams, seasons, memberships, and the rules that
  govern signing up: two identifiers, a reserved domain, a contact address.
  Work items and entries, with the rules of a progress in `progress.py` and
  the reading of a day in `workdays.py`, the notebook export in `export.py`.
- `backend/club/api/` — sign-up and session, teams and memberships, work
  items, progress and the day, over Django REST framework.
- `backend/config/views.py` — the minimal health endpoint.
- `frontend/src/app/` — shared router and TanStack Query configuration.
- `frontend/src/api/` — typed clients for Django endpoints.
- `frontend/src/pages/` — route-level React screens.
- `frontend/src/locales/` — the French user-interface catalogue.
- `frontend/src/styles.css` — Tailwind entry point and global styles. Its
  `@theme` names every color the pages use (`text-muted`, `bg-tint`,
  `border-primary/20`), so no page writes a hex value, and the two fonts:
  Inter for text, Poppins for headings and titles.
- `compose.yml` — the complete development stack in one command.
- `compose.prod.yml`, `deploy/` — the HTTPS production stack: Caddy
  (`deploy/Dockerfile`, `deploy/Caddyfile`) in front of Django on Daphne.

The frontend contains the public landing, sign-up and log-in screens, and
the privacy policy (`/privacy`) and terms of service (`/terms`), linked from
the footer of every page, signed in or not. Their text lives in
`frontend/src/pages/LegalPages.tsx`, written from what the application stores
and does: a change to what it collects, shows or keeps changes them too. Once
signed in, the home screen lists the selected team's robot and off-robot work
items, with pending handovers highlighted. Opening a new work item starts
from the usual ones the team doesn't have yet
(`frontend/src/pages/suggestions.ts`) — picking one opens it on its side — or
from any other name; a name the team already has points to that work item
instead. A mentor can switch between the team seasons exposed by their
identity. A club admin also reaches the team management screen — create,
rename and delete the season's teams, and add members by typing their name or
remove them — and the members screen, to change a member's role, admin flag
or suspension, or delete their account.
