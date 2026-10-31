# Service Request Portal

A first version of a portal where customers report problems with building-material deliveries (damaged, wrong item, quality issue) and service staff triage them through a simple workflow.

- **Customers** raise a request against an order, attach photos, and follow its status live.
- **Staff** triage requests on a dashboard and move them `NEW → IN_REVIEW → RESOLVED | REJECTED`.
- **Notifications**: every status change emails the customer (via a background queue) and updates their open page without a reload.

> Confidential: this repository is private. Do not publish it or the assessment brief.

---

## Repository layout

```
/api            NestJS backend (modular monolith)
/web            Next.js frontend (App Router)
/infra          LocalStack bucket setup, Part C performance script
docker-compose.yml
README.md       how to run, decisions, assumptions (this file)
DATABASE.md     Part C – slow query + zero-downtime schema change
DESIGN.md       Part D – AWS architecture, diagrams, decision records
LEADERSHIP.md   Part E – tech lead scenarios
```

## Tech stack

| Concern | Choice | Why |
|---|---|---|
| Backend | NestJS + TypeScript | Required; modules map cleanly to the monolith boundaries |
| Frontend | Next.js (App Router) + TypeScript | Required |
| Database | PostgreSQL | Partial/expression indexes, `ENUM`/`CHECK` constraints, transactional DDL for safe migrations |
| ORM / migrations | TypeORM migrations (`synchronize: false`) | First-class NestJS support; explicit SQL migrations, no auto schema sync |
| Queue | BullMQ + Redis | Built-in retries with exponential backoff, failed-job retention, `jobId` dedupe |
| Object storage | LocalStack 4.4 (S3 only) | Same SDK (`@aws-sdk/client-s3`) as real S3. MinIO was the first choice, but its official images are no longer publicly pullable |
| Live updates | Server-Sent Events | One-way server→client is all we need; plain HTTP, auto-reconnect |
| Validation | `class-validator` (API), `zod` (web) | Standard for each framework |
| Configuration | `@nestjs/config` | One typed config (`src/config/app.config.ts`), validated at start-up: a missing or invalid setting stops the API with a message listing every problem |
| Logging | `nestjs-pino` | Structured JSON logs, correlation ID per request, field redaction |
| Docs | `@nestjs/swagger` | OpenAPI at `/docs` |
| Rate limiting | `@nestjs/throttler` | Login endpoint protection |
| Tests | Vitest, Supertest (API); Testing Library, Playwright (web) | Unit / integration / component / e2e |

---

## Getting started

### Prerequisites
- Docker + Docker Compose
- Node.js 22 LTS (only to run tests outside Docker; the Nest CLI crashes on Node 23)

### Run everything
```bash
docker compose up --build
```

No `.env` file is needed: the compose file sets everything the containers use. The first run takes a few minutes while the images build. It needs ports 3000, 4000, 5432, 6379, 4566, 1025 and 8025 to be free. With Colima, keep the repository inside your home folder: Colima only shares that folder with containers by default, and otherwise LocalStack can't read its bucket setup script.

| Service | URL |
|---|---|
| Web app | http://localhost:3000 |
| API | http://localhost:4000 |
| Swagger | http://localhost:4000/docs |
| Health | http://localhost:4000/health |
| S3 (LocalStack) | http://localhost:4566 |
| Mailpit (inbox for the mock email provider) | http://localhost:8025 |

Migrations and seed data run automatically when the `api` container starts.

### Seeded logins

| Role | Email | Password |
|---|---|---|
| CUSTOMER | alice@example.com | Password123! |
| CUSTOMER | bob@example.com | Password123! |
| STAFF | staff@example.com | Password123! |

