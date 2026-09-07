# Context handoff — Routine Tracker

This file exists so a **fresh Claude Code session can pick this project up cold**.
It records what the app is, how it is built, what was decided and why, what was
already tried and broke, and the conventions to keep following.

`README.md` is the user-facing documentation. This file is the engineering
context behind it — read this one first.

---

## 1. Orientation

| | |
|---|---|
| **Repository** | `BakhouddinGayratov/Routine-Tracker` |
| **Working branch** | `claude/manga-site-full-build-vjfk2v` — the **only** branch on the remote; there is no `main` |
| **Owner** | Bakhrom (`bakhromabdukayumov@gmail.com`), works on Windows, PowerShell, Node 24 |
| **Owner's language** | Uzbek. Replies to him should be in Uzbek; the codebase, comments, commits and docs are in English |
| **Size** | ~10,200 lines across `server/`, `public/`, `tests/` |
| **Build step** | None. No bundler, no transpiler, no framework |
| **Dependencies** | `express`, `bcryptjs`, `jsonwebtoken`, `cookie-parser`. That is all — nothing native |
| **Node** | 22.13+ required (uses the built-in `node:sqlite`) |

```bash
npm install
npm run seed     # optional demo account: demo@routine.app / demopass123
npm start        # http://localhost:3000
npm test         # 47 API tests
npm run test:ui  # 30 browser tests (needs playwright, skips cleanly without it)
```

---

## 2. What the product is

A personal routine / habit tracker. The original brief, from the owner in Uzbek,
was roughly:

> Build me a complete site with a professional interface — use your frontend
> UI/UX skills to the maximum and write the backend well too. The point of the
> site is that you enter each task with its time, and can mark it done or not
> done. It should be a full site for managing routines — add new features of
> your own. And all users should sign up / log in and their data should be
> saved, day by day.

So the shape of the thing is: **a routine is a plan** (what, when, how often),
**a log is what actually happened on a given day**, and everything else —
streaks, statistics, calendar, achievements — is derived from those two.

### Feature set as built

- **Accounts** — email + password, bcrypt (cost 12), database-backed sessions
- **Routines** — clock time + duration or "anytime"; five recurrence rules
  (daily / chosen weekdays / every N days / days of month / once); start and
  end dates; simple check *or* a measurable target ("20 pages", "8 glasses");
  priority, category, colour, emoji icon, optional reminder
- **Logging** — done / skipped / partial, one row per (routine, date)
- **Day view** — hour-ordered timeline grouped into morning/afternoon/evening/
  night, a "now" marker, progress ring, week strip, complete-all, copy-yesterday
- **Calendar** — month grid with per-day completion and logged mood
- **Statistics** — completion trend, weekday and category breakdowns, a
  year-long activity heatmap, strongest/weakest routine leaderboards, period
  comparison vs the previous window
- **Journal** — free text plus mood and energy (1–5), autosaved
- **Achievements** — XP, levels, 18 badges
- **Settings** — profile, theme, language, week start, daily goal, browser
  reminders, active sessions, JSON/CSV export, account deletion
- **Extras** — command palette (Ctrl/⌘+K), single-key navigation, dark + light
  themes, English / Uzbek / Russian, responsive down to a mobile tab bar

Counts, if you need them: 10 categories, 5 template packs, 18 achievements,
3 locales (~255 keys each).

---

## 3. How the session went

Useful mainly because the mistakes are the traps you would otherwise repeat.

### Round 1 — build
Started from a completely empty repository (no commits at all). Built the
backend first, then wrote 46 API tests and only then started the client. Three
commits: backend, frontend, tests+README.

### Round 2 — visual review
Screenshotted every page in Chromium at 1440×940 and 390×844 and actually
looked at them. That found things tests never would:

