import { el, mount } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { illustration } from './illustrations.js';

/* --- Toasts --------------------------------------------------------------- */

const TOAST_ICONS = { success: 'check', error: 'alert', info: 'info' };

export function toast(message, kind = 'success', duration = 3200) {
  const stack = document.getElementById('toasts');
  if (!stack) return;

  const node = el('div', { class: `toast toast--${kind}` },
    el('span', { class: 'toast__icon' }, icon(TOAST_ICONS[kind] || 'info', { size: 13, stroke: 2.6 })),
    el('span', { class: 'grow' }, message),
  );

  stack.appendChild(node);
  const remove = () => {
    node.classList.add('is-leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 500);
  };
  const timer = setTimeout(remove, duration);
  node.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

/* --- Modal ---------------------------------------------------------------- */

let openModal = null;

/**
 * Render a modal. `build(close)` returns the body/footer content, so a form can
 * close itself once its request resolves.
 */
export function modal({ title, subtitle, size = '', build, onClose }) {
  closeModal();

  const root = document.getElementById('modal-root');
  const previouslyFocused = document.activeElement;

  const close = (result) => {
    if (!openModal) return;
    document.removeEventListener('keydown', onKey, true);
    document.body.style.removeProperty('overflow');
    mount(root);
    openModal = null;
    previouslyFocused?.focus?.();
    onClose?.(result);
  };

  const onKey = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(null); return; }
    if (event.key !== 'Tab') return;
    // Keep focus inside the dialog.
    const focusables = [...dialog.querySelectorAll(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )].filter((n) => n.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const content = build(close);

  const dialog = el('div', {
    class: `modal ${size ? `modal--${size}` : ''}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title || 'Dialog',
  },
    el('div', { class: 'modal__head' },
      el('div', null,
        el('div', { class: 'modal__title' }, title),
        subtitle ? el('div', { class: 'modal__sub' }, subtitle) : null,
      ),
      el('button', {
        class: 'btn btn--icon modal__close',
        type: 'button',
        'aria-label': t('action.close'),
        onclick: () => close(null),
      }, icon('x', { size: 18 })),
    ),
    el('div', { class: 'modal__body' }, content.body),
    content.footer ? el('div', { class: 'modal__foot' }, content.footer) : null,
  );

  const backdrop = el('div', {
    class: 'modal-backdrop',
    onmousedown: (event) => { if (event.target === backdrop) close(null); },
  }, dialog);

  mount(root, backdrop);
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKey, true);
  openModal = { close };

  // Focus the first meaningful control, not the close button.
  requestAnimationFrame(() => {
    const target = dialog.querySelector('[data-autofocus], input:not([type=hidden]), textarea, select, button.btn--primary');
    target?.focus?.();
  });

  return close;
}

export function closeModal() {
  openModal?.close(null);
}

/** Promise-based confirmation dialog. Resolves to true/false. */
export function confirmDialog({ title, message, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    modal({
      title,
      size: 'narrow',
      build: (close) => ({
        body: el('p', { class: 'muted' }, message),
        footer: [
          el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => close(false) }, t('action.cancel')),
          el('button', {
            class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
            type: 'button',
            'data-autofocus': '',
            onclick: () => close(true),
          }, confirmLabel || t('action.confirm')),
        ],
      }),
      onClose: (result) => resolve(result === true),
    });
  });
}

/**
 * Ask the user to pick one of a few actions, each explained in a line.
 * Resolves with the chosen `value`, or null when cancelled.
 *
 * @param {{ title: string, message?: string,
 *           choices: Array<{ value: string, label: string, hint?: string, danger?: boolean }> }} options
 */
export function choiceDialog({ title, message, choices }) {
  return new Promise((resolve) => {
    modal({
      title,
      size: 'narrow',
      build: (close) => ({
        body: el('div', { class: 'col', style: { gap: 'var(--s-3)' } },
          message ? el('p', { class: 'muted' }, message) : null,
          ...choices.map((choice, index) => el('button', {
            type: 'button',
            class: ['choice', choice.danger && 'choice--danger'],
            ...(index === 0 ? { 'data-autofocus': '' } : {}),
            onclick: () => close(choice.value),
          },
            el('span', { class: 'choice__label' }, choice.label),
            choice.hint ? el('span', { class: 'choice__hint' }, choice.hint) : null,
          )),
        ),
        footer: [
          el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => close(null) }, t('action.cancel')),
        ],
      }),
      onClose: (result) => resolve(typeof result === 'string' ? result : null),
    });
  });
}

/* --- Celebration ---------------------------------------------------------- */

/**
 * A rubber stamp pressed onto the page: "Day closed", "Badge earned".
 * It replaces a confetti burst — one decisive mark in the theme's accent,
 * the way a finished page gets stamped, rather than a shower of colour.
 * Decorative only (aria-hidden; the toast says it in words), and skipped
 * when the user prefers reduced motion.
 */
export function celebrate({ big = t('celebrate.dayClosed'), small = '' } = {}) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelector('.stamp-layer')?.remove();

  const layer = el('div', { class: 'stamp-layer', 'aria-hidden': 'true' },
    el('div', { class: 'stamp' },
      el('div', { class: 'stamp__inner' },
        el('span', { class: 'stamp__big' }, big),
        small ? el('span', { class: 'stamp__small' }, small) : null,
      ),
    ),
  );
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 2100);
}

/* --- Building blocks ------------------------------------------------------ */

export function emptyState({ art = 'list', title, text, action }) {
  return el('div', { class: 'empty' },
    el('div', { class: 'empty__art' }, illustration(art) || art),
    el('div', { class: 'empty__title' }, title),
    text ? el('p', { class: 'empty__text' }, text) : null,
    action || null,
  );
}

export function skeletonList(count = 4, variant = 'row') {
  return el('div', { class: 'col' },
    ...Array.from({ length: count }, () => el('div', { class: `skeleton skeleton--${variant}` })),
  );
}

export function spinnerButton(button, busy) {
  if (busy) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
}

/** Progress ring used by the day hero and stats tiles. */
export function progressRing(percent, { size = 116, stroke = 10, label, sublabel, color } = {}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = Math.max(0, Math.min(100, percent || 0));
  const offset = circumference * (1 - value / 100);

  // One solid stroke in the theme's accent (or the caller's colour).
  return el('div', { class: 'ring-wrap', style: { width: `${size}px`, height: `${size}px` } },
    el('svg', { class: 'ring', width: size, height: size, viewBox: `0 0 ${size} ${size}` },
      el('circle', {
        class: 'ring__track', cx: size / 2, cy: size / 2, r: radius, 'stroke-width': stroke,
      }),
      el('circle', {
        class: 'ring__value',
        cx: size / 2, cy: size / 2, r: radius,
        'stroke-width': stroke,
        stroke: color || 'var(--accent)',
        'stroke-dasharray': circumference,
        'stroke-dashoffset': offset,
      }),
    ),
    el('div', { class: 'ring-wrap__inner' },
      el('div', { style: { 'font-size': `${size / 4.4}px`, 'font-weight': '500' }, class: 'tnum' }, label),
      sublabel ? el('div', { class: 'subtle tnum', style: { 'font-size': '11px' } }, sublabel) : null,
    ),
  );
}

/**
 * Count a number up from zero in place: "0%" → "86%". Used for the day's
 * percentage and the statistics figures on first paint, so the number feels
 * measured rather than printed. Instant under reduced motion.
 */
export function countUp(node, to, { suffix = '', duration = 700 } = {}) {
  const target = Number(to);
  if (!Number.isFinite(target) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    node.textContent = `${Number.isFinite(target) ? target : to}${suffix}`;
    return node;
  }
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - p) ** 3;
    node.textContent = `${Math.round(target * eased)}${suffix}`;
    if (p < 1) requestAnimationFrame(step);
  };
  node.textContent = `0${suffix}`;
  requestAnimationFrame(step);
  return node;
}
