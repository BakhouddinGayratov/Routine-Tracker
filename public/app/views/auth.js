import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import { t, LOCALES, setLocale, getLocale } from '../i18n.js';
import { signIn, signUp } from '../store.js';
import { toast } from '../ui.js';
import { passwordScore } from '../utils.js';
import { ApiError } from '../api.js';

/**
 * Sign in / sign up.
 *
 * One component handles both modes: the fields and copy differ, the plumbing
 * (validation display, busy state, error surface) does not.
 */
export function renderAuth(container, { mode = 'login', navigate }) {
  let current = mode;

  const render = () => {
    mount(container, el('div', { class: 'auth' }, hero(), panel()));
  };

  const hero = () => el('section', { class: 'auth__hero' },
    el('div', { class: 'brand' },
      el('div', { class: 'brand__logo' }, icon('check', { size: 19, stroke: 3 })),
      el('div', null,
        el('div', { class: 'brand__name' }, t('app.name')),
        el('div', { class: 'brand__tag' }, t('app.tagline')),
      ),
    ),
    el('div', null,
      el('h1', { class: 'auth__headline' },
        t('auth.hero.title'), ' ',
        el('em', null, t('auth.hero.titleAccent')),
      ),
      el('p', { class: 'auth__lede' }, t('auth.hero.lede')),
      el('div', { class: 'auth__features' },
        feature('⏱️', t('auth.hero.f1.title'), t('auth.hero.f1.text')),
        feature('✅', t('auth.hero.f2.title'), t('auth.hero.f2.text')),
        feature('📈', t('auth.hero.f3.title'), t('auth.hero.f3.text')),
      ),
    ),
    el('div', { class: 'auth__proof' },
      proof('5', t('auth.proof.routines')),
      proof('18', t('auth.proof.badges')),
      proof('∞', t('auth.proof.free')),
    ),
  );

  const feature = (emoji, title, text) => el('div', { class: 'auth__feature' },
    el('div', { class: 'auth__feature-icon' }, emoji),
    el('div', null, el('strong', null, title), el('span', null, text)),
  );

  const proof = (value, label) => el('div', null,
    el('strong', null, value),
    el('span', null, label),
  );

  const panel = () => {
    const isLogin = current === 'login';
    const errorBox = el('div', { class: 'auth__error hidden' });
    const fields = {};

    const showError = (message) => {
      mount(errorBox, icon('alert', { size: 15 }), el('span', null, message));
      errorBox.classList.remove('hidden');
    };
    const clearErrors = () => {
      errorBox.classList.add('hidden');
      for (const field of Object.values(fields)) {
        field.wrap.classList.remove('has-error');
        field.error.textContent = '';
      }
    };

    const field = (name, { label, type = 'text', autocomplete, placeholder, hint }) => {
      const error = el('div', { class: 'field__error' });
      const input = el('input', {
        class: 'input', type, name, id: `f-${name}`,
        autocomplete, placeholder, required: true,
        'data-autofocus': name === (isLogin ? 'email' : 'name') ? '' : null,
      });
      const wrap = el('div', { class: 'field' },
        el('label', { class: 'field__label', for: `f-${name}` }, label),
        input,
        hint ? el('div', { class: 'field__hint' }, hint) : null,
        error,
      );
      fields[name] = { input, wrap, error };
      return wrap;
    };

    const submit = el('button', { class: 'btn btn--primary btn--lg btn--block', type: 'submit' },
      isLogin ? t('auth.signIn') : t('auth.signUp'));

    const form = el('form', {
      class: 'auth__form',
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        clearErrors();
        submit.setAttribute('aria-busy', 'true');

        const payload = isLogin
          ? { email: fields.email.input.value.trim(), password: fields.password.input.value }
          : {
              name: fields.name.input.value.trim(),
              email: fields.email.input.value.trim(),
              password: fields.password.input.value,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
              locale: document.documentElement.lang || 'en',
            };

        try {
          const user = isLogin ? await signIn(payload) : await signUp(payload);
          toast(isLogin ? `${t('auth.welcome')}, ${user.name}` : `${t('auth.welcome')}, ${user.name}`);
          navigate('/today');
        } catch (err) {
          if (err instanceof ApiError && err.fields) {
            for (const [name, message] of Object.entries(err.fields)) {
              const target = fields[name];
              if (target) {
                target.wrap.classList.add('has-error');
                target.error.textContent = message;
              }
            }
            showError(err.message);
          } else {
            showError(err.message || t('error.generic'));
          }
        } finally {
          submit.removeAttribute('aria-busy');
        }
      },
    },
      el('h1', null, isLogin ? t('auth.welcome') : t('auth.createTitle')),
      el('p', null, isLogin ? t('auth.welcomeSub') : t('auth.createSub')),
      errorBox,
      el('div', { class: 'auth__fields' },
        isLogin ? null : field('name', { label: t('auth.name'), autocomplete: 'name', placeholder: 'Bakhrom' }),
        field('email', { label: t('auth.email'), type: 'email', autocomplete: 'email', placeholder: 'you@example.com' }),
        field('password', {
          label: t('auth.password'),
          type: 'password',
          autocomplete: isLogin ? 'current-password' : 'new-password',
          placeholder: '••••••••',
          hint: isLogin ? null : t('auth.passwordHint'),
        }),
        isLogin ? null : strengthMeter(fields.password.input),
        el('div', { style: { 'margin-top': 'var(--s-2)' } }, submit),
      ),
      el('div', { class: 'auth__alt' },
        isLogin ? t('auth.noAccount') : t('auth.haveAccount'), ' ',
        el('a', {
          href: isLogin ? '/register' : '/login',
          onclick: (event) => {
            event.preventDefault();
            current = isLogin ? 'register' : 'login';
            history.replaceState({}, '', current === 'login' ? '/login' : '/register');
            render();
          },
        }, isLogin ? t('auth.signUp') : t('auth.signIn')),
      ),
    );

    return el('section', { class: 'auth__panel' },
      el('div', { style: { width: 'min(100%, 400px)', display: 'flex', 'justify-content': 'flex-end', 'margin-bottom': 'var(--s-4)' } },
        el('div', { class: 'segmented' },
          ...LOCALES.map((locale) => el('button', {
            type: 'button',
            class: ['segmented__item', locale.code === getLocale() && 'is-active'],
            onclick: () => {
              setLocale(locale.code);
              try { localStorage.setItem('rt.locale', locale.code); } catch { /* ignore */ }
              render();
            },
          }, locale.code.toUpperCase())),
        ),
      ),
      form,
    );
  };

  render();
}

/** Live password strength feedback, mirroring the server's rules. */
function strengthMeter(input) {
  const meter = el('div', { class: 'strength', dataset: { score: '0' } },
    el('i'), el('i'), el('i'), el('i'));
  input.addEventListener('input', () => {
    meter.dataset.score = String(passwordScore(input.value));
  });
  return meter;
}