| Found | Fix |
|---|---|
| `event.currentTarget` was `null` after the first `await` in async click handlers → `TypeError` | Capture `const button = event.currentTarget` before awaiting. Fixed in 3 files |
| Switching language did not translate the nav/header — only the current view re-rendered | `main.js` subscribes to the store and re-renders the whole shell when locale or theme changes |
| Settings captured `state.user` once, so saving a preference redrew stale values (new avatar colour selected, avatar unchanged) | Re-read `state.user` at the top of every `render()`. Two regression tests added |
| SVG charts used `preserveAspectRatio="none"`, which stretched the **text** as well as the shapes | Charts are now rebuilt at the container's real pixel width via `ResizeObserver` (`responsiveChart()` in `charts.js`) |
| Heatmap showed a huge dead zone before the account existed | Server clamps the range to the first routine's `start_date`, with an 8-week floor so a new account still has a grid |
| Calendar showed "0/10" and an empty bar on **future** days, reading as failure | `monthGrid()` only renders progress when `date <= today` |
| Calendar cells were `aspect-ratio: 1/1` → enormous squares on a wide grid | `min-height: 96px` on desktop, square only on mobile |
| Sidebar user chip rendered "Demo Userdemo@routi…" on one line | The name/email spans are `display: block` |
| Four KPI tiles stacked one-per-screen on a phone | Two-up grid under 760px |
| Emoji in KPI labels had no gap (`🎯COMPLETION`) — flex `gap` does not separate bare text nodes | Wrap the emoji in a `<span>` |

### Round 3 — it would not run on the owner's PC
He cloned it on Windows with Node 24 and `npm start` crashed with
`Could not locate the bindings file … better_sqlite3.node`. **Two independent
causes**, both inherent to depending on a compiled module:

1. npm blocked `better-sqlite3`'s install script under its `allowScripts`
   policy, so the native binding was never fetched at all.
2. `better-sqlite3@11.10.0` ships no prebuilt binary for Node 24's ABI
   (`node-v137`), so even with scripts approved it would fall back to compiling
   from source — which needs Visual Studio Build Tools on Windows.

Fixing only (1) would have walked him straight into (2). The dependency was
removed entirely in favour of Node's built-in `node:sqlite`. See §6.

---

## 4. Architecture

```
server/
  index.js          Express app: security headers, CORS, routers, static, SPA fallback
  config.js         .env reader (no dotenv dep), paths, generated dev JWT secret
  db/
    driver.js       Picks node:sqlite or better-sqlite3; mutes the experimental notice
    index.js        Opens the DB, applies PRAGMAs + schema, exports `db` and `tx()`
    schema.sql      6 tables, indexes, cascade rules
    seed.js         Demo account with ~3 months of plausible history
  lib/
    dates.js        ISO-date arithmetic, timezone-aware "today"
    schedule.js     `isDueOn(routine, date)` — the recurrence engine
    stats.js        Daily series, streaks, breakdowns, XP curve
    achievements.js 18 badges, each measuring itself against a stats snapshot
    auth.js         bcrypt, token issue/revoke, `publicUser()`
    validate.js     Declarative per-field validator
    errors.js       `ApiError` with an HTTP status
    starter.js      5 template packs + the sign-up starter set
  middleware/
    auth.js         `requireAuth` — resolves bearer token or cookie
    rateLimit.js    In-memory fixed-window limiter
    error.js        `notFound`, `errorHandler`, `asyncHandler`
  routes/
    auth.js routines.js days.js stats.js journal.js misc.js

public/
  index.html        Shell + pre-hydration splash
  styles/           tokens → base → layout → components → views  (load in that order)
  app/
    main.js         Router, app shell, keyboard shortcuts, boot
    api.js          Typed client, `ApiError` carries per-field messages
    store.js        `state`, subscribe/notify, session bootstrap, preferences
    dom.js          `el()` — the only way anything reaches the DOM
    charts.js       Hand-drawn SVG: line, bar, barList, heatmap, monthGrid
    icons.js        Inline icon paths (no icon font, no external request)
    i18n.js         en / uz / ru dictionaries + `t()`
    ui.js           toast, modal, confirmDialog, celebrate, progressRing, empty/skeleton
    palette.js      Command palette
    reminders.js    Browser notifications, once per routine per day
    utils.js        Dates, formatting, category colours, emoji/colour choices
    views/          today, routines, routine-detail, routine-form, calendar,
                    stats, journal, achievements, auth, settings

tests/
  api.test.js       47 end-to-end HTTP tests against a throwaway database
  ui.test.js        30 Chromium tests driving the real UI
```

### Data model

Six tables, all scoped to `users.id` with `ON DELETE CASCADE`, so deleting an
account is one statement.

- **users** — credentials + preferences (`theme`, `locale`, `week_start`,
  `daily_goal`, `timezone`, `reminders_on`, `avatar_color`)
