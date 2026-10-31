#!/usr/bin/env bash
# DATABASE.md, C1: rebuilds the "2 million rows" scenario in a throwaway database
# and times the slow staff-dashboard query before and after the fix.
# It never touches the app's own `portal` database.
#
#   infra/db-perf/c1-slow-query.sh                    # 2M rows, 3 runs per query, then drops the database
#   ROWS=500000 RUNS=5 KEEP=1 infra/db-perf/c1-slow-query.sh
#
# Env: ROWS (default 2000000, at least 400000 so OFFSET 40000 still finds rows),
#      RUNS (runs per query), KEEP=1 (keep the database to explore it with psql),
#      PG_CONTAINER (defaults to the compose `db` service, then `portal-db-test`).
set -euo pipefail

ROWS=${ROWS:-2000000}
RUNS=${RUNS:-3}
DB=perf_c1
CONTAINER=${PG_CONTAINER:-$(docker compose ps -q db 2>/dev/null || true)}
CONTAINER=${CONTAINER:-portal-db-test}
PLANS=${PLANS:-$(mktemp -d)/c1-plans.txt}

psql() { docker exec -i "$CONTAINER" psql -U portal -X -q -v ON_ERROR_STOP=1 "$@"; }
# Docker's default 64 MB /dev/shm is too small for parallel workers on this much data.
SESSION='SET max_parallel_workers_per_gather = 0; SET max_parallel_maintenance_workers = 0;'

if (( ROWS < 400000 )); then
  echo "ROWS=$ROWS is too small: about 10% of rows match, and the query skips 40,000." >&2
  exit 1
fi

echo "Building $DB with $ROWS requests in container $CONTAINER (takes a few minutes)..."
# FORCE: a run stopped with Ctrl-C can leave a session behind; this database is ours alone.
psql -d portal -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
psql -d "$DB" <<SQL
$SESSION
CREATE TABLE users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name  text NOT NULL
);
INSERT INTO users (email, name)
SELECT 'user' || g || '@example.com', 'User ' || g FROM generate_series(1, 50000) g;

-- As in the brief: category is free text in mixed case, hence its LOWER(category).
CREATE TABLE service_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid NOT NULL REFERENCES users (id),
  order_number text NOT NULL,
  category     text NOT NULL,
  description  text NOT NULL,
  status       text NOT NULL,
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- One year of requests from 2026-11-01: 20% open (NEW or IN_REVIEW), half of all
-- requests "damaged delivery" in three spellings, so about 10% match the dashboard filter.
WITH u AS (SELECT array_agg(id) AS ids FROM users)
INSERT INTO service_requests (customer_id, order_number, category, description, status, created_at)
SELECT u.ids[1 + g % 50000],
       'SO-' || g,
       (ARRAY['damaged_delivery', 'DAMAGED_DELIVERY', 'Damaged_Delivery',
              'wrong_item', 'quality_issue', 'other'])[1 + g * 7 % 6],
       repeat('Pallet arrived with broken tiles. ', 8),
       CASE WHEN g % 10 = 0 THEN 'NEW' WHEN g % 10 = 1 THEN 'IN_REVIEW'
            WHEN g % 10 < 8 THEN 'RESOLVED' ELSE 'REJECTED' END,
       timestamptz '2026-11-01' + g * (interval '1 year' / $ROWS)
FROM generate_series(1, $ROWS) g, u;

-- The indexes the table has at launch.
CREATE INDEX service_requests_status_created_idx ON service_requests (status, created_at DESC);
CREATE INDEX service_requests_customer_created_idx ON service_requests (customer_id, created_at DESC);
VACUUM (ANALYZE, PARALLEL 0) service_requests;
ANALYZE users;
SQL

