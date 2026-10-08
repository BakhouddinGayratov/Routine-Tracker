import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import { t, LOCALES } from '../i18n.js';
import { api, ApiError } from '../api.js';
import { state, updateProfile, signOut, THEMES } from '../store.js';
import { toast, confirmDialog, modal, emptyState } from '../ui.js';
import { COLOR_CHOICES, EMOJI_CHOICES, CATEGORY_COLORS, initials, formatDate } from '../utils.js';
import { requestNotificationPermission, notificationState } from '../reminders.js';
import { enablePush, disablePush, pushState } from '../push.js';

/** Profile, appearance, preferences, security, data and account deletion. */
export function renderSettings(container, { navigate }) {
  // Re-read the user on every render: saving a preference replaces the object
  // in the store, and a stale closure would redraw the old values.
  let user = state.user;
  let sessions = [];

  const sessionsSlot = el('div');

  // Whether reminders reach this browser with the site closed (server push),
  // only while it is open, or not at all — plus a way to prove it works.
  const pushStatus = el('div', { class: 'push-status' });

  // Reminders default to on for a new account, so the switch above is usually
  // already on and never changes — it cannot be the only way to subscribe a
  // device. When this device has no subscription, the status line carries its
  // own button, and that click is where the permission prompt happens.
  const turnOnPush = async (event) => {
    const button = event.currentTarget;
    button.setAttribute('aria-busy', 'true');
    try {
      const ok = await enablePush({ ask: true });
      if (!ok) toast(t('settings.remindersBlocked'), 'error');
    } catch (err) {
      toast(t('settings.pushFailed', { reason: err.message || t('error.generic') }), 'error');
    } finally {
      button.removeAttribute('aria-busy');
      paintPushStatus();
    }
  };

  const sendTest = async (event) => {
    const button = event.currentTarget;
    button.setAttribute('aria-busy', 'true');
    try {
      const result = await api.pushTest();
      if (result.ok) {
        toast(t('settings.pushTestSent'), 'success');
      } else {
        // The push service's own answer ("403 BadJwtToken") beats "something went wrong".
        const failed = result.results?.find((r) => !r.ok);
        const reason = failed ? `${failed.status || '—'} ${failed.reason || ''}`.trim() : t('error.generic');
        toast(t('settings.pushTestFailed', { reason }), 'error');
      }
    } catch (err) {
      toast(err.message || t('error.generic'), 'error');
    } finally {
      button.removeAttribute('aria-busy');
      paintPushStatus();
    }
  };

  const paintPushStatus = async () => {
    const stateNow = await pushState().catch(() => 'unsupported');
    if (!state.user?.reminders_on || stateNow === 'denied') { mount(pushStatus); return; }

    const text = {
      on: 'settings.pushOn',
      off: 'settings.pushOff',
      unsupported: 'settings.pushUnsupported',
      'needs-install': 'settings.pushInstall',
    }[stateNow];

    mount(pushStatus,
      el('span', { class: ['push-status__text', stateNow === 'on' && 'is-on'] }, t(text)),
      stateNow === 'on'
        ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: sendTest }, t('settings.pushTest'))
        : stateNow === 'off'
          ? el('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: turnOnPush }, t('settings.pushEnable'))
          : null,
    );
  };

  const render = () => {
    user = state.user;
    paintPushStatus();
    mount(container,
      el('div', { class: 'page-head' },
        el('h1', null, t('settings.title')),
        el('p', null, t('settings.sub')),
      ),
      profileCard(),
      appearanceCard(),
      preferencesCard(),
      routineDefaultsCard(),
      securityCard(),
      dataCard(),
      dangerCard(),
    );
    loadSessions();
  };

  /** Persist a single preference and reflect the result immediately. */
  const patch = async (data, { silent = false } = {}) => {
    try {
      await updateProfile(data);
      if (!silent) toast(t('settings.saved'));
    } catch (err) {
      toast(err.message || t('error.generic'), 'error');
    }
  };

  // --- Profile -------------------------------------------------------------

  const profileCard = () => {
    const nameInput = el('input', {
      class: 'input', type: 'text', value: user.name, maxlength: '60',
      id: 'set-name',
    });

    return el('section', { class: 'card', style: { 'margin-bottom': 'var(--s-4)' } },
      el('div', { class: 'card__head' }, el('div', { class: 'card__title' }, t('settings.profile'))),

      el('div', { class: 'row', style: { 'margin-bottom': 'var(--s-5)' } },
        el('div', { class: 'avatar avatar--lg', style: { background: user.avatar_color } }, initials(user.name)),
        el('div', null,
          el('div', { style: { 'font-weight': '640' } }, user.name),
          el('div', { class: 'subtle', style: { 'font-size': 'var(--text-sm)' } }, user.email),
          el('div', { class: 'subtle', style: { 'font-size': 'var(--text-xs)' } },
            `${t('settings.joined')}: ${formatDate(user.created_at.slice(0, 10), { locale: user.locale })}`),
        ),
      ),

      el('div', { class: 'field' },
        el('label', { class: 'field__label', for: 'set-name' }, t('settings.name')),
        el('div', { class: 'input-group' },
          nameInput,
          el('button', {
            class: 'btn btn--secondary',
            onclick: () => {
              const value = nameInput.value.trim();
              if (value.length < 2) { toast(`${t('settings.name')} ${t('misc.required')}`, 'error'); return; }
              patch({ name: value }).then(render);
            },
          }, t('action.save')),
        ),
      ),

      el('div', { class: 'field', style: { 'margin-top': 'var(--s-4)' } },
        el('div', { class: 'field__label' }, t('settings.avatar')),
        el('div', { class: 'picker-grid' },
          ...COLOR_CHOICES.map((color) => el('button', {
            type: 'button',
            class: ['swatch', color === user.avatar_color && 'is-on'],
            style: { background: color },
            'aria-label': color,
            onclick: () => patch({ avatar_color: color }, { silent: true }).then(render),
          })),
        ),
      ),
    );
  };

  // --- Appearance ----------------------------------------------------------

  const appearanceCard = () => el('section', { class: 'card', style: { 'margin-bottom': 'var(--s-4)' } },
    el('div', { class: 'card__head' }, el('div', { class: 'card__title' }, t('settings.appearance'))),

    // Each look previewed in its own paper, ink and type, whatever the
    // current one is — choosing a theme is choosing how the app feels.
    el('div', { class: 'col', style: { gap: 'var(--s-3)', padding: 'var(--s-2) 0 var(--s-4)', 'border-bottom': '1px solid var(--line)' } },
      el('div', { class: 'settings-row__title' }, t('settings.theme')),
      el('div', { class: 'theme-cards' },
        ...THEMES.map((theme) => el('button', {
          type: 'button',
          class: ['theme-card', `theme-card--${theme}`, user.theme === theme && 'is-on'],
          'aria-pressed': String(user.theme === theme),
          onclick: () => patch({ theme }, { silent: true }).then(render),
        },
          el('span', { class: 'theme-card__sample', 'aria-hidden': 'true' },
            el('b', null, t(`theme.${theme}.sample`)), el('i'), el('u'), el('em'),
          ),
          el('span', { class: 'theme-card__name' }, t(`theme.${theme}`)),
          el('span', { class: 'theme-card__desc' }, t(`theme.${theme}.desc`)),
        )),
      ),
    ),

    el('div', { class: 'settings-row' },
      el('div', { class: 'settings-row__text' },
        el('div', { class: 'settings-row__title' }, t('settings.language')),
      ),
      el('div', { class: 'settings-row__control' },
        el('select', {
          class: 'select',
          onchange: (e) => patch({ locale: e.target.value }).then(render),
        }, ...LOCALES.map((l) => el('option', { value: l.code, selected: l.code === user.locale }, l.label))),
      ),
    ),
  );

  // --- Preferences ---------------------------------------------------------

  const preferencesCard = () => {
    const goalValue = el('span', { class: 'tnum', style: { 'font-weight': '640', 'min-width': '46px' } },
      `${user.daily_goal}%`);

    return el('section', { class: 'card', style: { 'margin-bottom': 'var(--s-4)' } },
      el('div', { class: 'card__head' }, el('div', { class: 'card__title' }, t('settings.preferences'))),

      el('div', { class: 'settings-row' },
        el('div', { class: 'settings-row__text' },
          el('div', { class: 'settings-row__title' }, t('settings.weekStart')),
        ),
        el('div', { class: 'settings-row__control' },
          el('div', { class: 'segmented' },
            ...[[1, t('settings.monday')], [0, t('settings.sunday')]].map(([value, label]) => el('button', {
              type: 'button',
              class: ['segmented__item', user.week_start === value && 'is-active'],
              onclick: () => patch({ week_start: value }, { silent: true }).then(render),
            }, label)),
          ),
        ),
      ),

      el('div', { class: 'settings-row' },
        el('div', { class: 'settings-row__text' },
          el('div', { class: 'settings-row__title' }, t('settings.dailyGoal')),
          el('div', { class: 'settings-row__desc' }, t('settings.dailyGoalDesc')),
        ),
        el('div', { class: 'settings-row__control row', style: { width: '220px' } },
          el('input', {
            type: 'range', min: '10', max: '100', step: '5', value: String(user.daily_goal),
            style: { flex: '1' },
            oninput: (e) => { goalValue.textContent = `${e.target.value}%`; },
            onchange: (e) => patch({ daily_goal: Number(e.target.value) }, { silent: true }),
          }),
          goalValue,
        ),
      ),

      el('div', { class: 'settings-row' },
        el('div', { class: 'settings-row__text' },
          el('div', { class: 'settings-row__title' }, t('settings.timezone')),
        ),
        el('div', { class: 'settings-row__control' },
          el('div', { class: 'input-group' },
            el('input', { class: 'input', value: user.timezone, readonly: true, style: { width: '210px' } }),
            el('button', {
              class: 'btn btn--secondary btn--sm',
              onclick: () => patch({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }).then(render),
            }, icon('repeat', { size: 14 })),
          ),
        ),
      ),

      el('div', { class: 'settings-row' },
        el('div', { class: 'settings-row__text' },
          el('div', { class: 'settings-row__title' }, t('settings.reminders')),
          el('div', { class: 'settings-row__desc' },
            notificationState() === 'denied' ? t('settings.remindersBlocked') : t('settings.remindersDesc')),
          pushStatus,
        ),
        el('div', { class: 'settings-row__control' },
          el('label', { class: 'switch' },
            el('input', {
              type: 'checkbox',
              checked: user.reminders_on,
              disabled: notificationState() === 'denied',
              onchange: async (e) => {
                const input = e.target;
                if (input.checked) {
                  const granted = await requestNotificationPermission();
                  if (!granted) {
                    input.checked = false;
                    toast(t('settings.remindersBlocked'), 'error');
                    return;
                  }
                  // Subscribe before anything else is awaited: on iPhone the
                  // tap stops counting as the user's after a network request.
                  try {
                    await enablePush();
                  } catch (err) {
                    toast(t('settings.pushFailed', { reason: err.message || t('error.generic') }), 'error');
                  }
                } else {
                  await disablePush().catch(() => {});
                }
                await patch({ reminders_on: input.checked }, { silent: true });
                paintPushStatus();
              },
            }),
            el('span', { class: 'switch__track' }),
          ),
        ),
      ),
    );
  };

  // --- Security ------------------------------------------------------------

  const securityCard = () => {
    const current = el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const next = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });

    return el('section', { class: 'card', style: { 'margin-bottom': 'var(--s-4)' } },
      el('div', { class: 'card__head' }, el('div', { class: 'card__title' }, t('settings.security'))),

      el('div', { class: 'grid grid--2' },
        el('div', { class: 'field' },
          el('div', { class: 'field__label' }, t('settings.currentPassword')),
          current,
        ),
        el('div', { class: 'field' },
          el('div', { class: 'field__label' }, t('settings.newPassword')),
          next,
          el('div', { class: 'field__hint' }, t('auth.passwordHint')),
        ),
      ),
      el('button', {
        class: 'btn btn--secondary',
        style: { 'margin-top': 'var(--s-4)' },
        onclick: async (event) => {
          const button = event.currentTarget;
          button.setAttribute('aria-busy', 'true');
          try {
            await api.changePassword({ current_password: current.value, new_password: next.value });
            current.value = '';
            next.value = '';
            toast(t('settings.passwordChanged'));
            loadSessions();
          } catch (err) {
            const message = err instanceof ApiError && err.fields
              ? Object.values(err.fields)[0]
              : err.message;
            toast(message || t('error.generic'), 'error');
          } finally {
            button.removeAttribute('aria-busy');
          }
        },
      }, icon('lock', { size: 15 }), t('settings.changePassword')),

      el('div', { class: 'section', style: { 'margin-top': 'var(--s-6)' } },
        el('div', { class: 'settings-row__title' }, t('settings.sessions')),
        el('div', { class: 'settings-row__desc' }, t('settings.sessionsDesc')),
        sessionsSlot,
      ),
    );
  };

  const loadSessions = async () => {
    try {
      const res = await api.sessions();
      sessions = res.sessions;
      mount(sessionsSlot, el('div', { style: { 'margin-top': 'var(--s-3)' } },
        ...sessions.map((session) => el('div', { class: 'session-row' },
          icon(session.current ? 'zap' : 'user', { size: 15 }),
          el('div', { class: 'grow truncate' },
            el('div', { style: { 'font-weight': '580' } },
              session.current ? t('settings.thisDevice') : describeAgent(session.user_agent)),
            el('div', { class: 'subtle', style: { 'font-size': 'var(--text-xs)' } },
              `${formatDate(session.last_seen.slice(0, 10), { locale: user.locale })}`),
          ),
          session.current
            ? el('span', { class: 'badge badge--success' }, '●')
            : el('button', {
                class: 'btn btn--ghost btn--sm',
                onclick: async () => { await api.revokeSession(session.id); loadSessions(); },
              }, t('settings.revoke')),
        )),
      ));
    } catch {
      mount(sessionsSlot);
    }
  };

  // --- Data ----------------------------------------------------------------

  // --- New routine presets -------------------------------------------------

  /**
   * The values a new routine starts with. The app's own defaults suit nobody
   * in particular; someone who plans every morning in 30-minute daily blocks
   * should not have to set that on each routine. Only new routines use these.
   */
  const routineDefaultsCard = () => {
    const current = user.routine_defaults || {};

    const save = (key, value) => {
      const next = { ...current };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return patch({ routine_defaults: next }, { silent: true }).then(render);
    };

    const row = (title, control, desc) => el('div', { class: 'settings-row' },
      el('div', { class: 'settings-row__text' },
        el('div', { class: 'settings-row__title' }, title),
        desc ? el('div', { class: 'settings-row__desc' }, desc) : null,
      ),
      el('div', { class: 'settings-row__control' }, control),
    );

    // A select whose options are [value, label]; values travel as text and
    // `parse` turns the chosen one back into what the server stores.
    const select = (key, options, selected, parse = (x) => x) => el('select', {
      class: 'select',
      onchange: (e) => save(key, parse(e.target.value)),
    }, ...options.map(([value, label]) => el('option', { value: String(value), selected: String(value) === String(selected) }, label)));

    const lengths = [0, 15, 30, 45, 60, 90, 120];
    const lengthLabel = (m) => (!m ? t('defaults.noLength')
      : m < 60 || m % 60 ? t('form.minutesShort', { count: m }) : t('form.hoursShort', { count: m / 60 }));

    return el('section', { class: 'card', style: { 'margin-bottom': 'var(--s-4)' } },
      el('div', { class: 'card__head' },
        el('div', { class: 'card__title' }, t('defaults.title')),
        Object.keys(current).length
          ? el('button', {
              class: 'btn btn--ghost btn--sm', type: 'button',
              onclick: () => patch({ routine_defaults: {} }).then(render),
            }, t('defaults.reset'))
          : null,
      ),
      el('p', { class: 'settings-row__desc', style: { margin: '0 0 var(--s-3)' } }, t('defaults.desc')),

      row(t('form.repeat'),
        select('repeat_type', [['once', t('repeat.once')], ['daily', t('repeat.daily')]], current.repeat_type || 'once')),

      row(t('defaults.length'),
        select('duration_min', lengths.map((m) => [m, lengthLabel(m)]), current.duration_min ?? 0, Number),
        t('defaults.lengthDesc')),

      row(t('form.reminder'),
        select('reminder_min', [
          ['', t('form.reminderNone')],
          [0, t('form.reminderAt')],
          ...[5, 10, 15, 30, 60].map((m) => [m, t('form.reminderBefore', { count: m })]),
        ], current.reminder_min ?? '', (x) => (x === '' ? null : Number(x)))),

      row(t('form.category'),
        select('category', Object.keys(CATEGORY_COLORS).map((c) => [c, t(`cat.${c}`)]), current.category || 'personal')),

      row(t('form.priority'),
        select('priority', ['low', 'normal', 'high'].map((p) => [p, t(`priority.${p}`)]), current.priority || 'normal')),

      row(t('form.icon'),
        select('icon', EMOJI_CHOICES.map((e) => [e, e]), current.icon || '✅')),

      el('div', { class: 'field', style: { 'margin-top': 'var(--s-3)' } },
        el('div', { class: 'field__label' }, t('form.color')),
        el('div', { class: 'picker-grid' },
          ...COLOR_CHOICES.map((color) => el('button', {
            type: 'button',
            class: ['swatch', color === (current.color || '#4b4fb0') && 'is-on'],
            style: { background: color },
            'aria-label': color,
            onclick: () => save('color', color),
          })),
        ),
      ),
    );
  };

  const dataCard = () => el('section', { class: 'card', style: { 'margin-bottom': 'var(--s-4)' } },
    el('div', { class: 'card__head' }, el('div', { class: 'card__title' }, t('settings.data'))),
    el('div', { class: 'settings-row' },
      el('div', { class: 'settings-row__text' },
        el('div', { class: 'settings-row__title' }, t('action.export')),
        el('div', { class: 'settings-row__desc' }, t('settings.exportDesc')),
      ),
      el('div', { class: 'settings-row__control row' },
        exportButton('json', t('settings.exportJson')),
        exportButton('csv', t('settings.exportCsv')),
      ),
    ),
    el('div', { class: 'settings-row' },
      el('div', { class: 'settings-row__text' },
        el('div', { class: 'settings-row__title' }, t('action.signOut')),
      ),
      el('button', {
        class: 'btn btn--secondary btn--sm settings-row__control',
        onclick: async () => { await signOut(); toast(t('toast.signedOut')); navigate('/login'); },
      }, icon('logout', { size: 14 }), t('action.signOut')),
    ),
  );

  // --- Danger zone ---------------------------------------------------------

  const dangerCard = () => el('section', { class: 'card danger-zone' },
    el('div', { class: 'card__head' },
      el('div', { class: 'card__title', style: { color: 'var(--danger)' } }, t('settings.danger')),
    ),
    el('div', { class: 'settings-row' },
      el('div', { class: 'settings-row__text' },
        el('div', { class: 'settings-row__title' }, t('settings.deleteAccount')),
        el('div', { class: 'settings-row__desc' }, t('settings.deleteDesc')),
      ),
      el('button', {
        class: 'btn btn--danger btn--sm settings-row__control',
        onclick: openDeleteDialog,
      }, icon('trash', { size: 14 }), t('settings.deleteAccount')),
    ),
  );

  const openDeleteDialog = () => {
    const password = el('input', {
      class: 'input', type: 'password', autocomplete: 'current-password', 'data-autofocus': '',
    });

    modal({
      title: t('settings.deleteAccount'),
      subtitle: t('settings.deleteDesc'),
      size: 'narrow',
      build: (close) => ({
        body: el('div', { class: 'field' },
          el('div', { class: 'field__label' }, t('settings.deleteConfirm')),
          password,
        ),
        footer: [
          el('button', { class: 'btn btn--ghost', onclick: () => close(null) }, t('action.cancel')),
          el('button', {
            class: 'btn btn--danger',
            onclick: async (event) => {
              const button = event.currentTarget;
              button.setAttribute('aria-busy', 'true');
              try {
                await api.deleteAccount(password.value);
                close(null);
                await signOut();
                navigate('/login');
                toast(t('settings.deleteAccount'), 'info');
              } catch (err) {
                button.removeAttribute('aria-busy');
                toast(err.message || t('error.generic'), 'error');
              }
            },
          }, t('action.delete')),
        ],
      }),
    });
  };

  render();
}