- **routines** — the plan. Recurrence lives in `repeat_type` + `repeat_days` +
  `repeat_every` + `start_date`/`end_date`. Measurement in `goal_type` +
  `target_value` + `unit`
- **logs** — one row per routine per day. `UNIQUE (routine_id, log_date)` is
  what makes "toggle done" an idempotent upsert instead of a read-modify-write
  race
- **journal** — `UNIQUE (user_id, entry_date)`, mood/energy 1–5 + body
- **achievements** — unlocked badge codes, so a badge is celebrated exactly once
- **sessions** — one row per login. The JWT carries the session id, so logout
  and password changes revoke tokens immediately

### API

Everything under `/api`. All routes need auth except `/api/health`,
`/api/auth/register` and `/api/auth/login`.

```
POST   /auth/register  /auth/login  /auth/logout  /auth/password
GET    /auth/me        PATCH /auth/me       DELETE /auth/me
GET    /auth/sessions  DELETE /auth/sessions/:id

GET    /routines       GET /routines/:id
POST   /routines       PATCH /routines/:id   DELETE /routines/:id
POST   /routines/:id/duplicate     POST /routines/reorder

GET    /days/:date              ("today" works as the date)
GET    /days/:date/week         GET /days/month/:year/:month
POST   /days/log                POST /days/:date/complete-all
POST   /days/:date/copy-from    GET /days/upcoming/list?days=7

GET    /stats/summary      (level, streak, today's progress — drives the shell)
GET    /stats/overview?days=30    /stats/heatmap?days=364    /stats/routines
GET    /stats/achievements (persists new unlocks)

GET    /journal      GET|PUT /journal/:date
GET    /templates    POST /templates/:id/apply
GET    /search?q=    GET /export    GET /export.csv
```

---

## 5. Design decisions worth not undoing

**Dates are plain `YYYY-MM-DD` strings, everywhere.** They sort correctly,
survive JSON, and cannot drift across a daylight-saving boundary. Conversion to
a real `Date` happens only inside `lib/dates.js`, always at **UTC noon**. Do not
introduce `Date` objects into route or view code.

**Recurrence is computed, never stored.** There is no table of future
occurrences to keep in sync — `isDueOn(routine, date)` answers directly. This is
why editing a routine's schedule instantly changes the calendar and the
statistics with no migration.

**Streaks forgive unscheduled days.** A day with `due === 0` neither extends nor
breaks a streak, and today cannot break a streak until it is over. Punishing a
planned rest day is bad habit design. See `computeStreak()` in `lib/stats.js`.

**No `innerHTML` for user data.** The client builds every node with `el()` in
`dom.js`, which sets `textContent` and attributes rather than parsing markup, so
a routine titled `<img onerror=…>` is just a title. The server sends a strict
CSP to match (`script-src 'self'`, no inline scripts). Keep both halves.

**Validation is declarative and collects every error.** `validate(body, schema)`
returns all field errors at once so a form can highlight everything in one
round-trip. `ApiError.badRequest(msg, fields)` → the client's `ApiError.fields`.

**Sign-in cannot enumerate accounts.** An unknown email runs a bcrypt compare
against a dummy hash so the answer and the timing match a wrong password.

**Two stats endpoints on purpose.** `/stats/summary` is cheap and polled by the
app shell; `/stats/achievements` *persists* new unlocks and returns
`newly_unlocked` so the achievements page can celebrate once. If the shell
called the latter it would consume that signal. Do not merge them.

**One `el()` call, not a template string.** Same for charts: they are hand-drawn
SVG rather than a charting library, so they are themeable through CSS variables
and add no dependency.

---

## 6. The SQLite driver (read before touching `server/db/`)

The app uses **`node:sqlite`, built into Node 22.13+**. `better-sqlite3` was
removed as a dependency because it broke on a clean Windows + Node 24 install
(see §3, round 3). Do not add it back without a very good reason — that would
reintroduce install scripts, prebuilt-binary roulette and a compiler
requirement on Windows.

`server/db/driver.js` still supports `better-sqlite3` as a *fallback if the user
installs it themselves*, selectable with `DATABASE_DRIVER=auto|node|better-sqlite3`.
Both paths pass the full test suite.

Two API differences that the code already works around — keep them in mind:

- **`node:sqlite` has no `db.transaction()`.** `db/index.js` exports `tx(fn)`
  instead: `BEGIN`/`COMMIT` at the top level, `SAVEPOINT` when nested, rollback
  on throw. `fn` **must be synchronous**. All 9 call sites use it.
