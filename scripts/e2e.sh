#!/bin/sh
# The end-to-end suite (frontend/e2e), against a throwaway production stack
# filled by seed_demo: its own Compose project, so its database never touches
# the one in use, and removed afterwards whatever the outcome. Arguments go to
# `playwright test`, e.g. `scripts/e2e.sh --project=firefox`.
set -eu
cd "$(dirname "$0")/.."

compose() {
	docker compose -p fieldnotes-e2e -f compose.prod.yml "$@"
}
trap 'compose down -v --remove-orphans' EXIT

compose up --build -d cert-init backend proxy
# Two minutes at most: a stack that never answers fails here, not at CI's
# own timeout.
tries=120
until curl -fsk -o /dev/null https://localhost/api/auth/me/; do
	tries=$((tries - 1))
	if [ "$tries" -le 0 ]; then
		echo "The stack did not answer at https://localhost within two minutes." >&2
		exit 1
	fi
	sleep 1
done
compose exec -T backend python manage.py seed_demo
(cd frontend && npx playwright test "$@")
