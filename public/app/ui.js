import { el, mount } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

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

/* --- Celebration ---------------------------------------------------------- */

/** A short confetti burst. Purely decorative, and skipped for reduced motion. */
export function celebrate(count = 60) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const colors = ['#818cf8', '#c084fc', '#22c55e', '#f59e0b', '#f43f5e', '#38bdf8'];
  const layer = el('div', { class: 'confetti', 'aria-hidden': 'true' });

  for (let i = 0; i < count; i += 1) {
    layer.appendChild(el('i', {
      style: {
        left: `${Math.random() * 100}%`,
        background: colors[i % colors.length],
        'animation-duration': `${1.6 + Math.random() * 1.4}s`,
        'animation-delay': `${Math.random() * 0.35}s`,
        transform: `scale(${0.7 + Math.random() * 0.7})`,
      },
    }));
  }

  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3600);
}

/* --- Building blocks ------------------------------------------------------ */

export function emptyState({ art = '🌱', title, text, action }) {
  return el('div', { class: 'empty' },
    el('div', { class: 'empty__art' }, art),
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
  const gradientId = `ring-${Math.random().toString(36).slice(2, 9)}`;

  return el('div', { class: 'ring-wrap', style: { width: `${size}px`, height: `${size}px` } },
    el('svg', { class: 'ring', width: size, height: size, viewBox: `0 0 ${size} ${size}` },
      el('defs', null,
        el('linearGradient', { id: gradientId, x1: '0', y1: '0', x2: '1', y2: '1' },
          el('stop', { offset: '0', 'stop-color': color || '#818cf8' }),
          el('stop', { offset: '1', 'stop-color': color || '#c084fc' }),
        ),
      ),
      el('circle', {
        class: 'ring__track', cx: size / 2, cy: size / 2, r: radius, 'stroke-width': stroke,
      }),
      el('circle', {
        class: 'ring__value',
        cx: size / 2, cy: size / 2, r: radius,
        'stroke-width': stroke,
        stroke: `url(#${gradientId})`,
        'stroke-dasharray': circumference,
        'stroke-dashoffset': offset,
      }),
    ),
    el('div', { class: 'ring-wrap__inner' },
      el('div', { style: { 'font-size': `${size / 4.4}px`, 'font-weight': '700', 'letter-spacing': '-0.03em' }, class: 'tnum' }, label),
      sublabel ? el('div', { class: 'subtle', style: { 'font-size': '11px', 'font-weight': '560' } }, sublabel) : null,
    ),
  );
}
