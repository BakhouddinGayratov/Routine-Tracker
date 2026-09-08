# Routine Tracker

Plan every routine by the hour, tick it off as the day goes, and let streaks,
statistics and heatmaps show what your weeks actually look like.

Full-stack, no build step: an Express + SQLite API and a hand-written
ES-module SPA served from the same process.

Requires **Node.js 22.13 or newer** ([nodejs.org](https://nodejs.org)) — nothing else.

```
npm install
npm start          # http://localhost:3000
```

That's the whole setup. There are no native modules to compile: SQLite comes
from Node itself (`node:sqlite`), so `npm install` is pure JavaScript on every
platform. The database file, schema and JWT secret are created on first run.

---

## Screens

| | |
|---|---|
| **Today** | The day as a timeline, grouped by morning / afternoon / evening / night, with a "now" marker, a progress ring, the week strip and one-tap completion. |
| **Routines** | Every routine you own — search, filter by category, archive, duplicate, or start from a template pack. |
| **Goals** | What the routines are for. Each goal shows the routines pointing at it and how that work has gone over the last 30 days. |
| **Calendar** | A month at a glance: completion per day plus the mood you logged. |
| **Statistics** | Completion trend, weekday and category breakdowns, a year-long activity heatmap, and which habits are strongest or slipping. |
| **Journal** | A line a day, with mood and energy, autosaved. |
| **Achievements** | XP, levels and 18 badges that measure themselves against your real history. |
| **Settings** | Profile, theme, language, week start, daily goal, reminders, sessions, export, account deletion. |

## What it does

**Accounts.** Sign up with an email and password. Passwords are hashed with
bcrypt; sessions are rows in the database referenced by the JWT, so signing out
or changing a password revokes tokens immediately instead of waiting for them to
expire. Every row is scoped to a user and cascades on account deletion.

**Routines.** A routine is *what* to do, *when*, and *how often*:

- a clock time and duration, or "anytime today"
- five recurrence rules — every day, chosen weekdays, every N days, days of the
  month, or a one-off
- an optional start and end date
- a simple check, or a measurable target ("20 pages", "8 glasses")
- priority, category, colour, icon, and an optional reminder

**Goals.** A routine can point at a goal — the thing the daily work adds up to.
Goals are entirely optional: "no goal" is the default when you add a routine,
and nothing else changes if you never create one. A goal owns no schedule of
its own; its numbers are derived from the routines attached to it, so "how is
this goal going" and "did I do the work" can never disagree. Deleting a goal
keeps its routines and only clears the link.

**Logging.** One tap marks a routine done, skipped, or partially done. Logs are
an idempotent upsert on `(routine, date)`, so double-tapping never creates two
rows, and a quantity routine that reaches its target completes itself. A whole
day can be completed at once, or copied from yesterday.

**Insight.** Streaks count consecutive days that met your daily goal, and days
with nothing scheduled are transparent — a planned rest day neither extends nor
breaks a streak. Statistics compare each window with the one before it.

**Extras.** Command palette (`Ctrl`/`⌘` + `K`), single-key navigation, browser
reminders before a timed routine, English / Uzbek / Russian, dark and light
themes, and a full JSON or CSV export of everything you've recorded.

## Keyboard

| Key | Action |
|---|---|
| `Ctrl`/`⌘` + `K` | Command palette |
| `N` | New routine |
| `T` `R` `G` `C` `S` `J` `A` | Today, Routines, Goals, Calendar, Statistics, Journal, Achievements |
| `Esc` | Close a dialog |

## Project layout

```
server/
  index.js          Express app: security headers, routing, static client
  config.js         Environment + generated development secrets
  db/
    schema.sql      Tables, indexes and cascade rules
    index.js        Connection, pragmas, schema and migrations on boot
    migrate.js      Versioned upgrades for a database that already has data
    seed.js         Demo account with ~3 months of history
  lib/
    dates.js        ISO-date arithmetic, timezone-aware "today"
    schedule.js     Recurrence: is this routine due on this day?
    stats.js        Daily series, streaks, breakdowns, XP
    achievements.js Badge catalogue, each measuring itself
    auth.js         Hashing, token issue and revocation
    validate.js     Declarative per-field request validation
    starter.js      Template packs and the sign-up starter set
  routes/           auth, routines, goals, days, stats, journal, misc
  middleware/       auth, rate limiting, error handling

public/
  index.html
  styles/           tokens → base → layout → components → views
  app/
    main.js         Router, app shell, keyboard shortcuts
    api.js          Typed API client with field-level errors
    store.js        State, session bootstrap, preferences
    dom.js          el() — the only way anything reaches the DOM
    charts.js       SVG charts, drawn by hand
    i18n.js         English, Uzbek, Russian
    views/          One module per screen

tests/api.test.js   56 end-to-end API tests
```

## Configuration

Copy `.env.example` to `.env` to change anything. Every value has a working
default for local development.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `DATABASE_PATH` | `./data/routine-tracker.sqlite` | |
| `DATABASE_DRIVER` | `auto` | `node` (built-in) or `better-sqlite3` to pin one |
| `JWT_SECRET` | generated | **Required** when `NODE_ENV=production` |
| `JWT_EXPIRES_IN` | `30d` | |
| `NODE_ENV` | `development` | `production` enables secure cookies and HSTS |
| `CORS_ORIGINS` | *(empty)* | Comma-separated, for running the SPA elsewhere |

## Commands

```
npm start      # run the server
npm run dev    # run with --watch
npm test       # 56 end-to-end API tests against a throwaway database
npm run test:ui  # 30 browser tests: drives the real UI in Chromium
npm run seed   # demo account: demo@routine.app / demopass123
```

`npm test` needs nothing extra. The browser test skips itself unless
Playwright is present:

```
npm install --no-save playwright && npx playwright install chromium
npm run test:ui
```

## Troubleshooting

**`Error: Cannot find module 'node:sqlite'`** or **`node:sqlite is experimental
and requires the --experimental-sqlite flag`**

Your Node is older than 22.13. Upgrade from [nodejs.org](https://nodejs.org)
(`node -v` to check), or install the fallback driver instead:
`npm install better-sqlite3`.

**`Error: Could not locate the bindings file`** (mentioning `better_sqlite3.node`)

You have an old `node_modules` from a version of this project that used the
native driver. It no longer does — clear and reinstall:

```bash
rm -rf node_modules package-lock.json   # PowerShell: rm -r -fo node_modules, package-lock.json
npm install
```

**`npm warn install-scripts ... had install scripts blocked`**

Harmless now: no dependency here has an install script. If you see this, an old
`package-lock.json` is still pinning the native driver — clear and reinstall as
above.

**Port 3000 is already in use** — start on another one: `PORT=3001 npm start`
(PowerShell: `$env:PORT=3001; npm start`).

## API

All routes are under `/api`. Everything except `/health` and the two auth
entry points needs a bearer token (or the `token` cookie the browser client
uses).

<details>
<summary><b>Auth</b></summary>

| | |
|---|---|
| `POST /auth/register` | Create an account; returns a token and starter routines |
| `POST /auth/login` | Sign in |
| `POST /auth/logout` | Revoke the current session |
| `GET  /auth/me` | Current user |
| `PATCH /auth/me` | Update name, theme, locale, timezone, week start, daily goal |
| `POST /auth/password` | Change password; revokes other sessions |
| `GET  /auth/sessions` | List signed-in devices |
| `DELETE /auth/sessions/:id` | Sign a device out |
| `DELETE /auth/me` | Delete the account and all its data |
</details>

<details>
<summary><b>Routines</b></summary>

| | |
|---|---|
| `GET /routines` | List (`?archived=all` to include archived) |
| `GET /routines/:id` | One routine with 90 days of history and stats |
| `POST /routines` | Create |
| `PATCH /routines/:id` | Update (partial) |
| `DELETE /routines/:id` | Delete, with its logs |
| `POST /routines/:id/duplicate` | Copy |
| `POST /routines/reorder` | Reorder in one request |
</details>

<details>
<summary><b>Goals</b></summary>

| | |
|---|---|
| `GET /goals` | List with per-goal progress over the last 30 days (`?status=all` to include archived) |
| `POST /goals` | Create |
| `PATCH /goals/:id` | Update (partial) — this is also how a goal is marked reached |
| `DELETE /goals/:id` | Delete; the routines survive with their link cleared |
</details>

<details>
<summary><b>Days and logs</b></summary>

| | |
|---|---|
| `GET /days/:date` | Routines due that day, their logs, journal and summary (`today` works as the date) |
| `GET /days/:date/week` | The seven days around it |
| `GET /days/month/:year/:month` | Month grid |
| `POST /days/log` | Mark done / skipped / partial; `pending` clears the log |
| `POST /days/:date/complete-all` | Complete everything due |
| `POST /days/:date/copy-from` | Copy another day's completions |
| `GET /days/upcoming/list?days=7` | What's coming |
</details>

<details>
<summary><b>Statistics, journal and data</b></summary>

| | |
|---|---|
| `GET /stats/summary` | Level, streak, today's progress (drives the app shell) |
| `GET /stats/overview?days=30` | Totals, series, streaks, breakdowns, leaderboards |
| `GET /stats/heatmap?days=364` | Per-day activity |
| `GET /stats/routines?days=30` | Per-routine completion and streaks |
| `GET /stats/achievements` | XP, level, badges; persists new unlocks |
| `GET /journal`, `GET/PUT /journal/:date` | Daily entries |
| `GET /templates`, `POST /templates/:id/apply` | Routine packs |
| `GET /search?q=` | Routines and journal entries |
| `GET /export`, `GET /export.csv` | Everything you've recorded |
</details>

## Working on this project

[`CLAUDE.md`](CLAUDE.md) is the engineering handoff: the decisions behind the
code and why they were made, the bugs already found and fixed, the conventions
to keep, and what is deliberately left undone. Read it before changing anything
non-trivial — Claude Code loads it automatically.

## Notes on the design

**Dates are strings.** Everything is `YYYY-MM-DD`. They sort correctly, survive
JSON, and can't drift across a daylight-saving boundary. Conversion to a real
`Date` happens only inside `lib/dates.js`, always at UTC noon.

**Recurrence is computed, not stored.** There is no table of future occurrences
to keep in sync — `isDueOn(routine, date)` answers the question directly, so
editing a schedule instantly changes what the calendar and statistics show.

**Your data outlives the code.** The database file is never recreated. On every
start the schema is replayed — every statement guarded with `IF NOT EXISTS`, so
it only adds what is missing — and then `db/migrate.js` applies any versioned
upgrades an existing database has not seen yet, tracked by SQLite's own
`user_version`. Updating the app keeps your accounts, routines, logs and
journal entries exactly where they were.

**Validation is declarative.** Each endpoint states the shape it wants; the
validator collects every field error before responding, so a form highlights
all its problems in one round-trip.

**SQLite comes from the runtime.** Node 22.13+ ships `node:sqlite`, so the app
has no native dependency to compile and no prebuilt binary to hope for — a
whole class of "works on my machine" failures simply cannot happen.
`better-sqlite3` still works as a fallback if you install it and set
`DATABASE_DRIVER=better-sqlite3`; both paths are covered by the test suite.

**No innerHTML for user data.** The client builds every node through `el()`,
which sets text and attributes rather than parsing markup. A routine titled
`<img onerror=…>` is just a title. The server sends a strict CSP to match.

## Security

- bcrypt (cost 12) password hashing
- Database-backed sessions, revocable individually or all at once
- Rate limits on sign-up, sign-in and the API as a whole
- Ownership checks on every routine, log and journal row
- Sign-in gives the same answer and timing for an unknown email and a wrong
  password, so it can't be used to discover who has an account
- HttpOnly, SameSite cookies; `Secure` and HSTS in production
- Strict CSP, `nosniff`, `X-Frame-Options: DENY`

## Deployment

```
NODE_ENV=production JWT_SECRET="$(openssl rand -hex 48)" \
DATABASE_PATH=/var/lib/routine-tracker/data.sqlite \
npm start
```

Run it behind a TLS-terminating proxy. The data directory holds the SQLite
database and its WAL files — that directory is the entire backup.
