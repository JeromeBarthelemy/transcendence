# transcendence

Web application for a FIRST Tech Challenge robotics club: teams, members,
matches and the engineering notebook. *ft_transcendence*, 42 common core.

One deployment serves one club, locally. The code is English, the interface
is French: model, field and function names, comments and docstrings are
English, while `verbose_name`, choice labels and validation messages stay
French because they are displayed as-is.

The concept note, the module table and the schema live in a separate
repository: [transcendence-notes](https://github.com/JeromeBarthelemy/transcendence-notes).

## Getting started

```sh
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt

cp backend/.env.example backend/.env
# Fill in DJANGO_SECRET_KEY — see the comment in the file.

python backend/manage.py migrate
python backend/manage.py createsuperuser
python backend/manage.py runserver
```

`.env` is never versioned: everyone keeps their own.

## What is here so far

- `backend/config/` — Django settings, read from `.env`.
- `backend/club/` — the foundation: accounts, teams, seasons, memberships.

Nothing is user-facing yet; everything else will depend on it.
