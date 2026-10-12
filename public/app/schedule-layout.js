/**
 * The day view's hour grid, laid out in ONE column.
 *
 * Side-by-side columns made overlapping routines hard to read: a long block
 * beside a short one looked like two things happening at once even where
 * they did not. Here every moment shows exactly one routine, chosen by a
 * single rule — the one that ends first:
 *
 *   SAT 04:30–06:00 and Bomdod 04:30–04:40  →  Bomdod 04:30–04:40,
 *                                             SAT 04:40–06:00
 *   SAT 04:30–06:00 and Bomdod 04:50–05:00  →  SAT 04:30–04:50, Bomdod,
 *                                             SAT 05:00–06:00 (split in two)
 *   Diary 04:15–04:40 and SAT 04:30–06:00   →  Diary to 04:40, then SAT
 *
 * i.e. a short thing inside a long one interrupts it and the long one
 * resumes, and of two that overlap the earlier-finishing one is finished
 * first. No routine is ever hidden: one completely covered by others still
 * gets a marker at its start.
 *
 * Pure functions on minutes since midnight — no DOM — so they are tested in
 * node (tests/api.test.js).
 */

/**
 * @param {Array<{ id: number, start: number, end: number }>} items  end ≥ start
 * @returns {Array<{ id, start, end, part, parts, marker }>} ordered, non-overlapping;
 *   `part` / `parts` number the pieces of a split routine (1-based), and a
 *   `marker` is a zero-length piece for a routine no moment was left for.
 */
export function slicePieces(items) {
  const points = [...new Set(items.flatMap((i) => [i.start, i.end]))].sort((a, b) => a - b);
  let pieces = [];

  for (let k = 0; k < points.length - 1; k += 1) {
    const a = points[k];
    const b = points[k + 1];
    const active = items.filter((i) => i.end > i.start && i.start <= a && i.end >= b);
    if (!active.length) continue;
    active.sort((x, y) => x.end - y.end || y.start - x.start || x.id - y.id);
    const best = active[0];
    // Two routines booked for exactly the same span share it in turn.
    const twins = active.filter((i) => i.end === best.end && i.start === best.start);
    const share = (b - a) / twins.length;
    twins.forEach((item, n) => pieces.push({ id: item.id, start: a + n * share, end: a + (n + 1) * share }));
  }

  // Merge the slices of one routine that touch.
  pieces = pieces.reduce((out, piece) => {
    const last = out[out.length - 1];
    if (last && last.id === piece.id && last.end === piece.start) last.end = piece.end;
    else out.push({ ...piece });
    return out;
  }, []);

  // Anything left without a moment of its own — a zero-length routine, or
  // one completely covered by shorter ones — becomes a marker at its start,
  // splitting whatever runs across that minute.
  const placed = new Set(pieces.map((p) => p.id));
  for (const item of items.filter((i) => !placed.has(i.id)).sort((a, b) => a.start - b.start || a.id - b.id)) {
    const inside = pieces.findIndex((p) => p.start < item.start && item.start < p.end);
    if (inside !== -1) {
      const host = pieces[inside];
      pieces.splice(inside, 1, { ...host, end: item.start }, { ...host, start: item.start });
    }
    pieces.push({ id: item.id, start: item.start, end: item.start, marker: true });
  }

  pieces.sort((a, b) => a.start - b.start || Number(Boolean(b.marker)) - Number(Boolean(a.marker)) || a.end - b.end);

  const counts = new Map();
  for (const p of pieces) counts.set(p.id, (counts.get(p.id) || 0) + 1);
  const seen = new Map();
  return pieces.map((p) => {
    const part = (seen.get(p.id) || 0) + 1;
    seen.set(p.id, part);
    return { ...p, part, parts: counts.get(p.id), marker: Boolean(p.marker) };
  });
}

/**
 * Turn pieces into vertical positions on a stretchable time scale: real time
 * at `ppm` pixels a minute, except that every piece is at least `minPx` tall
 * (a 5-minute routine still has room for its name and times) and an empty
 * stretch of `foldMin` minutes or more folds into a `foldPx` band.
 *
 * @returns {{ segments: Array<{ a, b, top, height, piece?, folded? }>, y: (minute: number) => number, height: number }}
 */
export function layoutColumn(pieces, { from, to, ppm = 1.15, minPx = 44, foldMin = 120, foldPx = 30 }) {
  const segments = [];
  let top = 0;
  let cursor = from;

  const gap = (a, b) => {
    if (b <= a) return;
    const folded = b - a >= foldMin;
    const height = folded ? foldPx : (b - a) * ppm;
    segments.push({ a, b, top, height, folded });
    top += height;
  };

  for (const piece of pieces) {
    gap(cursor, piece.start);
    const height = Math.max((piece.end - piece.start) * ppm, minPx);
    segments.push({ a: piece.start, b: piece.end, top, height, piece });
    top += height;
    cursor = Math.max(cursor, piece.end);
  }
  gap(cursor, to);

  /** Minutes → pixels; within a segment, in proportion to its time. */
  const y = (minute) => {
    for (const s of segments) {
      if (minute < s.b || (minute === s.b && s === segments[segments.length - 1])) {
        if (minute <= s.a) return s.top;
        return s.top + (s.b > s.a ? ((minute - s.a) / (s.b - s.a)) * s.height : 0);
      }
    }
    return top;
  };

  return { segments, y, height: top };
}
