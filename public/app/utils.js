/** Formatting and small helpers shared across views. */

export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function pad(n) { return String(n).padStart(2, '0'); }

export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function weekdayOf(iso) { return parseISO(iso).getUTCDay(); }

export function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

/** "Mon, 6 Sep" / "Monday, 6 September 2026" */
export function formatDate(iso, { long = false, locale = 'en' } = {}) {
  const options = long
    ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    : { weekday: 'short', day: 'numeric', month: 'short' };
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone: 'UTC' }).format(parseISO(iso));
  } catch {
    return iso;
  }
}

export function formatMonth(year, month, locale = 'en') {
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(year, month - 1, 12)));
  } catch {
    return `${year}-${pad(month)}`;
  }
}

function intlLocale(locale) {
  return { en: 'en-GB', uz: 'uz-UZ', ru: 'ru-RU' }[locale] || 'en-GB';
}

/** "Today" / "Yesterday" / a formatted date. */
export function relativeDay(iso, t, locale = 'en') {
  const diff = daysBetween(todayISO(), iso);
  if (diff === 0) return t('date.today');
  if (diff === -1) return t('date.yesterday');
  if (diff === 1) return t('date.tomorrow');
  return formatDate(iso, { locale });
}

/** 95 → "1h 35m" */
export function formatDuration(minutes) {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Current local time as 'HH:MM'. */
export function nowTime() {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** Bucket a clock time into a part of the day, for timeline grouping. */
export function timeBucket(time) {
  if (!time) return 'anytime';
  const hour = Number(time.slice(0, 2));
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

export function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || '?';
}

export function debounce(fn, wait = 250) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

/** Percentage with no decimal noise: 66.666 → 67 */
export function pct(value) {
  return value === null || value === undefined ? null : Math.round(value);
}

/** 0-4 password strength score, mirroring the server's minimum rules. */
export function passwordScore(value) {
  if (!value) return 0;
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  else if (/\d/.test(value)) score += 0.5;
  return clamp(Math.round(score), 0, 4);
}

export const CATEGORY_COLORS = {
  health: '#0ea5e9', fitness: '#22c55e', work: '#6366f1', study: '#f97316',
  personal: '#ec4899', mindfulness: '#a855f7', social: '#14b8a6',
  finance: '#eab308', home: '#f43f5e', other: '#64748b',
};

export const EMOJI_CHOICES = [
  '✅', '🏃', '💧', '📖', '🧘', '💪', '🥗', '😴', '🧠', '📝', '💻', '🎯',
  '🎸', '🎨', '🧹', '💊', '☕', '🚶', '🚴', '🏋️', '📚', '🗒️', '📵', '🌅',
  '🌙', '🙏', '💰', '📞', '🐕', '🌱', '🍎', '⏰',
];

export const COLOR_CHOICES = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e', '#f97316',
  '#f59e0b', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#64748b',
];
