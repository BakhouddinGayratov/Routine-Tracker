import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { db, purgeExpiredSessions, driverName, appliedMigrations } from './db/index.js';
import { scheduleBackups } from './db/backup.js';
import { requireAuth } from './middleware/auth.js';
import { rateLimit } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/error.js';
import { authRouter } from './routes/auth.js';
import { routinesRouter } from './routes/routines.js';
import { goalsRouter } from './routes/goals.js';
import { pushRouter, notificationsRouter } from './routes/push.js';
import { scheduleReminders } from './lib/reminders.js';
import { vapidSubjectProblem } from './lib/webpush.js';
import { daysRouter } from './routes/days.js';
import { statsRouter } from './routes/stats.js';
import { journalRouter } from './routes/journal.js';
import { miscRouter } from './routes/misc.js';

const app = express();

// Trust the first proxy so req.ip is the real client behind a reverse proxy.
app.set('trust proxy', 1);
app.disable('x-powered-by');

/**
 * Security headers. The CSP is strict — no inline scripts, no remote origins —
 * which the client respects: every script and style is a served file.
 */
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  });
  if (config.isProd) res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

// Optional cross-origin access, for running the SPA from a separate dev server.
if (config.corsOrigins.length) {
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && config.corsOrigins.includes(origin)) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        // Lets the app read the export's file name (api.downloadExport).
        'Access-Control-Expose-Headers': 'Content-Disposition',
        Vary: 'Origin',
      });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'routine-tracker', time: new Date().toISOString() });
});

// A generous ceiling that still stops a runaway client from hammering the API.
app.use('/api', rateLimit({ windowMs: 60_000, max: 300 }));

app.use('/api/auth', authRouter);
app.use('/api/routines', requireAuth, routinesRouter);
app.use('/api/goals', requireAuth, goalsRouter);
app.use('/api/push', requireAuth, pushRouter);
app.use('/api/notifications', requireAuth, notificationsRouter);
app.use('/api/days', requireAuth, daysRouter);
app.use('/api/stats', requireAuth, statsRouter);
app.use('/api/journal', requireAuth, journalRouter);
app.use('/api', requireAuth, miscRouter);

// Static client. Hashed asset names aren't in play here, so keep the cache
// short and let the browser revalidate.
app.use(express.static(config.publicDir, {
  index: 'index.html',
  maxAge: config.isProd ? '1h' : 0,
  etag: true,
}));

app.use(notFound);

// SPA fallback: any non-API GET renders the shell and the client router takes over.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(config.publicDir, 'index.html'));
});

app.use(errorHandler);

// Expired sessions are swept in the background; a failure there is not worth
// taking the server down for.
const sweepSessions = () => purgeExpiredSessions()
  .catch((err) => console.error(`  session sweep: ${err.message}`));
sweepSessions();
setInterval(sweepSessions, 6 * 60 * 60 * 1000).unref();

const server = app.listen(config.port, () => {
  console.log(`\n  Routine Tracker running at http://localhost:${config.port}`);
  console.log(`  ${config.env} · database: ${driverName}`);
  // Say so when an existing database was upgraded, so an unexpected schema
  // change is visible in the log rather than silent.
  for (const name of appliedMigrations) console.log(`  migrated: ${name}`);
  if (config.backup.enabled) scheduleBackups(db, config.backup);
  if (config.pushReminders) {
    scheduleReminders();
    // A bad subject makes Apple refuse every push with 403; say so at boot,
    // not after a day of reminders that never arrived.
    const problem = config.env === 'production' && vapidSubjectProblem();
    console.log(problem ? `  push: WARNING ${problem}` : '  push: VAPID configured');
  }
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

export { app };
