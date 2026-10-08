import { el } from './dom.js';

/**
 * Line drawings for empty and error states, in place of a big emoji.
 *
 * Drawn in the theme's ink (.ink), on its paper (.paper), with one stroke in
 * the accent (.mark) that draws itself in — the one thing the eye should
 * land on. All of it is CSS-coloured, so each theme gets its own version.
 */

const svg = (...children) => el('svg', { class: 'ill', viewBox: '0 0 160 120', 'aria-hidden': 'true' }, ...children);
const path = (cls, d) => el('path', { class: cls, d });

const DRAWINGS = {
  /** An open day: a calendar page with nothing on it yet, and a pencil. */
  day: () => svg(
    path('paper', 'M34 22h80a6 6 0 0 1 6 6v68a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6z'),
    path('ink', 'M28 40h92M50 14v16M98 14v16'),
    path('ink-faint', 'M42 56h20M42 70h44M42 84h30'),
    path('mark', 'M96 60l22 22M112 76l8-8 6 6-8 8z M96 60l-4 10 10-4'),
  ),

  /** A notebook with a ribbon, for the journal. */
  notebook: () => svg(
    path('paper', 'M40 16h66a6 6 0 0 1 6 6v80a6 6 0 0 1-6 6H40z'),
    path('ink', 'M40 16v92M32 30h14M32 52h14M32 74h14M32 96h14'),
    path('ink-faint', 'M56 38h40M56 50h40M56 62h28'),
    path('mark', 'M90 16v34l7-6 7 6V16'),
  ),

  /** A chart still waiting for its line. */
  chart: () => svg(
    path('ink', 'M30 18v80h104'),
    path('ink-faint', 'M30 78h104M30 58h104M30 38h104'),
    path('mark', 'M36 86c14-4 18-26 32-26s16 16 28 12 18-30 34-36'),
    el('circle', { class: 'dot', cx: 130, cy: 36, r: 3.5 }),
  ),

  /** A target, for goals. */
  target: () => svg(
    el('circle', { class: 'ink', cx: 72, cy: 62, r: 38 }),
    el('circle', { class: 'ink-faint', cx: 72, cy: 62, r: 25 }),
    el('circle', { class: 'ink', cx: 72, cy: 62, r: 12 }),
    path('mark', 'M74 60l44-40M108 18l10 2 2 10'),
  ),

  /** A to-do list, for the routine library. */
  list: () => svg(
    path('paper', 'M36 14h88a6 6 0 0 1 6 6v84a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6V20a6 6 0 0 1 6-6z'),
    path('ink', 'M46 36h8v8h-8zM46 60h8v8h-8zM46 84h8v8h-8z'),
    path('ink-faint', 'M64 40h48M64 64h40M64 88h44'),
    path('mark', 'M44 38l4 4 9-10'),
  ),

  /** A magnifier over a page, for searches that found nothing. */
  search: () => svg(
    path('paper', 'M34 14h64a6 6 0 0 1 6 6v80a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6V20a6 6 0 0 1 6-6z'),
    path('ink-faint', 'M40 34h48M40 48h36M40 62h44'),
    el('circle', { class: 'mark', cx: 100, cy: 70, r: 18 }),
    path('mark', 'M113 83l18 18'),
  ),

  /** A torn page, for errors. */
  error: () => svg(
    path('paper', 'M38 14h84v40l-10 8 8 10-10 8 10 10v14H38z'),
    path('ink-faint', 'M50 32h48M50 46h40'),
    path('mark', 'M64 78l16 16M80 78L64 94'),
  ),

  /** A trophy, for achievements still to come. */
  trophy: () => svg(
    path('ink', 'M56 20h48v24a24 24 0 0 1-48 0z M56 28H44v6a12 12 0 0 0 12 12M104 28h12v6a12 12 0 0 1-12 12M80 68v18M64 100h32M68 86h24v14H68z'),
    path('mark', 'M70 38l7 7 14-15'),
  ),
};

// The emoji the views used to pass map onto drawings, so a call site that
// still says '🗓️' gets the picture rather than the emoji.
const ALIASES = {
  '🗓️': 'day', '📅': 'day', '📆': 'day',
  '📓': 'notebook', '📝': 'notebook', '📔': 'notebook', '✍️': 'notebook',
  '📊': 'chart', '📈': 'chart',
  '🎯': 'target',
  '✅': 'list', '📋': 'list', '🗂️': 'list',
  '🔍': 'search', '🔎': 'search',
  '⚠️': 'error', '❌': 'error',
  '🏆': 'trophy', '🌱': 'list',
};

/** The drawing for `name` (or an aliased emoji), or null if there is none. */
export function illustration(name) {
  const key = DRAWINGS[name] ? name : ALIASES[name];
  return key ? DRAWINGS[key]() : null;
}
