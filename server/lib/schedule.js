import { weekday, dayOfMonth, daysBetween, isValidDate } from './dates.js';

/**
 * Decide whether a routine is scheduled to run on a given day.
 *
 * A routine is "due" when the date falls inside its active window
 * (start_date .. end_date) *and* matches its recurrence rule:
 *
 *   daily     — every day
 *   weekly    — on the weekdays listed in repeat_days ('1,3,5', 0 = Sunday)
 *   interval  — every N days counted from start_date
 *   monthly   — on the days of the month listed in repeat_days ('1,15')
 *   once      — only on start_date
 */
export function isDueOn(routine, iso) {
  if (!isValidDate(iso)) return false;
  if (iso < routine.start_date) return false;
  if (routine.end_date && iso > routine.end_date) return false;

  switch (routine.repeat_type) {
    case 'daily':
      return true;

    case 'once':
      return iso === routine.start_date;

    case 'weekly': {
      const days = parseList(routine.repeat_days);
      // An empty selection would silently never fire; treat it as "every day".
      return days.length === 0 ? true : days.includes(weekday(iso));
    }

    case 'monthly': {
      const days = parseList(routine.repeat_days);
      return days.length === 0 ? true : days.includes(dayOfMonth(iso));
    }

    case 'interval': {
      const every = Math.max(1, routine.repeat_every || 1);
      const diff = daysBetween(routine.start_date, iso);
      return diff >= 0 && diff % every === 0;
    }

    default:
      return false;
  }
}

function parseList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isInteger(n));
}

/** All routines from `list` that are due on `iso`, ordered the way the UI shows them. */
export function dueOn(list, iso) {
  return list.filter((r) => isDueOn(r, iso)).sort(compareForDay);
}

/**
 * Timed routines first, in clock order; untimed ("anytime") ones after them,
 * ordered by the user's manual sort and then by title.
 */
export function compareForDay(a, b) {
  const at = a.start_time || null;
  const bt = b.start_time || null;
  if (at && bt && at !== bt) return at < bt ? -1 : 1;
  if (at && !bt) return -1;
  if (!at && bt) return 1;
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.title.localeCompare(b.title);
}

/** Human-readable summary of a recurrence rule, e.g. "Mon, Wed, Fri". */
export function describeRepeat(routine) {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  switch (routine.repeat_type) {
    case 'daily':
      return 'Every day';
    case 'once':
      return `Once on ${routine.start_date}`;
    case 'weekly': {
      const days = parseList(routine.repeat_days);
      if (days.length === 0 || days.length === 7) return 'Every day';
      return days.sort((a, b) => a - b).map((d) => names[d]).join(', ');
    }
    case 'monthly': {
      const days = parseList(routine.repeat_days);
      return days.length ? `Monthly on day ${days.sort((a, b) => a - b).join(', ')}` : 'Monthly';
    }
    case 'interval':
      return routine.repeat_every === 1 ? 'Every day' : `Every ${routine.repeat_every} days`;
    default:
      return '';
  }
}
