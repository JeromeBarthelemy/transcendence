.PHONY: check check-error-codes format test

check: check-error-codes
	ruff check backend
	ruff format --check backend
	mypy backend
	python backend/manage.py makemigrations --check --dry-run
	npm --prefix frontend run typecheck
	npm --prefix frontend run lint

check-error-codes:
	python backend/check_error_codes.py

format:
	ruff format backend
	npm --prefix frontend run format

test:
	pytest
	npm --prefix frontend test
