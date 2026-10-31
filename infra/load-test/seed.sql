-- Adds :n requests (order numbers SO-LOAD-…) spread over the past year, each with
-- its status history: about 20% NEW, 20% IN_REVIEW, 40% RESOLVED, 20% REJECTED.
-- Run by run.sh: psql -v n=50000 < seed.sql
BEGIN;

WITH people AS (
  SELECT (SELECT id FROM users WHERE email = 'alice@example.com') AS alice,
         (SELECT id FROM users WHERE email = 'bob@example.com')   AS bob
), inserted AS (
  INSERT INTO service_requests (customer_id, order_number, category, description, status, created_at, updated_at)
  SELECT CASE WHEN g % 2 = 0 THEN p.alice ELSE p.bob END,
         'SO-LOAD-' || g,
         (ARRAY['DAMAGED_DELIVERY', 'WRONG_ITEM', 'QUALITY_ISSUE', 'OTHER']::request_category[])[1 + g % 4],
         'Load-test request ' || g,
         (ARRAY['NEW', 'IN_REVIEW', 'RESOLVED', 'REJECTED', 'RESOLVED']::request_status[])[1 + (g * 7) % 5],
         t, t
  FROM generate_series(1, :n) g,
       people p,
       LATERAL (SELECT now() - random() * interval '365 days' AS t) created
  RETURNING id, customer_id, status, created_at
), staff AS (
  SELECT id FROM users WHERE email = 'staff@example.com'
)
INSERT INTO request_status_history (request_id, from_status, to_status, changed_by, changed_at)
SELECT id, NULL::request_status, 'NEW'::request_status, customer_id, created_at FROM inserted
UNION ALL
SELECT i.id, 'NEW', 'IN_REVIEW', s.id, i.created_at + interval '1 hour'
FROM inserted i, staff s WHERE i.status <> 'NEW'
UNION ALL
SELECT i.id, 'IN_REVIEW', i.status, s.id, i.created_at + interval '1 day'
FROM inserted i, staff s WHERE i.status IN ('RESOLVED', 'REJECTED');

COMMIT;
ANALYZE service_requests;
ANALYZE request_status_history;
