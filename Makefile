.PHONY: check

check:
	ruff check backend
	ruff format --check backend
	mypy backend
