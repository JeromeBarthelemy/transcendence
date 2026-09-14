# transcendence

Web application for a FIRST Tech Challenge robotics club: teams, members,
matches and the engineering notebook. *ft_transcendence*, 42 common core.

One deployment serves one club, locally. The code is English, the interface
is French: model, field and function names, comments and docstrings are
English, while `verbose_name`, choice labels and validation messages stay
French because they are displayed as-is.

## Getting started

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

## Trying it out

With the server running, open <http://127.0.0.1:8000/admin/> and sign in
with the email and password given to `createsuperuser`.

- Type the address with `http://`. The development server only speaks HTTP;
  a browser that tries HTTPS reports an SSL error. If it keeps switching to
  HTTPS, use <http://localhost:8000/admin/> instead.
- The site root returns 404: `admin/` is the only route so far.

HTTPS, which the subject requires on every connection to the backend, will
be handled by a proxy in front of Django once the project runs in Docker —
not by the development server.

## Checking

```sh
make check
```

Runs Ruff (lint and formatting) and mypy, from the activated virtual
environment. It must pass before every commit.

## What is here so far

- `backend/config/` — Django settings, read from `.env`.
- `backend/club/` — the foundation: accounts, teams, seasons, memberships.

Nothing is user-facing yet; everything else will depend on it.
