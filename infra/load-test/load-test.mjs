// Load test for the API: many users at once, a realistic mix of actions.
// Node 22, no dependencies. Usually started by run.sh, which seeds data first.
//   USERS=20 DURATION=60 node infra/load-test/load-test.mjs
const API = process.env.API_URL ?? 'http://localhost:4000';
const USERS = Number(process.env.USERS ?? 20);
const SECONDS = Number(process.env.DURATION ?? 60);
const P95_LIMIT_MS = Number(process.env.P95_LIMIT_MS ?? 500);
const PASSWORD = 'Password123!';
const CATEGORIES = ['DAMAGED_DELIVERY', 'WRONG_ITEM', 'QUALITY_ISSUE', 'OTHER'];
const STATUSES = ['NEW', 'IN_REVIEW', 'RESOLVED', 'REJECTED'];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const upTo = (n) => 1 + Math.floor(Math.random() * n);

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
  });
  const data = (res.headers.get('content-type') ?? '').includes('json')
    ? await res.json()
    : await res.text();
  return { status: res.status, data };
}

async function login(email) {
  const { status, data } = await call('POST', '/auth/login', null, { email, password: PASSWORD });
  if (status !== 200) throw new Error(`Login as ${email} failed: ${status} ${JSON.stringify(data)}`);
  return data.accessToken;
}

// One login per account, reused by every virtual user (so the login limit doesn't apply).
const token = {
  alice: await login('alice@example.com'),
  bob: await login('bob@example.com'),
  staff: await login('staff@example.com'),
};

// Requests each customer may open, and seeded NEW requests staff can move to IN_REVIEW.
const own = {};
for (const who of ['alice', 'bob']) {
  own[who] = (await call('GET', '/requests/mine?pageSize=100', token[who])).data.items.map((r) => r.id);
}
const toReview = [];
for (let page = 1; page <= 50 && toReview.length < 2000; page++) {
  const { data } = await call('GET', `/requests?status=NEW&pageSize=100&page=${page}`, token.staff);
  toReview.push(...data.items.filter((r) => r.orderNumber.startsWith('SO-LOAD-')).map((r) => r.id));
  if (data.items.length < 100) break;
}
if (own.alice.length === 0 || toReview.length === 0) {
  throw new Error('Not enough data: seed it first (run.sh does this).');
}

let created = 0;
let statusChanges = 0;
const thenAlso = async (first, next) => {
  const res = await first;
  return res.status >= 400 ? res : next();
};

// [name, share of all actions, what it does]
const actions = [
  ['staff dashboard (filters, paging)', 40, () => {
    const q = new URLSearchParams({ page: String(upTo(50)), pageSize: '20' });
    if (Math.random() < 0.5) q.set('status', pick(STATUSES));
    if (Math.random() < 0.5) q.set('category', pick(CATEGORIES));
    return call('GET', `/requests?${q}`, token.staff);
  }],
  ['staff opens a request + photos', 25, () => {
    const id = pick(own[pick(['alice', 'bob'])]);
    return thenAlso(call('GET', `/requests/${id}`, token.staff), () =>
      call('GET', `/requests/${id}/attachments`, token.staff));
  }],
  ['customer views own requests', 20, () => {
    const who = pick(['alice', 'bob']);
    return thenAlso(call('GET', `/requests/mine?page=${upTo(5)}`, token[who]), () =>
      call('GET', `/requests/${pick(own[who])}`, token[who]));
  }],
  ['customer creates a request', 10, () =>
    call('POST', '/requests', token[pick(['alice', 'bob'])], {
      category: pick(CATEGORIES),
      orderNumber: `SO-LT-${Date.now()}-${++created}`,
      description: 'Created by the load test.',
    })],
  ['staff changes a status (sends email)', 5, async () => {
    const id = toReview.pop();
    if (!id) return { skipped: true };
    statusChanges++;
    return call('PATCH', `/requests/${id}/status`, token.staff, { status: 'IN_REVIEW' });
  }],
];

const totalShare = actions.reduce((sum, [, share]) => sum + share, 0);
const chooseAction = () => {
  let r = Math.random() * totalShare;
  return actions.find(([, share]) => (r -= share) < 0) ?? actions[0];
};

const stats = new Map(actions.map(([name]) => [name, { times: [], errors: {} }]));
const end = Date.now() + SECONDS * 1000;

async function virtualUser() {
  while (Date.now() < end) {
    const [name, , run] = chooseAction();
    const s = stats.get(name);
    const started = performance.now();
    let outcome;
    try {
      const res = await run();
      if (res.skipped) continue;
      outcome = res.status >= 400 ? String(res.status) : undefined;
    } catch (err) {
      outcome = `network: ${err.cause?.code ?? err.message}`;
    }
    s.times.push(performance.now() - started);
    if (outcome) s.errors[outcome] = (s.errors[outcome] ?? 0) + 1;
  }
}

console.log(`Load test: ${USERS} users for ${SECONDS} s against ${API}\n`);
const startedAt = performance.now();
await Promise.all(Array.from({ length: USERS }, virtualUser));
const elapsed = (performance.now() - startedAt) / 1000;

const percentile = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0;
const ms = (n) => `${Math.round(n)} ms`.padStart(8);
const row = (name, times, errors) => {
  const sorted = [...times].sort((a, b) => a - b);
  const errorCount = Object.values(errors).reduce((a, b) => a + b, 0);
  return [
    name.padEnd(38),
    String(times.length).padStart(7),
    (times.length / elapsed).toFixed(1).padStart(7),
    ms(percentile(sorted, 50)),
    ms(percentile(sorted, 95)),
    ms(percentile(sorted, 99)),
    String(errorCount).padStart(7),
  ].join(' ');
};

console.log(
  ['Action'.padEnd(38), 'calls'.padStart(7), 'per s'.padStart(7), 'p50'.padStart(8),
    'p95'.padStart(8), 'p99'.padStart(8), 'errors'.padStart(7)].join(' '),
);
const allTimes = [];
const allErrors = {};
for (const [name, s] of stats) {
  console.log(row(name, s.times, s.errors));
  allTimes.push(...s.times);
  for (const [k, v] of Object.entries(s.errors)) allErrors[k] = (allErrors[k] ?? 0) + v;
}
console.log(row('ALL', allTimes, allErrors));

const p95 = percentile([...allTimes].sort((a, b) => a - b), 95);
const errorCount = Object.values(allErrors).reduce((a, b) => a + b, 0);
console.log(`\nStatus changes made: ${statusChanges} (each owes the customer one email)`);
if (errorCount) console.log('Errors by type:', allErrors);
const passed = errorCount === 0 && p95 <= P95_LIMIT_MS;
console.log(
  `${passed ? 'PASS' : 'FAIL'}: ${errorCount} errors, p95 ${Math.round(p95)} ms (limit ${P95_LIMIT_MS} ms)`,
);
process.exitCode = passed ? 0 : 1;