- **No `db.pragma()`.** PRAGMAs go through `db.exec('PRAGMA …')`, which works on
  both drivers.

Verified behaviour of `node:sqlite` (tested, not assumed): named parameters work
with bare keys (`@user_id` ↔ `{ user_id }`), `lastInsertRowid` is a number,
`get()` returns `undefined` for no row, rows are null-prototype objects that
`JSON.stringify` fine, `ON CONFLICT … DO UPDATE` works, booleans are rejected as
bind values (the validator already converts to 0/1), and unknown named
parameters throw.

**The experimental warning.** Node prints "SQLite is an experimental feature".
Adding a `process.on('warning')` listener does **not** suppress Node's default
printing — this was tested and it does not work. `driver.js` wraps
`process.emitWarning` around the import instead, filters only that one message,
and restores the original immediately.

---

## 7. Conventions

- **Branch**: work on `claude/manga-site-full-build-vjfk2v`. Never push elsewhere
  without asking.
- **Commits**: imperative subject, a body explaining *why*, and the trailer
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Never put a model
  name anywhere else in the repo.
- **No PR** unless he explicitly asks for one.
- **Comments** explain *why*, not what. Match the existing density — the code is
  commented at the level of a decision, not a line.
- **New user-facing string?** Add it to all three dictionaries in `i18n.js`.
  Missing keys fall back to English and then to the key itself, so a miss
  degrades to readable text rather than a blank.
- **New CSS?** Use the tokens in `tokens.css`. Never hard-code a colour. Both
  themes must work — light is not an afterthought.
- **New view?** One module in `app/views/`, exporting `render<Name>(container,
  { navigate, params })`. Register it in `ROUTES` in `main.js`.
- **New endpoint?** Add an `api.js` method and a test in `tests/api.test.js`.

---

## 8. Verification status

Everything below was actually run, not assumed.

- `npm test` — **47 passed, 0 failed**, on both `node:sqlite` and `better-sqlite3`
- `npm run test:ui` — **30 passed, 0 failed**, with zero console errors, page
  errors or failed requests
- The browser test covers: sign-up, sign-in, sign-out, session persistence
  across reload, logging, quantity steppers, the routine modal, templates,
  search, calendar navigation, chart rendering, journal persistence, badge
  unlocking, the command palette, theme toggle + persistence, preference saving,
  language switching, the 404 state and the mobile layout
- Every page was screenshotted and visually reviewed in dark and light themes,
  desktop and mobile
- The server was started for real and `/api/health` plus the SPA shell were
  confirmed to return 200

---

## 9. Known gaps and plausible next steps

Nothing here is broken — these are simply things that were never in scope.

- **No password reset / email verification.** There is no mail transport at all.
- **No `main` branch exists.** The remote has only the feature branch. He was
  offered a merge into `main` and has not asked for it yet, so `git clone`
  alone does not check the project out — the branch has to be named.
- **Single-process assumptions.** The rate limiter is in-memory and SQLite is a
  single file, so horizontal scaling would need a shared store first.
- **Reminders are foreground-only.** They use the Notification API from the open
  tab, not a service worker, so nothing fires when the tab is closed. There is a
  `manifest.webmanifest` but no service worker and no offline support.
- **No routine drag-and-drop.** `POST /routines/reorder` and `sort_order` exist
  and are tested; the UI never wires them up.
- **`GET /days/upcoming/list`** is implemented and tested but no view uses it —
  an "up next" panel was planned and not built (`today.upNext` exists in i18n).
- **`sparkline()` in `charts.js`** is written and unused.
- **No CI.** Tests are run by hand.
- **`node:sqlite` is marked "active development"** by Node. The surface used
  here has been stable since it was unflagged, and `DATABASE_DRIVER=better-sqlite3`
  is the escape hatch if that ever changes.

---

## 10. Fast start for a new session

```bash
git pull
npm install
npm run seed && npm start     # then open http://localhost:3000
```

Read in this order: this file → `server/db/schema.sql` (the data model explains
the product) → `server/lib/schedule.js` (the recurrence engine everything
depends on) → `public/app/main.js` (routing and the shell) → whichever view you
are changing.

Then, before you claim anything works: `npm test`, and `npm run test:ui` if you
touched the client.
