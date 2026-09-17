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
The Django administration interface may keep its existing French labels, but
the API does not return French prose as its contract. API failures use stable,
machine-readable codes:

```json
{
  "errors": [
    {
      "field": "email",
      "code": "email_already_used",
      "params": {}
    }
  ]
}
```

React translates `code`, uses `field` to display the error beside the correct
control, and uses `params` for dynamic values. Unknown codes fall back to a
generic French message.

Django remains responsible for validation, permissions, HTTP status codes and
preventing invalid operations. React is responsible only for translating and
presenting API errors. Consequently, the backend needs no translation
catalogue for API errors.

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

## Checking

### Backend

```sh
make check
```

Runs Ruff (lint and formatting), mypy, and a check that no model change
is missing its migration, from the activated virtual environment. It must
pass before every commit.

### Frontend

Check the frontend types and production build separately for now:

```sh
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

`typecheck` validates the TypeScript contracts without producing files;
`build` repeats that validation and creates the optimized production assets in
`frontend/dist/`.

## Testing

### Backend

```sh
make test
```

Runs the suite with pytest and pytest-django — not `manage.py test`. Tests
live next to the code, under `backend/<app>/tests/`. Every test has database
access without `@pytest.mark.django_db` (see `backend/conftest.py`).

### Frontend

The initial frontend skeleton has no automated component tests yet. Until
Vitest and React Testing Library are introduced with the first tested feature,
verify it with the type-check, production build and browser checks described
above. The health check exercises TanStack Query and the development proxy end
to end; domain API clients will add component tests with their first features.

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
in French.

## What is here so far

- `backend/config/` — Django settings, read from `.env`.
- `backend/club/` — accounts, teams, seasons, memberships, and the rules that
  govern signing up: two identifiers, a reserved domain, a contact address.
- `backend/config/views.py` — the minimal health endpoint used by the frontend.
- `frontend/src/app/` — shared router and TanStack Query configuration.
- `frontend/src/api/` — typed clients for Django endpoints.
- `frontend/src/pages/` — route-level React screens.
- `frontend/src/locales/` — the French user-interface catalogue.
- `frontend/src/styles.css` — Tailwind entry point and global styles.
- `compose.yml` — the complete development stack in one command.

The frontend currently contains a minimal landing page connected to Django's
health endpoint. The three product screens are the next frontend slices.
