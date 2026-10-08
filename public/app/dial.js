import { el } from './dom.js';

/**
 * The day as a 24-hour dial.
 *
 * Midnight sits at the top and the day runs clockwise. Every timed routine is
 * an arc from its start to its end, coloured by what happened: its own colour
 * when done, red when marked ✗, a quiet line while it is still ahead. A hand
 * points at the current minute. Routines that overlap move to an inner lane,
 * so two things booked at once are both visible rather than drawn over each
 * other.
 *
 * It is the app's signature picture — the brand mark is a small one — and it
 * answers at a glance what a list cannot: how the day is shaped.
 *
 * @param {Array<{ id, start_time, duration_min, status, color }>} items
 * @param {{ size?: number, now?: string|null, center?: Node|null, intro?: boolean, labels?: boolean }} options
 */
export function dayDial(items, { size = 200, now = null, center = null, intro = false, labels = true } = {}) {
  const c = size / 2;
  const showLabels = labels && size >= 150;
  // With hour labels the ring steps in to leave them room outside it, so the
  // centre stays clear for the day's figure.
  const ring = size * (showLabels ? 0.355 : 0.4);   // outermost lane
  const lane = Math.max(5, size * 0.055);
  const gap = lane * 0.5;

  const timed = items
    .filter((item) => item.start_time)
    .map((item) => {
      const start = toMinutes(item.start_time);
      // Too short to see as an arc: give it a quarter hour of ink.
      const length = Math.max(item.duration_min || 0, 15);
      return { item, start, end: Math.min(start + length, 1440 + start) };
    })
    .sort((a, b) => a.start - b.start);

  // Greedy lanes: an arc takes the outermost lane that is free at its start.
  const laneEnds = [];
  for (const arc of timed) {
    let index = laneEnds.findIndex((end) => end <= arc.start);
    if (index === -1) { index = laneEnds.length; laneEnds.push(0); }
    laneEnds[index] = arc.end;
    arc.lane = Math.min(index, 2);   // three lanes; a fourth overlap shares the last
  }

  const children = [
    // The 24 hours, faint.
    el('circle', { class: 'dial__track', cx: c, cy: c, r: ring, 'stroke-width': lane }),
  ];

  // Hour ticks outside the ring. Every sixth hour is a number instead, where
  // a watch face would put it — outside, so it never meets the arcs or the
  // figure in the middle.
  const tickFrom = ring + lane / 2 + size * 0.022;
  for (let hour = 0; hour < 24; hour += 1) {
    const major = hour % 6 === 0;
    if (major && showLabels) {
      const [x, y] = polar(c, tickFrom + size * 0.055, hour * 60);
      children.push(el('text', {
        class: 'dial__label', x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      }, String(hour).padStart(2, '0')));
      continue;
    }
    const [x1, y1] = polar(c, tickFrom, hour * 60);
    const [x2, y2] = polar(c, tickFrom + (major ? size * 0.045 : size * 0.02), hour * 60);
    children.push(el('line', { class: ['dial__tick', major && 'is-major'], x1, y1, x2, y2 }));
  }

  timed.forEach((arc, index) => {
    const radius = ring - arc.lane * (lane + gap);
    const { item } = arc;
    const status = item.status === 'done' ? 'is-done'
      : item.status === 'skipped' ? 'is-missed'
        : item.status === 'partial' ? 'is-partial' : 'is-pending';
    children.push(el('path', {
      class: ['dial__arc', status],
      d: arcPath(c, radius, arc.start, arc.end),
      'stroke-width': lane,
      pathLength: 100,
      style: {
        '--routine-color': item.color,
        'animation-delay': intro ? `${120 + index * 55}ms` : null,
      },
    }));
  });

  if (now) {
    const minute = toMinutes(now);
    const [x, y] = polar(c, ring + lane / 2, minute);
    children.push(
      el('line', { class: 'dial__hand', x1: c, y1: c, x2: x, y2: y }),
      el('circle', { class: 'dial__hand-tip', cx: x, cy: y, r: Math.max(2.5, size * 0.016) }),
    );
  }
  children.push(el('circle', { class: 'dial__hub', cx: c, cy: c, r: Math.max(2, size * 0.014) }));

  return el('div', { class: ['dial-wrap', intro && 'is-intro'], style: { width: `${size}px`, height: `${size}px` } },
    el('svg', { class: 'dial', width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-hidden': 'true' }, ...children),
    center ? el('div', { class: 'dial-wrap__center' }, center) : null,
  );
}

/** A point on the dial, `minutes` after midnight, `r` from the centre. */
function polar(c, r, minutes) {
  const angle = (minutes / 1440) * Math.PI * 2;
  return [round(c + r * Math.sin(angle)), round(c - r * Math.cos(angle))];
}

function arcPath(c, r, from, to) {
  const span = Math.min(to - from, 1439.9);
  const [x1, y1] = polar(c, r, from);
  const [x2, y2] = polar(c, r, from + span);
  const large = span > 720 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

function toMinutes(time) {
  const [h, m] = String(time).split(':').map(Number);
  return h * 60 + m;
}

const round = (n) => Math.round(n * 100) / 100;
