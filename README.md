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

Feature-specific tools will be added only with the feature that first uses
them: **React Hook Form and Zod** for forms and runtime validation, **Vitest
and React Testing Library** for automated frontend tests, and
**vite-plugin-pwa/Workbox and IndexedDB** for the PWA and durable offline
support. IndexedDB will store pending scouting operations; TanStack Query's
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

Open <http://localhost:5173/>. The landing page reports `API Django connectée`
when React has reached `GET /api/health/` through TanStack Query and Vite's
development proxy. The Django admin remains available at
<http://localhost:8000/admin/>.

This Compose stack is for development and proves the frontend/backend
integration. The final deployment will build static frontend assets and put
both them and Django behind the same HTTPS reverse proxy.

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
The current landing page proves that React, routing, the French catalogue and
Tailwind are wired together. With Django running on port 8000, it also displays
the API connection status obtained from `GET /api/health/`.

To verify the production build locally:

```sh
npm --prefix frontend run build
npm --prefix frontend run preview
```

Open the URL printed by Vite, normally <http://localhost:4173/>. The production
preview should display the same landing page as the development server.

### Backend

With the backend server running, open <http://127.0.0.1:8000/admin/> and sign in
with the email and password given to `createsuperuser`.

- Type the address with `http://`. The development server only speaks HTTP;
  a browser that tries HTTPS reports an SSL error. If it keeps switching to
  HTTPS, use <http://localhost:8000/admin/> instead.
- The site root returns 404: no product route exists there yet.
- `GET /api/health/` returns `{"status": "ok"}` and accepts only GET requests.

HTTPS, which the subject requires on every connection to the backend, will
be handled by the final deployment's reverse proxy — not by Django's or
Vite's development servers, nor by this development Compose stack.

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
back in prototyping after its test zero, one done, one only suggested,
progress with handovers, notes, and slot days on which nothing moved. Dates
are relative to the day it runs, so the recent days are always filled. One
student has refused image rights and one is not yet matched with AssoConnect,
since a real club has both.

Every demo account signs in with its display name and the password
`rouage-demo-2026`. The command refuses a database that already holds
accounts, teams or seasons: it never overwrites anything, and it is never
meant for the club's own instance. To start over, delete
`backend/db.sqlite3` and migrate again.

## Accounts and sessions

No page yet — that is issue #40.

| route | answers |
| --- | --- |
| `POST /api/auth/signup/` | `201` with `email` and `display_name` |
| `POST /api/auth/login/` | `200` with the identity below |
| `POST /api/auth/logout/` | `204` |
| `GET /api/auth/me/` | `200` with the identity, or `403` |
| `PUT /api/auth/me/avatar/` | `200` with the identity — one's own photo, as `multipart/form-data` field `avatar` |
| `DELETE /api/auth/me/avatar/` | `204` |
| `GET /api/users/{id}/avatar/` | the photo, to signed-in members only; `404` if there is none |

The identity is deliberately small — `display_name`, `club_role`,
`is_club_admin`, and `avatar`, the photo's address or `null`. A session tells
the interface what to draw, not what the account holds.

### Avatars

The server trusts neither a file's extension nor the type the browser
announces: it takes JPEG, PNG or WebP up to 10 MB and about 89 million
pixels (Pillow's own decompression-bomb threshold), as Pillow reads them, and
refuses anything else with `avatar_too_large`, `avatar_too_many_pixels`,
`avatar_not_an_image` or `avatar_format_refused`. What it stores is never the file sent but a WebP
re-encoded from it — upright, at most 512 pixels a side, under a random name,
and without the photo's metadata, which on a phone includes where it was
taken. A replaced or deleted photo leaves the disk once the account no longer
points at it.

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
by the club admin from the Django admin — the same place a forgotten password
is reset. The AssoConnect export confirms names, never roles, so a role
declared at sign-up would be a role granted by asking for it.

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
answers `403` until someone signs in, and sets the `csrftoken` cookie that
every later `POST` must echo in an `X-CSRFToken` header. The `403` sets the
cookie too, which is what arms the login form.

Sign-up and log-in say `csrf_protect` explicitly. `SessionAuthentication`
enforces CSRF only once it has *found* a session, so the two routes that run
without one — the routes that hand a session out — are precisely the ones it
would not protect.

## Work items and the day

What the three screens read and write. Every route needs a session; a student
acts on the team seasons they are a member of, a mentor on all four, and
anyone else gets a `403` with the code `not_a_member`.

| route | does |
| --- | --- |
| `GET /api/team-seasons/{id}/work-items/` | the team's work items, each with its current step, last progress and handover |
| `POST /api/team-seasons/{id}/work-items/` | open one — or list it for September with `"suggested": true` |
| `GET /api/work-items/{id}/` | one work item and its thread, newest first |
| `PATCH /api/work-items/{id}/` | close it, `done` or `dropped`; working on it again reopens it |
| `POST /api/work-items/{id}/tick/` | sign up to today's progress, created by the first to tick |
| `PATCH /api/entries/{id}/` | write a progress — sentence, step, handover — for its participants and mentors |
| `POST /api/team-seasons/{id}/notes/` | a note for the team, or addressed to one of its work items |
| `GET /api/team-seasons/{id}/days/{YYYY-MM-DD}/` | the day's entries, who was there, and the roster they count against |
| `GET /api/team-seasons/{id}/gaps/?since=&until=` | the workshop-slot days on which nothing moved forward |
| `GET /api/team-seasons/{id}/export/?format=markdown` | the season's notebook as a `.zip`, one Markdown file per category; `category` (`robot`, `outreach`, `team-life`) and `work_item` narrow it |

A day runs from 4 a.m. to 4 a.m., in Paris time: a late session belongs to
the day it started. Ticking at another step than today's opens a second
progress, and the handover shown on a work item is the latest one left,
with who left it, when, and at which step.

The export is raw material for the portfolio, which students write elsewhere:
the season's entries by category — building the robot (work items on the
robot), outreach (off the robot), team life (no work item) — each work item
as a chapter, oldest first, every entry with its date, step and participants.
A work item nobody worked on has nothing to give and is left out.

The members a route lists — a progress's participants, who was there on a
day — each come as `{"display_name", "avatar"}`, so the interface can put a
face next to a name without asking again.

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

Vitest runs the unit tests, next to the code they test (`health.test.ts`
beside `health.ts`); `npm --prefix frontend test` runs them alone. There are no
component tests yet: React Testing Library comes with the first screen that
carries logic.

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
- `backend/config/views.py` — the minimal health endpoint used by the frontend.
- `frontend/src/app/` — shared router and TanStack Query configuration.
- `frontend/src/api/` — typed clients for Django endpoints.
- `frontend/src/pages/` — route-level React screens.
- `frontend/src/locales/` — the French user-interface catalogue.
- `frontend/src/styles.css` — Tailwind entry point and global styles.
- `compose.yml` — the complete development stack in one command.

The frontend currently contains a minimal landing page connected to Django's
health endpoint. The three product screens are the next frontend slices.
