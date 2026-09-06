# Routine Tracker

Plan every routine by the hour, tick it off as the day goes, and let streaks,
statistics and heatmaps show what your weeks actually look like.

Full-stack, no build step: an Express + SQLite API and a hand-written
ES-module SPA served from the same process.

```
npm install
npm start          # http://localhost:3000
```

That's the whole setup. The database file, schema and JWT secret are created on
first run.

---

## Screens

| | |
|---|---|
| **Today** | The day as a timeline, grouped by morning / afternoon / evening / night, with a "now" marker, a progress ring, the week strip and one-tap completion. |
| **Routines** | Every routine you own — search, filter by category, archive, duplicate, or start from a template pack. |
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
| `T` `R` `C` `S` `J` `A` | Today, Routines, Calendar, Statistics, Journal, Achievements |
| `Esc` | Close a dialog |

## Project layout

```
server/
  index.js          Express app: security headers, routing, static client
  config.js         Environment + generated development secrets
  db/
    schema.sql      Tables, indexes and cascade rules
    index.js        Connection, pragmas, migrations-on-boot
    seed.js         Demo account with ~3 months of history
  lib/
    dates.js        ISO-date arithmetic, timezone-aware "today"
    schedule.js     Recurrence: is this routine due on this day?
    stats.js        Daily series, streaks, breakdowns, XP
    achievements.js Badge catalogue, each measuring itself
    auth.js         Hashing, token issue and revocation
    validate.js     Declarative per-field request validation
    starter.js      Template packs and the sign-up starter set
  routes/           auth, routines, days, stats, journal, misc
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

tests/api.test.js   47 end-to-end API tests
```

## Configuration

Copy `.env.example` to `.env` to change anything. Every value has a working
default for local development.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `DATABASE_PATH` | `./data/routine-tracker.sqlite` | |
| `JWT_SECRET` | generated | **Required** when `NODE_ENV=production` |
| `JWT_EXPIRES_IN` | `30d` | |
| `NODE_ENV` | `development` | `production` enables secure cookies and HSTS |
| `CORS_ORIGINS` | *(empty)* | Comma-separated, for running the SPA elsewhere |

## Commands

```
npm start      # run the server
npm run dev    # run with --watch
npm test       # 47 end-to-end API tests against a throwaway database
npm run test:ui  # 30 browser tests: drives the real UI in Chromium
npm run seed   # demo account: demo@routine.app / demopass123
```

`npm test` needs nothing extra. The browser test skips itself unless
Playwright is present:

```
npm install --no-save playwright && npx playwright install chromium
npm run test:ui
```

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

## Notes on the design

**Dates are strings.** Everything is `YYYY-MM-DD`. They sort correctly, survive
JSON, and can't drift across a daylight-saving boundary. Conversion to a real
`Date` happens only inside `lib/dates.js`, always at UTC noon.

**Recurrence is computed, not stored.** There is no table of future occurrences
to keep in sync — `isDueOn(routine, date)` answers the question directly, so
editing a schedule instantly changes what the calendar and statistics show.

**Validation is declarative.** Each endpoint states the shape it wants; the
validator collects every field error before responding, so a form highlights
all its problems in one round-trip.

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
