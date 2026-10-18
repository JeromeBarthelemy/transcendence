.PHONY: check check-error-codes demo down e2e format reset test up

COMPOSE = docker compose -f compose.prod.yml
MANUAL_URL = https://ftc-resources.firstinspires.org/ftc/game/cm-html/BIOBUZZ%20Competition%20Manual%20-%20TU05.htm
QA_URL = https://game-qa.firstinspires.org/boards/2027/FTC/QA

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

# Not part of `test`: it builds and starts a whole production stack.
e2e:
	scripts/e2e.sh

up:
	$(COMPOSE) up --build -d

down:
	$(COMPOSE) down

demo:
	$(COMPOSE) exec backend python manage.py seed_demo \
		--manual-url "$(MANUAL_URL)" --qa-url "$(QA_URL)"

# Only the database and the uploads: the models and the certificate stay, so
# the next `make up` downloads nothing. Volumes are named after the project,
# which follows the clone's folder name.
reset: down
	project=$$($(COMPOSE) config | sed -n 's/^name: //p'); \
		docker volume rm -f $${project}_sqlite_data $${project}_media_files
