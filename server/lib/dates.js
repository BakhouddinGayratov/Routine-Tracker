/**
 * Date helpers.
 *
 * The whole app talks in plain 'YYYY-MM-DD' strings. They sort lexicographically,
 * survive JSON round-trips and never shift under a timezone. Conversion to a
 * real Date only happens inside these helpers, always at UTC noon so that a
 * daylight-saving jump can never move a day across a boundary.
 */

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function toDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export function toISO(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(iso) {
  return toDate(iso).getUTCDay();
}

export function dayOfMonth(iso) {
  return toDate(iso).getUTCDate();
}

/** Whole days between two ISO dates (b - a). */
export function daysBetween(a, b) {
  return Math.round((toDate(b) - toDate(a)) / 86400000);
}

/** Today in the given IANA timezone, as an ISO date. Falls back to UTC. */
export function todayIn(timezone = 'UTC') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Inclusive list of ISO dates from `from` to `to`. */
export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** First and last day of a month, as ISO dates. */
export function monthBounds(year, month /* 1-12 */) {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = toISO(new Date(Date.UTC(year, month, 0, 12)));
  return { first, last };
}
