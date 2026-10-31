#!/usr/bin/env bash
# Load test against the running Docker stack (start it first: docker compose up).
#   infra/load-test/run.sh                                  # seed 50,000 requests, 20 users for 60 s
#   ROWS=0 USERS=50 infra/load-test/run.sh                  # no extra data, stress with 50 users
#   infra/load-test/run.sh cleanup                          # remove everything the load test added
set -euo pipefail
cd "$(dirname "$0")/../.."

ROWS=${ROWS:-50000}
DURATION=${DURATION:-60}
psql() { docker compose exec -T db psql -U portal -d portal -v ON_ERROR_STOP=1 "$@"; }

if [[ ${1:-} == cleanup ]]; then
  psql -q < infra/load-test/cleanup.sql
  echo "Removed the load-test data."
  exit 0
fi

if ! curl -sf http://localhost:4000/health >/dev/null; then
  echo "The stack isn't running or isn't healthy. Start it with: docker compose up" >&2
  exit 1
fi

if (( ROWS > 0 )); then
  echo "Seeding $ROWS requests..."
  psql -q -v n="$ROWS" < infra/load-test/seed.sql
fi
echo "Requests in the database: $(psql -At -c 'select count(*) from service_requests')"
echo

START=$(psql -At -c 'select now()')
(
  sleep $(( DURATION / 2 ))
  echo "Resource use halfway through the run:"
  docker stats --no-stream --format '  {{.Name}}: CPU {{.CPUPerc}}, memory {{.MemUsage}}'
  echo
) &
STATS=$!

status=0
DURATION=$DURATION node infra/load-test/load-test.mjs || status=$?
wait $STATS 2>/dev/null || true

echo
echo "Health after the run: $(curl -s http://localhost:4000/health)"
echo "Waiting for this run's status-change emails to finish (retries included)..."
for _ in $(seq 1 60); do
  pending=$(psql -At -c "select count(*) from notifications where created_at >= '$START' and status = 'PENDING'")
  [[ $pending == 0 ]] && break
  sleep 2
done
echo "Emails owed by this run's status changes:"
psql -c "select status, count(*) from notifications where created_at >= '$START' group by status order by status"
exit $status
