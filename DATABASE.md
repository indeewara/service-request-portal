# Part C: Database and production readiness

Every SQL statement here was run against a copy with 2,000,000 `service_requests` rows, built with `generate_series`. The copy ran on PostgreSQL 16 in Docker on a laptop, with a cold cache and parallel workers off. The timings show the shape of the problem; production numbers will differ.

**Reproduce C1:** with the database container running, run `infra/db-perf/c1-slow-query.sh` (about 2 minutes). See [How I proved it worked](#4-how-i-proved-it-worked) for what it does and how to read the results.

- [C1. A slow query](#c1-a-slow-query)
- [C2. Moving category to its own table with no downtime](#c2-moving-category-to-its-own-table-with-no-downtime)

---

## C1. A slow query

```sql
SELECT r.*, u.name, u.email
FROM service_requests r
JOIN users u ON u.id = r.customer_id
WHERE r.status IN ('NEW', 'IN_REVIEW')
  AND LOWER(r.category) = 'damaged_delivery'
  AND DATE(r.created_at) >= '2026-09-01'
ORDER BY r.created_at DESC
LIMIT 20 OFFSET 40000;
```

### 1. How I would investigate

Measure first, then change things. Three steps:

1. **Confirm it's this query.** Rank queries by total time in `pg_stat_statements`, and check that the API logs for `GET /requests` show the same ~6 s. That rules out the API code or the network.
2. **Read the real plan.** Run `EXPLAIN (ANALYZE, BUFFERS)` on a read replica or a restored copy, never on the primary at peak. Look for estimated vs actual rows, `Rows Removed by Filter`, sorts spilling to disk, and pages read from disk. In production, `auto_explain` logs the plan of anything slower than 1 s.
3. **Rule out table health.** Stale statistics or bloat call for `ANALYZE`/`VACUUM`, not a new index. Check `pg_stat_user_tables` for an old `last_autoanalyze`, a high `n_dead_tup`, and far more `seq_scan` than `idx_scan`.

<details>
<summary>The SQL for each step</summary>

```sql
-- 1. Top queries by total time; temp_blks_written > 0 means sorts spilled to disk
SELECT calls, round(mean_exec_time) AS mean_ms, round(max_exec_time) AS max_ms,
       shared_blks_read, temp_blks_written, left(query, 80) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;

-- 2. The real plan (it actually runs the query)
EXPLAIN (ANALYZE, BUFFERS, SETTINGS) SELECT ... ;

-- 3. Table health
SELECT n_live_tup, n_dead_tup, last_autoanalyze, last_autovacuum, seq_scan, idx_scan
FROM pg_stat_user_tables
WHERE relname = 'service_requests';
```

</details>

### 2. What I found

> **In short:** to show 20 rows, the query examines about **1.4 million rows**, sorts 200,000 of them **on disk**, and throws away everything except 20.

#### How I tested

- I built a test database with **2 million requests** and 50,000 customers ([infra/db-perf/c1-slow-query.sh](infra/db-perf/c1-slow-query.sh)).
- I ran the brief's query with `EXPLAIN (ANALYZE, BUFFERS)`. That really runs the query and reports what Postgres did at each step, and how long each step took.
- **It took 19.2 seconds.** About 200,000 requests match the filter (open, damaged delivery, since 1 September).

#### What Postgres did, in order

To show the 20 rows of page 2,001, Postgres:

1. **Fetched all 400,000 open requests.** That was the only index it could use.
2. **Checked about 1 million rows a second time,** because its list of matches got too big for memory.
3. **Kept the 200,000 damaged-delivery requests** and dropped the rest.
4. **Looked up the customer** (name and email) for all 200,000.
5. **Sorted all 200,000 on disk:** 78 MB, too big for memory.
6. **Skipped the first 40,000** (pages 1 to 2,000).
7. **Returned 20.**

Only steps 1 and 7 are really needed. Everything in between is waste.

#### Why each step was so expensive

**Problem 1: Postgres had to guess how many rows would match, and guessed badly.**
- It **expected 661 rows; 200,000 came back**, 300 times more.
- **Why:** the query wraps the columns in functions, `LOWER(category)` and `DATE(created_at)`. Postgres keeps statistics about columns, not about function results, so it had to guess.
- **Effect:** it picked a plan suited to a few hundred rows, and that plan fell apart at 200,000.

**Problem 2: The indexes couldn't help with category or date.**
- An index is sorted by the column's real value. It can't answer questions about `LOWER(category)` or `DATE(created_at)`.
- So Postgres used the only index that worked, on `status`, fetched **every** open request, and checked category and date **one row at a time**.

**Problem 3: The list of matches overflowed memory.**
- Postgres keeps a list of the rows that matched. With 400,000 matches, the list didn't fit in memory.
- So it switched to remembering **whole disk pages** instead of individual rows, then had to **re-check every row on those pages**: **about 1 million extra checks**.

**Problem 4: It did expensive work on rows it would throw away.**
- Postgres can't know which 20 rows to show until everything is sorted.
- So it looked up the customer for **all 200,000** rows, not just the 20 on screen.

**Problem 5: The sort was huge and spilled to disk.**
- `SELECT r.*` carries **every column** through the sort, including the long customer `description`, plus `u.email`, which the page doesn't even show.
- 200,000 wide rows came to **78 MB**, too big for memory, so Postgres sorted on disk, which is much slower.

**Problem 6: `OFFSET` threw away 40,000 rows.**
- `OFFSET 40000` means "skip pages 1 to 2,000". Postgres has to produce those rows just to skip them.
- **Every page is slower than the one before.** Page 2,001 is far slower than page 1.

#### Found along the way: two problems that give wrong results

These don't make the query slow, but they make it unreliable.

**Problem 7: The date depends on the server's time zone.**
- `DATE(created_at)` uses the database session's time zone.
- A request made at **31 Aug, 22:00 UTC** counts as "31 August" on a server set to UTC, but as "1 September" on one set to Sri Lanka time (+05:30).
- **The same query can return different rows on different servers.**

**Problem 8: Requests with the same timestamp have no fixed order.**
- `ORDER BY created_at` alone doesn't say which comes first when two requests share a timestamp. Postgres may order them differently each time.
- **While paging, a request can show up on two pages, or on none.** A missed request means a customer's case silently disappears from the triage list.

#### Each problem and its fix

**Why it's slow** (problems 1–6) → speed fixes:

| # | Problem | Fix |
|---|---|---|
| 1 | Postgres guessed 661 rows; 200,000 came back | [Speed fix 1](#speed-fix-1-dont-wrap-columns-in-functions): no functions on columns, and [Speed fix 3](#speed-fix-3-a-small-index-built-for-the-dashboard): index the `lower(category)` expression |
| 2 | Indexes couldn't help, so rows were checked one by one | [Speed fix 3](#speed-fix-3-a-small-index-built-for-the-dashboard): a new index on `lower(category), created_at, id` for open requests |
| 3 | The match list overflowed; 1 million extra checks | [Speed fix 3](#speed-fix-3-a-small-index-built-for-the-dashboard): the index finds only matching rows, already in order |
| 4 | Customer looked up for 200,000 rows | [Speed fix 4](#speed-fix-4-keyset-paging-instead-of-offset): keyset paging, so Postgres stops after 21 rows |
| 5 | A 78 MB sort on disk | [Speed fix 2](#speed-fix-2-select-only-the-columns-the-page-shows): only the columns the page shows, and [Speed fix 3](#speed-fix-3-a-small-index-built-for-the-dashboard): rows come pre-sorted |
| 6 | 40,000 rows thrown away | [Speed fix 4](#speed-fix-4-keyset-paging-instead-of-offset): keyset paging instead of `OFFSET` |

**Found along the way** (problems 7–8) → correctness fixes:

| # | Problem | Fix |
|---|---|---|
| 7 | Results depend on the server's time zone | [Fix A](#fix-a-state-the-time-zone): compare `created_at` with an explicit UTC timestamp |
| 8 | Requests can repeat or vanish between pages | [Fix B](#fix-b-add-a-tie-breaker-to-the-sort): sort by `created_at DESC, id DESC` |

### 3. The fixes

The task was to find **why the dashboard is slow**. The four **speed fixes** answer that:
- **Speed fixes 1–2** change the query.
- **Speed fix 3** adds an index.
- **Speed fix 4** changes the API.

The big gain comes from **speed fixes 3 and 4 together**. Neither is enough on its own.

While investigating, I also found **two bugs that give wrong results** without making the query slower. They're fixed separately, as **correctness fixes A and B**.

**Before:**
```sql
SELECT r.*, u.name, u.email
FROM service_requests r
JOIN users u ON u.id = r.customer_id
WHERE r.status IN ('NEW', 'IN_REVIEW')
  AND LOWER(r.category) = 'damaged_delivery'
  AND DATE(r.created_at) >= '2026-09-01'
ORDER BY r.created_at DESC
LIMIT 20 OFFSET 40000;
```

**After:**
```sql
SELECT r.id, r.order_number, r.category, r.status, r.created_at, u.name   -- speed fix 2
FROM service_requests r
JOIN users u ON u.id = r.customer_id
WHERE r.status IN ('NEW', 'IN_REVIEW')
  AND lower(r.category) = 'damaged_delivery'                              -- uses the speed fix 3 index
  AND r.created_at >= timestamptz '2026-09-01 00:00:00+00'                -- speed fix 1 + fix A (UTC)
  AND (r.created_at, r.id) < ($1, $2)                                     -- speed fix 4: the bookmark
ORDER BY r.created_at DESC, r.id DESC                                     -- fix B
LIMIT 21;                                                                 -- speed fix 4: a 21st row means a next page
```

---

#### Speed fixes

##### Speed fix 1: Don't wrap columns in functions

**What changed:**
```sql
-- before: DATE() runs on every row, so the index on created_at can't be used
AND DATE(r.created_at) >= '2026-09-01'

-- after: the column is left alone; the date is turned into a timestamp once
AND r.created_at >= timestamptz '2026-09-01 00:00:00+00'
```

**Why it helps:**
- An index on `created_at` stores the raw `created_at` values, not `DATE(created_at)`. Once the column is wrapped in a function, Postgres can't use that index, so it computes `DATE()` for **every row** and checks each one. With the bare column, it jumps straight to 1 September in the index.
- Postgres keeps statistics about columns, not about function results. With the bare column, its row estimates are accurate again (Problem 1).

**The rule:** keep the column bare, and do any converting on the **value** you compare it with.

| Slow (converts the column) | Fast (converts the value) |
|---|---|
| `DATE(created_at) >= '2026-09-01'` | `created_at >= '2026-09-01 00:00+00'` |
| `DATE(created_at) <= '2026-09-30'` | `created_at < '2026-10-01 00:00+00'` |

For an end date, compare with the start of the next day (`created_at < '2026-10-01'`), not `<= '2026-09-30'`, which would miss most of 30 September.

**Why `lower(category)` stays, for now:** the data has several spellings (`damaged_delivery`, `DAMAGED_DELIVERY`, `Damaged_Delivery`), so we still need `lower()` to match them all. Instead of removing it, speed fix 3 builds the index on `lower(category)` itself, so the index can be used. Once [C2](#c2-moving-category-to-its-own-table-with-no-downtime) moves categories to their own table, the filter becomes `category_id = …`, with no function at all.

---

##### Speed fix 2: Select only the columns the page shows

**What changed:**
```sql
-- before: every column, plus the customer's email
SELECT r.*, u.name, u.email

-- after: exactly what the dashboard table shows
SELECT r.id, r.order_number, r.category, r.status, r.created_at, u.name
```

**Why it helps:**
- The dashboard shows order number, category, status and date. `r.*` also fetches the long customer `description` and every other column, and `u.email` isn't shown at all.
- Postgres sorts **whole rows**. Wider rows mean a bigger sort. In the test, the sort written to disk went from **78 MB to 15 MB**, for the same 200,000 rows.
- **Privacy, as a bonus:** email and description are personal data. If the page doesn't show them, the query shouldn't fetch them. Data that isn't fetched can't leak into a log or an error message.
- `id` stays in: each row links to its detail page, and speed fix 4 needs it for the bookmark.


---

##### Speed fix 3: A small index built for the dashboard

```sql
CREATE INDEX CONCURRENTLY service_requests_open_category_created_idx
  ON service_requests (lower(category), created_at DESC, id DESC)
  WHERE status IN ('NEW', 'IN_REVIEW');
```

- No existing index had **category**, so Postgres fetched all 400,000 open requests and checked category one by one.
- This index groups open requests by category, newest first, so Postgres reads the matching rows already sorted.
- It holds only open requests: 24 MB, against 76 MB for the old status index.
- `CONCURRENTLY` only means writes aren't blocked while it's built; it doesn't affect speed.

On its own, the index makes little reliable difference while `OFFSET` stays: warm runs vary between about 0.9 and 2 s either way. Together with keyset paging (speed fix 4), it takes the query to about 0.15 ms.

---

##### Speed fix 4: Keyset paging instead of OFFSET

`OFFSET 40000` makes Postgres produce and throw away 40,000 rows to return 20, so every page is slower than the last. Instead, the next page starts after the last row the client saw:

```sql
AND (r.created_at, r.id) < ($1, $2)    -- created_at and id of the last row seen
ORDER BY r.created_at DESC, r.id DESC
LIMIT 21                               -- a 21st row means there is a next page
```

- With the speed fix 3 index, Postgres jumps straight to that row and reads 21 entries.
- The API returns `nextCursor` (that row's `created_at` and `id`, encoded). The web app keeps it in the URL (`/staff?status=NEW&cursor=…`), so filtered views stay bookmarkable.
- **Result: 867 ms → 0.15 ms**, and page 2,001 costs the same as page 1.
- **Trade-off:** Next/Previous only, no jumping to page 37.

---

#### Correctness fixes found along the way

These two don't make the query faster. The investigation turned them up, and they make the results reliable.

##### Fix A: State the time zone

**What changed:**
```sql
-- before: "1 September" in whatever time zone the database session uses
AND DATE(r.created_at) >= '2026-09-01'

-- after: 1 September, midnight UTC, the same on every server
AND r.created_at >= timestamptz '2026-09-01 00:00:00+00'
```

**Why it matters:**
- `DATE()` on a `timestamptz` uses the session's time zone setting.
- A request made at **31 Aug, 22:00 UTC** counts as "31 August" on a server set to UTC, but as "1 September" on one set to Sri Lanka time (+05:30).
- So the same query could return different rows depending on how a server is configured.

**The fix:** speed fix 1 already turns the date into a timestamp. Writing the zone explicitly (`+00`) means everyone gets the same boundary. The portal works in UTC. If the business worked in a local zone, the boundary would be written in that zone instead (`'2026-09-01 00:00 Asia/Colombo'`).

---

##### Fix B: Add a tie-breaker to the sort

**What changed:**
```sql
-- before
ORDER BY r.created_at DESC

-- after
ORDER BY r.created_at DESC, r.id DESC
```

**Why it matters:**
- Two requests can have **exactly the same `created_at`**. `now()` is the time the *transaction* started, so all rows inserted in one transaction share it; imports and backfills do the same.
- With a tie, the order between those rows is **undefined**, and it can change from one query to the next. While paging, a request can appear **on two pages, or on none**. A missed request is a customer's case silently gone from the triage list.
- `id` is unique, so every row gets exactly one fixed place in the order.

**The speed fixes depend on it:**
- **Speed fix 3:** the index is sorted by `created_at DESC, id DESC`, exactly like the query, so Postgres can read rows straight from the index with no sort.
- **Speed fix 4:** the bookmark needs a unique position.

**Does it cost anything?** No. The speed fix 3 index already contains `id`, in the same position and direction. (The primary-key index on `id` alone wouldn't help here, because it's sorted by `id` only. It's `id` inside the *same* index that matters.)

---

### 4. How I proved it worked

#### On a test copy

**Run it yourself:** `infra/db-perf/c1-slow-query.sh`, about 2 minutes. It:
1. builds a throwaway database with 2 million requests (category in three spellings, about 10% matching the filter);
2. runs each version of the query several times with `EXPLAIN ANALYZE`, and reports the first and best run;
3. saves every query plan to a file;
4. deletes the database.

The build time isn't counted. Each number is only Postgres's own execution time for that one query.

**Results:**

| Version | Cold (first test) | Warm (script, best run) |
|---|---|---|
| 1. Original query | **19,220 ms** | **1,592 ms** |
| 2. Original query + new index | — | 899 ms |
| 3. Rewritten query + new index, still `OFFSET` | 4,608 ms | 867 ms |
| 4. **Rewritten query + new index + keyset** (page 2,001) | **8 ms** | **0.15 ms** |
| 5. Same, first page | 21 ms | 0.10 ms |

- **Cold:** data read from disk, as after a restart.
- **Warm:** data already in memory, as when the script has just built it.
- The exact times depend on the machine and the cache. **The pattern is the same in both.**

**What the numbers show:**
- **The index alone doesn't fix it** (rows 1–3). Cold, it saves a lot of disk reading (19 s → 4.6 s). Warm, rows 1–3 all land between about 0.9 and 2 s and swap order from run to run, because `OFFSET` still fetches and sorts 200,000 rows.
- **Keyset paging is the fix** (rows 3 → 4): from 867 ms to 0.15 ms, close to 6,000 times faster.
- **Every page costs the same** (rows 4 and 5): page 2,001 is as fast as page 1.

**What the query plans show:**
- **Rows 1–3:** `Sort Method: external merge Disk`. Postgres sorts tens of thousands of rows on disk.
- **Rows 4–5:** an `Index Scan` on the new index, reading 21 rows, and **no sort at all**.

#### In production

1. **Check the plan before releasing.** Run `EXPLAIN (ANALYZE, BUFFERS)` on a replica. It must show an `Index Scan` on the new index, no `Sort` and no `Rows Removed by Filter`. Attach that plan to the pull request.
2. **Compare real traffic.** Reset `pg_stat_statements` after the release (`SELECT pg_stat_statements_reset();`), then compare the query's average and worst time over a working day against the day before.
3. **Measure what users feel.** Use the API's request logs to track p95 response time for `GET /requests`. Target: under 300 ms, and the dashboard loading in under a second.
4. **Keep it fixed.** Alert if that p95 goes up, and log any query slower than 1 second with `auto_explain`. A CI test that checks query plans breaks too easily; the alerts catch regressions instead.

<p align="right"><a href="#part-c-database-and-production-readiness">↑ Back to top</a></p>

<br>

---

<br>

## C2. Moving category to its own table with no downtime

**Goal:** replace the free-text `service_requests.category` with `category_id`, a foreign key to a new `categories` table.

**Constraints:** the portal runs 24/7, and during a deploy the old and new app versions run side by side.

**Approach: expand → migrate → contract.**
- Add the new structure next to the old one.
- Move the data and the app across.
- Remove the old column only when nothing uses it.

Every step is a separate release with its own rollback.

**Two rules in every step:**
- Schema changes run with `SET lock_timeout = '3s'`, and the deploy retries them. A change that can't get its lock gives up instead of queuing and blocking requests.
- Constraints are added `NOT VALID` (instant), then checked with `VALIDATE`, which doesn't block reads or writes.

### Step 1: Create the new table and column

```sql
SET lock_timeout = '3s';

CREATE TABLE categories (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code   text NOT NULL UNIQUE,                -- e.g. DAMAGED_DELIVERY
  name   text NOT NULL,
  active boolean NOT NULL DEFAULT true        -- staff retire categories instead of deleting them
);

-- One row per distinct category; the spelling variants collapse into one code.
INSERT INTO categories (code, name)
SELECT DISTINCT upper(trim(category)), initcap(replace(lower(trim(category)), '_', ' '))
FROM service_requests;

ALTER TABLE service_requests ADD COLUMN category_id uuid;   -- nullable: instant, no rewrite
ALTER TABLE service_requests
  ADD CONSTRAINT service_requests_category_fk
  FOREIGN KEY (category_id) REFERENCES categories (id) NOT VALID;
```

- **Old app:** unaffected. It doesn't know these exist.
- **Rollback:** drop the column and the table.

### Step 2: Add a trigger that keeps both columns filled

Old and new app versions will write rows at the same time. The trigger fills whichever column a version leaves empty, so every row always has both.

```sql
CREATE FUNCTION service_requests_sync_category() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.category_id IS NULL AND NEW.category IS NOT NULL THEN       -- old app: text only
    INSERT INTO categories (code, name)
    VALUES (upper(trim(NEW.category)), initcap(replace(lower(trim(NEW.category)), '_', ' ')))
    ON CONFLICT (code) DO NOTHING;
    SELECT id INTO NEW.category_id FROM categories WHERE code = upper(trim(NEW.category));
  ELSIF NEW.category IS NULL AND NEW.category_id IS NOT NULL THEN    -- new app: id only
    SELECT code INTO NEW.category FROM categories WHERE id = NEW.category_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER service_requests_sync_category
  BEFORE INSERT OR UPDATE OF category, category_id ON service_requests
  FOR EACH ROW EXECUTE FUNCTION service_requests_sync_category();
```

- **Rollback:** drop the trigger and the function.

### Step 3: Backfill existing rows in small batches

A background job fills `category_id` for existing rows, 5,000 at a time, each batch in its own transaction, so locks stay short.

```sql
DO $$
DECLARE last_id uuid := '00000000-0000-0000-0000-000000000000'; batch_end uuid;
BEGIN
  LOOP
    SELECT id INTO batch_end
    FROM (SELECT id FROM service_requests WHERE id > last_id ORDER BY id LIMIT 5000) b
    ORDER BY id DESC LIMIT 1;
    EXIT WHEN batch_end IS NULL;

    UPDATE service_requests r SET category_id = c.id
    FROM categories c
    WHERE r.id > last_id AND r.id <= batch_end
      AND r.category_id IS NULL
      AND c.code = upper(trim(r.category));

    COMMIT;
    last_id := batch_end;
  END LOOP;
END $$;

SELECT count(*) FROM service_requests WHERE category_id IS NULL;   -- must be 0
```

- Batches walk the table **by id range**. My first version picked batches with `WHERE category_id IS NULL LIMIT 5000` and slowed down every batch, because it rescanned rows already done.
- **Rollback:** nothing to undo; the job can stop and restart at any time.

### Step 4: Enforce the new column

```sql
-- Checks every row without blocking writes.
ALTER TABLE service_requests VALIDATE CONSTRAINT service_requests_category_fk;

-- NOT NULL via a validated CHECK, so Postgres skips a full scan under a lock.
SET lock_timeout = '3s';
ALTER TABLE service_requests
  ADD CONSTRAINT category_id_not_null CHECK (category_id IS NOT NULL) NOT VALID;
ALTER TABLE service_requests VALIDATE CONSTRAINT category_id_not_null;
ALTER TABLE service_requests ALTER COLUMN category_id SET NOT NULL;
ALTER TABLE service_requests DROP CONSTRAINT category_id_not_null;

-- The old text column no longer has to be filled by the app.
ALTER TABLE service_requests ALTER COLUMN category DROP NOT NULL;

-- C1's dashboard index, now on the id (the lower(category) one goes with the column in step 6).
CREATE INDEX CONCURRENTLY service_requests_open_category_id_created_idx
  ON service_requests (category_id, created_at DESC, id DESC)
  WHERE status IN ('NEW', 'IN_REVIEW');
```

- **Rollback:** drop the constraints and the new index, and make `category` `NOT NULL` again.

### Step 5: Release the app that uses `category_id`

- The app reads and writes **only `category_id`**, and staff get the screens to manage categories.
- The trigger keeps filling the text column, so an older version still running reads correct values.
- **Rollback:** redeploy the previous version. The text column is still complete.

You could split this into two releases (first read `category_id` while still writing both columns, then stop writing the text). Rollback is safe either way because of the trigger; two releases just keep each rollback smaller.

### Step 6: Remove the old column (after a waiting period, e.g. a week)

Once only the new app is running:

```sql
-- Keep the old values, in addition to normal backups.
CREATE TABLE service_requests_category_archive AS
  SELECT id, category FROM service_requests;

SET lock_timeout = '3s';
BEGIN;
DROP TRIGGER service_requests_sync_category ON service_requests;
DROP FUNCTION service_requests_sync_category();
ALTER TABLE service_requests DROP COLUMN category;   -- catalogue change only, no rewrite
COMMIT;
```

- **Rollback:** the only one-way step, which is why it waits and keeps an archive. To undo it: add the column back, fill it from the archive, and recreate the trigger.

### Summary

| Step | What | Old app still safe? | Rollback |
|---|---|---|---|
| 1 | New table, nullable `category_id`, FK `NOT VALID` | yes, ignores them | drop the column and table |
| 2 | Sync trigger | yes, the trigger fills the id | drop the trigger |
| 3 | Backfill in batches | yes | none needed |
| 4 | Validate the FK, `category_id NOT NULL`, text nullable | yes, the trigger fills the id | drop the constraints |
| 5 | App uses `category_id` | yes, the trigger fills the text | redeploy the previous version |
| 6 | Archive, drop the trigger and the text column | only the new app runs now | restore from the archive |

**Tested** on the same 2-million-row copy:
- adding the column: 8 ms;
- validating the foreign key: 1.2 s, without blocking;
- `SET NOT NULL`: 3 ms;
- dropping the column: 152 ms.

The trigger filled the missing column in both directions.
