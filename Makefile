.PHONY: check format test

check:
	ruff check backend
	ruff format --check backend
	mypy backend
	python backend/manage.py makemigrations --check --dry-run
	npm --prefix frontend run typecheck
	npm --prefix frontend run lint

format:
	ruff format backend
	npm --prefix frontend run format

test:
	pytest
	npm --prefix frontend test
