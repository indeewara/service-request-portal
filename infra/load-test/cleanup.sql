-- Removes everything the load test added: seeded requests (SO-LOAD-…) and the
-- ones it created (SO-LT-…), with their history, photos and emails.
BEGIN;
CREATE TEMP TABLE load_requests ON COMMIT DROP AS
  SELECT id FROM service_requests
  WHERE order_number LIKE 'SO-LOAD-%' OR order_number LIKE 'SO-LT-%';
DELETE FROM notifications WHERE request_id IN (SELECT id FROM load_requests);
DELETE FROM attachments WHERE request_id IN (SELECT id FROM load_requests);
DELETE FROM request_status_history WHERE request_id IN (SELECT id FROM load_requests);
DELETE FROM service_requests WHERE id IN (SELECT id FROM load_requests);
COMMIT;