# EXPLAIN ANALYZE each query RUNS times; report the first (coldest) and the best run,
# and how the best run compares with the original query's best run (the first query timed).
# The full plan of each first run goes to $PLANS.
BASELINE=
# "12.58% faster (1.1x)" for time $2 against baseline $1.
vs() {
  awk -v b="$1" -v t="$2" 'BEGIN {
    if (t <= b) printf "%.2f%% faster (%.1fx)", (1 - t / b) * 100, b / t
    else        printf "%.2f%% slower", (t / b - 1) * 100 }'
}
time_query() {
  local label=$1 sql=$2 out times=() best change
  for i in $(seq "$RUNS"); do
    out=$(psql -d "$DB" -c "$SESSION" -c "EXPLAIN (ANALYZE, BUFFERS) $sql")
    (( i == 1 )) && printf '\n===== %s =====\n%s\n' "$label" "$out" >> "$PLANS"
    times+=("$(awk '/Execution Time/ { print $3 }' <<<"$out")")
  done
  best=$(printf '%s\n' "${times[@]}" | sort -n | head -1)
  if [[ -z $BASELINE ]]; then
    BASELINE=$best
    change=baseline
  else
    change=$(vs "$BASELINE" "$best")
  fi
  printf '%-52s %10s %10s   %s\n' "$label" "${times[0]}" "$best" "$change"
}

ORIGINAL="
SELECT r.*, u.name, u.email
FROM service_requests r
JOIN users u ON u.id = r.customer_id
WHERE r.status IN ('NEW', 'IN_REVIEW')
  AND LOWER(r.category) = 'damaged_delivery'
  AND DATE(r.created_at) >= '2026-09-01'
ORDER BY r.created_at DESC
LIMIT 20 OFFSET 40000"

FIXED_SELECT="
SELECT r.id, r.order_number, r.category, r.status, r.created_at, u.name
FROM service_requests r
JOIN users u ON u.id = r.customer_id
WHERE r.status IN ('NEW', 'IN_REVIEW')
  AND lower(r.category) = 'damaged_delivery'
  AND r.created_at >= timestamptz '2026-09-01 00:00:00+00'"

: > "$PLANS"
printf '\n%-52s %10s %10s   %s\n' "Query (execution time in ms)" "first run" "best run" "best vs original"
time_query "1. Original query, launch indexes" "$ORIGINAL"

echo "   ...creating the partial index (CONCURRENTLY, writes keep working)"
psql -d "$DB" -c "$SESSION" -c "
CREATE INDEX CONCURRENTLY service_requests_open_category_created_idx
  ON service_requests (lower(category), created_at DESC, id DESC)
  WHERE status IN ('NEW', 'IN_REVIEW')"
psql -d "$DB" -c "ANALYZE service_requests"

time_query "2. Original query, new index" "$ORIGINAL"
time_query "3. Rewritten query, still OFFSET 40000" "$FIXED_SELECT
ORDER BY r.created_at DESC, r.id DESC
LIMIT 20 OFFSET 40000"

# Cursor = (created_at, id) of the last row on the previous page, i.e. row 40,000.
CURSOR=$(psql -d "$DB" -At -c "
SELECT format('%L::timestamptz, %L::uuid', created_at, id)
FROM service_requests
WHERE status IN ('NEW', 'IN_REVIEW') AND lower(category) = 'damaged_delivery'
ORDER BY created_at DESC, id DESC
OFFSET 39999 LIMIT 1")

time_query "4. Rewritten query, keyset at the same depth" "$FIXED_SELECT
  AND (r.created_at, r.id) < ($CURSOR)
ORDER BY r.created_at DESC, r.id DESC
LIMIT 21"
time_query "5. Rewritten query, first page" "$FIXED_SELECT
ORDER BY r.created_at DESC, r.id DESC
LIMIT 21"
psql -d "$DB" -At -c "
SELECT 'Index sizes: new partial ' || pg_size_pretty(pg_relation_size('service_requests_open_category_created_idx'))
    || ', launch (status, created_at) ' || pg_size_pretty(pg_relation_size('service_requests_status_created_idx'))"
echo "Full plans: $PLANS"

if [[ ${KEEP:-} == 1 ]]; then
  echo "Kept database $DB: docker exec -it $CONTAINER psql -U portal -d $DB"
else
  psql -d portal -c "DROP DATABASE $DB WITH (FORCE)"
  echo "Dropped database $DB."
fi