Two customers exist so cross-customer access can be tested (Alice must never see Bob's requests).

### Running the tests
```bash
# API
cd api
npm ci
cp .env.example .env  # the integration tests connect to the services on localhost
npm test              # unit: status workflow (all 16 transitions), guard, ownership rule, route access table
npm run test:e2e      # integration against real Postgres/Redis/S3/Mailpit (needs: docker compose up db redis localstack mailpit)

# Web
cd web
npm ci
npm test              # component tests: request form validation
npx playwright install chromium
npm run test:e2e      # Playwright: customer flow (desktop + mobile), axe scans, keyboard-only flow
```

The web end-to-end tests need the full stack running, and they log in many times, so start it with a higher login limit: `LOGIN_RATE_LIMIT=1000 docker compose up`. On macOS 13, where Playwright's own Chromium isn't supported, add `PLAYWRIGHT_CHANNEL=chrome` to use the installed Chrome.

---

## Part A – Backend

### Modules (boundaries)

One NestJS app, one database. Each module owns its tables (registers only its own entities) and exposes a small service; no module reads another module's tables.

| Module | Owns (tables) | Exposes | Uses |
|---|---|---|---|
| `auth` | Users (`users`), login, JWT, the global guard, `@Public`/`@Roles`, the per-request access rule | `UsersService.findContact()` | — |
| `orders` | Mocked ERP lookup (`SO-` prefix is valid) | `OrdersService.exists()` | — |
| `requests` | Requests and status workflow (`service_requests`, `request_status_history`), lists and filters | `RequestsService.findAccessible()`, the single way to load one request for a caller | `orders`, `notifications` |
| `attachments` | Photo metadata (`attachments`), pre-signed URLs, photo limits and checks, the S3 client | `StorageService` (for health) | `requests` (ownership check) |
| `notifications` | Email outbox (`notifications`), BullMQ queue and worker, mock email provider, live-update events (Redis pub/sub) | `NotificationsService.recordStatusChange()`, `RequestEventsService` | `auth` (recipient's email and name, only inside the worker) |
| `health` | `GET /health` | — | database, `notifications` queue, `attachments` storage |

`src/common/` is shared plumbing, not a module: error filter, correlation id, logging config.

**Direction of dependencies.** `requests` calls `notifications` directly after a status change: it records the email in the same transaction (outbox), then enqueues the job and publishes the live event after commit. `notifications` never calls back into `requests` and imports nothing from it; the status enum they share lives in `src/common/`. So dependencies point one way: `attachments → requests → notifications → auth`.

**Why direct calls, not domain events.** With one consumer per change, an in-process event bus would add indirection without decoupling anything. The seam is already narrow (two methods), so moving `notifications` into its own service later means swapping those calls for a message (SQS/EventBridge) and nothing else; the outbox row stays the source of truth.

### Endpoints

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/auth/login` | public | 5 attempts/min per client IP (`429` + `Retry-After`) |
| POST | `/requests` | CUSTOMER | Validates order number via ERP mock, returns status `NEW` |
| GET | `/requests/mine` | CUSTOMER | Own requests only; pagination |
| GET | `/requests` | STAFF | Filters: `status`, `category`, `from`, `to` (dates, inclusive, UTC); pagination |
| GET | `/requests/:id` | owner or STAFF | Request + status history (who, when) |
| PATCH | `/requests/:id/status` | STAFF | Rejects invalid transitions (`409`); writes history |
| GET | `/requests/:id/events` | owner or STAFF | SSE stream: `status` events `{ requestId, status }`, `ping` every 25 s |
| POST | `/requests/:id/attachments/upload-url` | owner (CUSTOMER) | JPEG/PNG, ≤ 5 MB, ≤ 5 per request; returns a pre-signed POST (5 min) |
| POST | `/requests/:id/attachments/:attachmentId/complete` | owner (CUSTOMER) | Verifies the file in S3 (size, type, magic bytes); invalid files are deleted |
| GET | `/requests/:id/attachments` | owner or STAFF | Uploaded photos with pre-signed download URLs (5 min) |
| GET | `/health` | public | `200`/`503` with `database`, `redis`, `storage` each `up`/`down` |

### Key behaviours
- **Authorization per request**: the global guard checks the token and the route's role. Anything scoped to one request goes through `RequestsService.findAccessible()`, which loads it and applies one rule: staff see everything, a customer only their own. Others get `404` (not `403`), so ids can't be probed. A unit test pins the role of every route, so a new route fails until its access is decided.
- **Status workflow**: transitions are one map (`NEW→IN_REVIEW`, `IN_REVIEW→RESOLVED|REJECTED`; the last two are final). The change runs in one transaction that locks the request row (`SELECT … FOR UPDATE`), checks the transition, updates the status and inserts the history row (who, when). Two staff changing the same request at once can't both pass the check.
- **Uploads**: the browser uploads straight to S3 with a pre-signed POST whose policy enforces the exact `Content-Type` and `content-length-range`, so S3 itself refuses wrong or oversized files. Then `complete` checks the stored object (size, type, first bytes are really JPEG/PNG) and deletes anything invalid. A per-request lock keeps concurrent uploads within the 5-photo limit. The bucket blocks all public access and is encrypted; photos are viewed through 5-minute pre-signed GET URLs.
- **Notifications**: the status change and an outbox row (`notifications`, one per history row, `UNIQUE`) commit together; the job is queued after commit with `jobId = notificationId`, so the same email can't be queued twice. A sweeper re-queues outbox rows whose enqueue was lost. The mock provider fails at random (before or after "sending"); BullMQ retries with exponential backoff (5 attempts) and keeps permanently failed jobs (`removeOnFail: false`, row marked `FAILED`). The worker skips rows already `SENT`, and every attempt sends the same idempotency key, so the provider drops repeats after an ambiguous failure. Emails go to Mailpit and contain the order number and status only, never the description.
- **Health**: `GET /health` runs three checks in parallel, each with a 2 s timeout: `SELECT 1`, a read from the email queue (so it proves Redis and the queue together), and a `HeadBucket` on the photos bucket. It returns `503` if any is down. The public response only says `up`/`down`; the reason is logged. Health polls are left out of the request log.
- **Login rate limit**: `@nestjs/throttler` on `POST /auth/login` only, `LOGIN_RATE_LIMIT` attempts (default 5) per minute per client IP, then `429` in the standard error shape with `Retry-After`. Behind proxies, `TRUST_PROXY_HOPS` must match the real number of hops (Next.js server, ALB) so the limit counts per user rather than per proxy. Counts are in memory, so each API instance limits separately; with several instances use Redis-backed storage or AWS WAF rate rules.
- **Errors**: one global exception filter returns `{ statusCode, error, message, details?, correlationId }` for every error. `message` is always one string; validation failures put one line per invalid field in `details`. Body-parser errors keep their real status (413 too large, 415 bad charset) instead of becoming 500s. Unexpected errors return a generic 500 and are logged server-side with the correlation id.
- **Correlation id**: the caller's `x-correlation-id` is reused if it looks like an id (letters, digits, `_`, `-`; max 100), otherwise a UUID is generated. It's echoed on every response.
- **API docs**: Swagger UI at `/docs`, JSON at `/docs-json`. The Nest CLI Swagger plugin builds the schemas from the DTOs and their validation rules, so there are no per-field doc decorators to keep in sync. Every endpoint documents its response type and the shared error shape; protected endpoints are marked with Bearer auth.
- **Logs**: one JSON line per event via `nestjs-pino` (level `LOG_LEVEL`, default `info`).
  - Each request logs one line: `correlationId`, method, path (no query string), status, response time, and the caller's `userId`/`role` once authenticated.
  - Every log line written while handling a request carries the same `correlationId`. Email jobs carry it too, so the worker's "Status email sent" line traces back to the staff action that caused it.
  - Requests rejected before routing (oversized or malformed body) are still logged with their `correlationId`.
  - No personal data, by construction: the request/response serializers whitelist fields (no headers, so no tokens or cookies; no bodies, so no descriptions or passwords), and the code logs ids only. As a safety net, `email`, `name`, `description`, `password` and `to` fields are redacted if anyone logs them by mistake. Provider errors that might echo an address go to the notification row, not the logs.
  - Redis/BullMQ connection errors are logged as JSON too.

### Why PostgreSQL
Schema changes run inside transactions, so a failed migration rolls back cleanly instead of leaving half a schema (MySQL commits each DDL statement). `CREATE INDEX CONCURRENTLY` adds indexes without blocking writes, which the zero-downtime migration in Part C relies on. Partial indexes keep hot paths small: the notification sweeper indexes only `PENDING` rows. Enum types and `CHECK` constraints keep data valid even if a bug gets past the API. MySQL would also work; these features tipped the choice.

### Why Server-Sent Events for live updates
When staff change a status, the customer's open page must update without a reload. That update only flows one way, from server to customer, and happens a few times per request. Server-Sent Events are built for exactly that.

- It runs over plain HTTP, so our httpOnly cookie authentication and per-request authorization work unchanged.
- The browser reconnects automatically, and on reconnect the page re-fetches the current status, so no update is lost.
- An idle connection is cheap. Across multiple API instances, Redis pub/sub delivers each event to whichever instance holds the customer's connection.

Rejected:
- **WebSockets:** two-way communication we don't need, plus separate handshake authentication and reconnection logic. I'd add them only for a two-way feature like live chat.
- **Polling:** either wasteful, with constant requests for a status that rarely changes, or slow if the interval is long.

How it works: `GET /requests/:id/events` applies the same access check as `GET /requests/:id`. After the status-change transaction commits, the API publishes `{ requestId, status }` to Redis; every instance forwards it to its matching open streams. Events carry no personal data, and the page re-fetches the details. A `ping` event every 25 s keeps the connection open through the load balancer's idle timeout.

---

## Part B – Frontend

Next.js 16 (App Router, TypeScript) in `/web`. Plain CSS, no UI framework: the brief values structure and behaviour over polish.

### Pages and rendering

| Page | Choice | One-line reason |
|---|---|---|
| `/help` | SSG with ISR (revalidate daily) | Public content that changes a few times a year: build it once, serve it fast, refresh without a redeploy. |
| `/requests/new` | Static shell + client form | No per-user data on the page; the form, validation and upload progress need interactivity, so they're a Client Component. |
| `/requests/[id]` | SSR, no caching | Private, per-customer data, and the photo download URLs are short-lived, so it must be rendered fresh on each request; a small Client Component then handles live updates over SSE. |
| `/staff` | SSR, driven by URL search params | Filters and pagination live in the URL, so the server renders exactly the filtered page on each request, and a bookmarked link reproduces the view. |
| `/staff/requests/[id]` | SSR + client action | Fresh, private data; the status change with its confirmation step is a Client Component. |

Two supporting pages: `/login` (static; the form reads `?next=` in the browser) and `/requests` (SSR list of the customer's own requests, so they can find a request again).

The build output confirms it: `/help` is static with `Revalidate 1d`, `/login` and `/requests/new` are static, the rest are server-rendered on demand.

**Keeping `/requests/new` static while it needs a login.** The route guard runs in `src/proxy.ts`, before rendering, instead of in the page or layout. A page that reads cookies can't be static; the proxy reads the cookie, so the page doesn't have to. Layouts and the header carry no per-user data for the same reason.

### Server / Client boundary

Server Components by default. Everything that only displays data (request details, history, photos, the staff table, the filter form, pagination, the help page) is a Server Component and ships no JavaScript. The filter form is a plain `GET` form, so it works without JavaScript and naturally puts the filters in the URL.

Client Components (`'use client'`) only where the browser has to do something:

| Component | Why it runs in the browser |
|---|---|
| `features/requests/RequestForm` | Instant validation, direct-to-S3 upload with progress (`XMLHttpRequest`), focus management |
| `features/requests/LiveStatus` | Holds the `EventSource` connection |
| `features/staff/StatusChange` | Confirmation dialog, pending state |
| `features/auth/LoginForm` | Error message and pending state (`useActionState`) |
| `app/error.tsx` | Next.js requires error boundaries to be Client Components (its "Try again" button resets the page) |

Data crosses the boundary in one direction: Server Components fetch and pass plain props down. Client Components never call the API themselves; they call **Server Actions** (`features/*/actions.ts`), which run on the server, re-validate their input, and call the API with the user's token. The one exception is the photo upload, which goes from the browser straight to S3 with the pre-signed POST (no token involved).

Live updates: an SSE event doesn't carry data, it triggers `router.refresh()`, which re-renders the Server Components with fresh data. After a dropped connection the page refreshes too, so a missed event can't leave it out of date.

### Security
- **Tokens:** the JWT is stored in a cookie set by a Server Action: `httpOnly` (JavaScript can't read it), `Secure`, `SameSite=Lax`, expiring with the token. Nothing goes in `localStorage`. The browser never talks to the API with the token; only the Next.js server does. Browsers treat `http://localhost` as secure, so `Secure` works in local runs. The Playwright test asserts these flags and that `document.cookie` and storage are empty.
- **No secrets in the client bundle:** the API address (`API_URL`) is a server-only variable (no `NEXT_PUBLIC_` prefix), and the API client is marked `server-only`, so importing it from a Client Component fails the build. A scan of `.next/static` finds no API URL, token or credential.
- **CSRF:** every state change is a Server Action or a route on the API, never a `GET`.
  1. `SameSite=Lax`: the browser doesn't send the session cookie on cross-site `POST`s.
  2. Server Actions only accept `POST` and Next.js rejects them when the `Origin` header doesn't match the host, so a form on another site can't trigger one.
  3. The API itself takes the token only from the `Authorization` header, never from a cookie, so it can't be driven by a forged browser request at all.
  4. The one cookie-authenticated route handler (the SSE stream) is a read-only `GET`.
- **Customer-written text** (description, file names) is rendered as React text nodes, which escape HTML; there is no `dangerouslySetInnerHTML`. Line breaks are kept with CSS (`white-space: pre-wrap`).
- **Headers:** a Content-Security-Policy limits scripts, styles and connections to the site itself plus the photo bucket (`connect-src`/`img-src`), blocks framing (`frame-ancestors 'none'`) and forms posting elsewhere; plus `nosniff` and `Referrer-Policy: same-origin`. Scripts still need `'unsafe-inline'` because Next.js inlines its hydration data; nonces would remove that.
- **Route guard vs authorization:** the proxy only decodes the token to choose which pages to show; it doesn't verify it. The API verifies the token and checks access on every call, so a forged cookie gets nothing.
- **Open redirects:** `?next=` after login only accepts same-site paths.

### Accessibility
- Every input has a `<label>`; hints and errors are tied to the field with `aria-describedby`, invalid fields get `aria-invalid`.
- On a failed submit, an error summary (`role="alert"`) lists each problem as a link to its field and receives focus, so keyboard and screen-reader users land on it.
- Upload progress uses labelled `<progress>` elements plus a polite live region ("Uploading photo 1 of 2"); live status changes are announced the same way.
- Keyboard: skip link, visible focus ring (a 3px blue outline, 6.7:1 against white), native controls only. The staff confirmation is a native `<dialog>` opened with `showModal()`: it traps focus, closes on Escape and returns focus. Tables have a caption and header scopes; on narrow screens they scroll inside a focusable region.
- Colours were chosen for WCAG AA (body text 16:1, links and buttons 8:1, error text 6.5:1); status is always written out, never colour alone.
- Works on mobile and desktop: fluid layout, no fixed widths; the main customer flow is tested on both.

**axe result** (`@axe-core/playwright`, WCAG 2.0/2.1 A and AA rules, run by `npm run test:e2e`):

| Page / state | Rules passed | Violations |
|---|---|---|
| `/login` | 24 | 0 |
| `/help` | 23 | 0 |
| `/requests/new` | 25 | 0 |
| `/requests/new` with validation errors | 25 | 0 |
| `/requests` | 21 | 0 |
| `/requests/[id]` | 24 | 0 |
| `/staff` | 27 | 0 |
| `/staff/requests/[id]` | 25 | 0 |
| `/staff/requests/[id]` with the confirm dialog open | 11 | 0 |

A keyboard-only test also opens a request from the staff table, opens and cancels the dialog with Escape, and confirms a status change, using only Tab/Enter/Escape. Automated checks catch roughly a third of issues; a manual screen-reader pass (VoiceOver/NVDA) is still on the list.

### Structure for growth
```
web/src/
  app/                       routes only: thin pages that compose features
    (public)/login, help     public pages share one header
    requests/…               customer pages
    staff/…                  staff pages
    api/requests/[id]/events SSE pass-through (cookie → Bearer)
  features/                  one folder per team/area, each with its own components and Server Actions
    auth/                    login form and action
    requests/                customer team: form, validation schema, upload, live status
    staff/                   staff team: filters, table, status change
    help/                    help content
  shared/                    used by more than one feature; changes reviewed by both teams
    api/                     typed API client (server-only), endpoints, response types
    auth/                    session cookie, token claims, logout
    ui/                      header, status badge, request details, pagination
    labels.ts                display names, allowed transitions, date format
  proxy.ts                   route guard
```
Rules: `app/` only composes; features never import from each other or get imported by `shared/`, only the other way round (checked: no `@/features` import outside `app/`). A customer-team change stays inside `features/requests` and `app/requests`; a staff-team change inside `features/staff` and `app/staff`. With a CODEOWNERS file, each team owns its folders and `shared/` needs both. The API's response types live in `shared/api/types.ts`; generating them from the API's OpenAPI document (`/docs-json`) would keep them in sync automatically and is the next step.

### Tests
- **Component tests** (Vitest + Testing Library, `npm test`): the request form's validation. They cover the missing fields, whitespace-only input, a description over 2000 characters, wrong file type, a file over 5 MB and more than 5 photos. They also check that each error is announced (`role="alert"`), linked to its field and read with the field's description, that focus moves to the summary, that valid input is trimmed and sent, and that the API's "order not found" shows on the order-number field.
- **End-to-end** (Playwright, `npm run test:e2e`, needs the full stack running): the main customer flow on desktop and a mobile viewport. The customer logs in from a protected page, fills in the form, uploads a real PNG straight to S3, and lands on the request. Then staff change the status and the open page updates without a reload. Plus: Bob can't open Alice's request, cookie flags, the axe scans above, and the keyboard-only staff flow.

## Parts C, D, E
- [DATABASE.md](DATABASE.md) — slow query investigation, indexes, keyset pagination, zero-downtime category migration.
- [DESIGN.md](DESIGN.md) — C4 container, two sequence diagrams, AWS deployment, ADR on messaging, security, observability, growth.
- [LEADERSHIP.md](LEADERSHIP.md) — code review, incident, disagreement, estimation, tech debt, trade-off explanation, AI guideline.

---

## Assumptions
- Order lookup is mocked: any order number starting with `SO-` is valid; anything else returns `422`.
- Categories are a fixed enum for v1: `DAMAGED_DELIVERY`, `WRONG_ITEM`, `QUALITY_ISSUE`, `OTHER`.
- Photos can be added after the request is created (upload URLs need a request ID); status `NEW` is set on create.
- Staff can see and change any request; there is no per-dealer scoping in v1.
- Only access tokens (no refresh tokens); token lifetime 1 hour, user logs in again after expiry.
- Customers do not add comments; history is status-only.
- "Never send the same email twice" means at most one email per status change.
- Date filters (`from`, `to`) are whole days in UTC, both inclusive.
- The API lets the owner add photos in any status (up to 5); the web app offers it only while creating the request. Staff can view photos but not upload them.
- Status history shows customers "You" or "Service team", not staff names.
- All dates and times are in UTC, and the portal is in English only.
- Locally, the email provider is a mock that fails on purpose and delivers to Mailpit. Production would use Amazon SES (see [DESIGN.md](DESIGN.md)).

## Left out / next steps

What I'd do next with more time, roughly in order:

1. **Keyset pagination and the dashboard index** from [DATABASE.md](DATABASE.md). The staff list uses page numbers and an exact count, which is fine at launch but slows down as the table grows.
2. **Run migrations as a separate deploy step.** They run when the API starts, so two instances starting at once could race.
3. **Run the email worker as its own container** (same image). It runs inside the API process today, which is simple locally but means email retries share resources with API requests.
4. **Login rate limit in Redis.** It's counted in memory, so each API instance has its own limit. With several instances it needs Redis-backed storage or a WAF rule.
5. **The SES send-events check** described in DESIGN.md. Locally, the mock provider uses an idempotency key instead.
6. **Sessions:** refresh tokens or server-side sessions, so a session can be ended before its token expires, and MFA for staff.
7. **Frontend:** adding photos from the request page (the API already supports it), live updates on the staff page too, API types generated from `/docs-json` instead of written by hand, CSP nonces to drop `'unsafe-inline'`, and a manual screen-reader pass.
8. **Delivery and safety:** a CI pipeline running all tests on every push, and virus scanning of uploaded photos.

Left out on purpose for v1: staff assignment, comments, image thumbnails and translations, because the brief doesn't need them and they'd add scope without testing anything new.

## Assessment checklist

**Part A – Backend**
- [x] Auth: seeded users, JWT login, CUSTOMER/STAFF roles, per-request authorization
- [x] `POST /requests` with ERP mock validation
- [x] Pre-signed upload URL (JPEG/PNG, 5 MB, 5 photos), private bucket, pre-signed download
- [x] Status workflow + history table (who, when)
- [x] `GET /requests` (filters + pagination), `GET /requests/mine`
- [x] BullMQ email queue: flaky mock provider, backoff, keep failed jobs, no duplicates
- [x] Live updates (SSE)
- [x] Migrations, validation, consistent errors, Swagger
- [x] JSON logs + correlation ID, no PII
- [x] Health endpoint (DB, Redis, storage)
- [x] Login rate limiting
- [x] Unit tests (workflow, authorization) + integration test (create request)

**Part B – Frontend**
- [x] `/help`, `/requests/new`, `/requests/[id]`, `/staff`, `/staff/requests/[id]`
- [x] Direct-to-S3 upload with progress and errors
- [x] Filters and pagination in the URL
- [x] httpOnly cookies, CSRF, safe rendering
- [x] Accessibility + axe/Lighthouse result
- [x] Component tests for form validation; Playwright e2e (bonus)

**Docs**
- [x] DATABASE.md (C1, C2 with SQL)
- [x] DESIGN.md (4 diagrams, 7 questions)
- [x] LEADERSHIP.md (E1–E7, ≤ 200 words each except E1)
- [x] Meaningful commit history; `docker compose up` starts everything