/** A readable label from a raw user-agent string. */
function describeAgent(agent) {
  if (!agent) return 'Unknown device';
  const browser = /Firefox\/[\d.]+/.test(agent) ? 'Firefox'
    : /Edg\//.test(agent) ? 'Edge'
    : /Chrome\//.test(agent) ? 'Chrome'
    : /Safari\//.test(agent) ? 'Safari'
    : 'Browser';
  const os = /Android/.test(agent) ? 'Android'
    : /iPhone|iPad/.test(agent) ? 'iOS'
    : /Mac OS X/.test(agent) ? 'macOS'
    : /Windows/.test(agent) ? 'Windows'
    : /Linux/.test(agent) ? 'Linux'
    : '';
  return os ? `${browser} · ${os}` : browser;
}

/**
 * Export control. It fetches the file with the session token rather than
 * linking to it, so it works in the iOS app too (see api.downloadExport).
 */
function exportButton(format, label) {
  return el('button', {
    class: 'btn btn--secondary btn--sm',
    type: 'button',
    onclick: async (event) => {
      const button = event.currentTarget;
      button.setAttribute('aria-busy', 'true');
      try {
        await api.downloadExport(format);
      } catch (err) {
        toast(err.message || t('error.generic'), 'error');
      } finally {
        button.removeAttribute('aria-busy');
      }
    },
  }, icon('download', { size: 14 }), label);
}
