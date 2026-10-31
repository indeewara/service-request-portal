# Part E: Tech lead scenarios

## E1. Code review

**Overall comment on the PR**

Thanks for picking this up. The flow is right: load the request, update the status, tell the customer. But a few things need to change before it can merge, mostly around security and the workflow rules in the brief. I've marked each comment as blocking or non-blocking. Happy to pair on the queue and transaction parts if that helps.

### 🔴 Blocking

**1. SQL injection** (both `db.query` calls)
`id` and `status` are pasted straight into the SQL, so an input like `x' OR '1'='1` would update every row in the table. Please use parameters, or better, the TypeORM repository, which parameterises for you:
```ts
const request = await this.requests.findOneBy({ id });
await this.requests.update({ id }, { status });
```

**2. A live API key in the code** (`emailApiKey`)
Please move it to config or a secrets manager. It's already in Git history, so it needs rotating now, whether or not this PR merges. I can help with that.

**3. Any status is accepted**
Right now any string can be saved as a status. Only NEW → IN_REVIEW → RESOLVED or REJECTED should be allowed, and anything else should be rejected with a clear error.

**4. No history record**
The brief requires us to record who changed the status and when. Please save the history row in the same transaction as the update, so both succeed or both fail. Locking the row while checking the transition also stops two staff members changing the same request at once:
```ts
await this.dataSource.transaction(async (m) => {
  const request = await m.findOne(ServiceRequest, {
    where: { id },
    lock: { mode: 'pessimistic_write' },
  });
  // check the transition here, then:
  await m.update(ServiceRequest, { id }, { status });
  await m.insert(StatusHistory, {
    requestId: id,
    fromStatus: request.status,
    toStatus: status,
    changedBy: user.id,
  });
});
```

**5. Personal data in the logs** (`console.log`)
This prints the whole request and user, including the customer's email and description. Please remove it and use our structured logger, which logs ids only.

**6. A missing request isn't handled**
`request[0]` crashes if the id doesn't exist. Please return a 404 instead.

**7. The email is fire-and-forget**
`.catch(() => {})` hides every failure, there's no retry, and nothing stops the same email going out twice. Please send it through the notifications queue, recorded in the same transaction as the status change, so a failure is retried and never lost.

**8. It always returns `{ ok: true }`**
Even when something fails. Please return the updated request, and let errors surface as the right HTTP status.

### ❓ Question (blocking if not already covered)

**9. Who is allowed to call this?**
I can't see where staff-only access is checked in this diff. Is there a staff guard on the controller? If not, we need one before merging. Also, `user` is passed in but never used: was the plan to check it here?

### 🟡 Non-blocking

**10. Hardcoded provider URL:** worth moving to config with the key.

**11. `user: any`:** a typed user object would catch mistakes at compile time.

**12. `status: string`:** using the status enum means the compiler rejects invalid values too.

**13. `SELECT *`:** better to select only the columns we use. It's about clarity more than speed for a single-row lookup.

**14. The description in the email body:** consider leaving it out, so less personal data goes to the email provider.

**15. Raw `DataSource.query`:** for this service generally, I'd suggest the TypeORM repository and entities. Queries become typed and parameterised by default, and match the rest of the codebase.

**16. Tests:** could you add tests for the allowed transitions and for a customer trying to call this? They'd have caught several of the points above.

## E2. A production incident

The first thing I’d do is stop it happening further. I’d pause the email worker so no more duplicates go out, but keep the portal running so staff can carry on. I’d tell the staff channel that we’re aware of it and what to tell customers who call.

Then one engineer digs in while I coordinate. The main clue is that people got ‘Resolved’ emails while their pages still say ‘In review’. That suggests either emails went out for status changes that never saved, or the same job ran several times without checking if it was already sent. The queue jobs, notification records and provider logs should tell us which.

I’d email management within half an hour with what happened, how many customers were affected, and when they’ll hear from me next.

Once we know the cause, we reproduce it in a test, fix it, check it on staging and release it, then correct the requests stuck on the wrong status.

Afterwards, I’d run a no-blame review and make sure emails are only queued after the status is saved, each email has a unique key, and we’re alerted if a customer gets the same email twice.

## E3. A technical disagreement

