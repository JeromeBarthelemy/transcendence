.PHONY: check

check:
	ruff check backend
	ruff format --check backend
	mypy backend
	python backend/manage.py makemigrations --check --dry-run