I’d start by having a meeting with him to understand why he wants microservices and Kafka as he may be seeing a risk I’m not. Then, with the team, we’d agree on what matters: our real load (300 requests a day, maybe 3,000 within a year), team size, running cost, and how fast we need to deliver.

Against those criteria, I’d research both options properly, the cost and benefit of each, and ask him to write up the case for microservices so we can compare them side by side. Then we’d go through both as a team.

If we still disagree, I make the call as lead. I’d explain that we’re starting as a modular monolith with clear module boundaries, so a module can be split out later, and I’d name the signals that would trigger it, like one module needing to scale on its own.

I’d record it as an architecture decision record covering the context, the options, the decision and its consequences, and let my manager know, since it affects cost and timelines.

## E4. Estimating with unknowns

First I’d ask management what they want in the first version, because ‘a mobile app’ can mean a lot of things. Then I’d look at which platforms we need, Android, iPhone or both, how complex it is, and the team: who has time, and whether we train our own people or bring in someone who’s built apps before, and what each would cost.

I’d pick a frontend developer, ideally one who knows React, since React Native uses the same ideas, and give them about a week to study and build a small, real part of the app on our existing API, including photo upload and login, the tricky parts on a phone.

Then I’d tell management in plain terms: ‘Building a phone app is a different skill from building a website, and nobody on our team has done it before, so any date I give you today would be a guess. Give us a week to try it, and I’ll come back with a realistic window for each option, training our team or hiring help, plus a cheaper mobile-friendly website. I’ll explain what could move the date and keep you updated.’ I’d also mention app store approval adds time.

## E5. Tech debt versus features

I wouldn’t stop feature work to fix this. I’d add the fixes to every sprint alongside the features, because if we keep this work separate, it never gets prioritised.

To get product to agree, I’d explain it in their terms, not as ‘tech debt’. I’d show the numbers: how slow the dashboard is and how it affects staff, and how bugs after release have increased as test coverage dropped, which slows down every new feature. Then I’d agree with them on a share of each sprint, around 20%, for speed and tests, starting with the dashboard because users feel it most.

I’d also add a load test for the dashboard with a clear target, for example loading in under two seconds. If a new feature that touches the dashboard makes it slower than that, we either fix it before release, or product decides to release it anyway and we fix it in the next sprint. New features also come with their own tests.

I’d keep product updated and review the numbers with them every few sprints, so they can see the time is worth it.

## E6. Explaining a trade-off

When staff change the status of a request, the customer sees the change on their screen within a second or so, without refreshing the page. They also get an email, so nobody misses an update.

To do this, I chose a one-way live connection, where our system pushes updates to the customer’s screen as soon as they happen. Running costs are low and it’s easy to maintain. If the connection drops, the page catches up when it reconnects.

I rejected two other options. The first was having the page check for updates every few seconds. It’s slightly quicker to build, but the page only sees a change the next time it checks, so updates can arrive several seconds late. Checking more often reduces the delay, but puts more load on our system and raises running costs. The second was a two-way connection, more like a phone line, which could also support live chat between customers and staff. That would mean more development time and higher maintenance costs, for a feature we don’t need right now.

The only thing we give up is live chat. If the business wants it later, we can add it then.

## E7. AI coding assistants

AI assistants are welcome, but they don’t change who is responsible.

- You own every line you commit. If you can’t explain it, don’t submit it. New to a framework? Learn its basics from the official docs first.
- Never paste passwords, keys, personal or confidential data into a prompt. Use only approved tools, with training on our code turned off, in line with our data protection policy.
- Use cheaper models for routine work, and the most capable ones for complex problems.
- Take extra care with access checks, the status workflow, emails and uploads.
- Change the database only through migrations. Never log personal data. Keep changes inside module boundaries.
- AI can invent functions, settings or packages. Check the official docs, and only add real, maintained, approved packages.
- New code needs tests, and existing tests must still pass.
- Fix bugs at the cause, change only what’s broken, and add a test, even if the AI suggests a rewrite.
- Plan before you prompt and decide the approach yourself. The team makes design decisions.
- Keep the README, API docs, decision records and our shared AI instructions file up to date; review that file like code, with no secrets.
