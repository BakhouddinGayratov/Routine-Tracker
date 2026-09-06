import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { state } from '../store.js';
import { emptyState, skeletonList, celebrate, toast } from '../ui.js';
import { formatDate } from '../utils.js';

/** XP, level and the badge wall. */
export function renderAchievements(container) {
  mount(container, el('div', { class: 'col' },
    el('div', { class: 'skeleton skeleton--tile', style: { height: '130px' } }),
    el('div', { class: 'grid grid--4' },
      ...Array.from({ length: 8 }, () => el('div', { class: 'skeleton skeleton--tile' }))),
  ));

  const load = async () => {
    try {
      const data = await api.achievements();
      render(data);
      // The server reports a badge as "new" exactly once; celebrate it here.
      if (data.newly_unlocked.length) {
        celebrate(80);
        const first = data.achievements.find((a) => a.code === data.newly_unlocked[0]);
        if (first) toast(t('achv.newUnlock', { name: first.name }));
      }
    } catch (err) {
      mount(container, emptyState({
        art: '⚠️', title: t('error.loadFailed'), text: err.message,
        action: el('button', { class: 'btn btn--secondary', onclick: load }, t('action.retry')),
      }));
    }
  };

  const render = (data) => {
    const unlocked = data.achievements.filter((a) => a.unlocked);
    const locked = data.achievements.filter((a) => !a.unlocked);

    mount(container,
      el('div', { class: 'page-head' },
        el('h1', null, t('achv.title')),
        el('p', null, t('achv.sub')),
      ),

      el('section', { class: 'xp-hero' },
        el('div', { class: 'xp-hero__level' },
          el('b', null, String(data.xp.level)),
          el('span', null, t('achv.level')),
        ),
        el('div', { class: 'xp-hero__body' },
          el('div', { class: 'row row--between' },
            el('div', { style: { 'font-weight': '640' } }, `${data.xp.xp} XP`),
            el('div', { class: 'subtle', style: { 'font-size': 'var(--text-sm)' } },
              t('achv.xpToNext', { xp: data.xp.level_size - data.xp.into_level, level: data.xp.level + 1 })),
          ),
          el('div', { class: 'bar', style: { 'margin-top': 'var(--s-3)', height: '9px' } },
            el('div', { class: 'bar__fill', style: { width: `${data.xp.progress}%` } })),
          el('div', { class: 'row row--wrap', style: { gap: 'var(--s-2)', 'margin-top': 'var(--s-4)' } },
            stat('✅', data.stats.totalDone, t('stats.completion')),
            stat('🔥', data.stats.bestStreak, t('stats.bestStreak')),
            stat('💯', data.stats.perfectDays, t('stats.perfectDays')),
            stat('📓', data.stats.journalCount, t('journal.title')),
          ),
        ),
      ),

      el('section', { class: 'section' },
        el('div', { class: 'section__head' },
          el('div', { class: 'section__title' }, t('achv.badges')),
          el('div', { class: 'section__hint' },
            t('achv.unlocked', { count: unlocked.length, total: data.achievements.length })),
        ),
        el('div', { class: 'grid grid--4' },
          ...unlocked.map(badgeCard),
          ...locked.map(badgeCard),
        ),
      ),
    );
  };

  const stat = (emoji, value, label) => el('span', { class: 'chip' },
    emoji, el('b', { class: 'tnum' }, String(value)), el('span', { class: 'subtle' }, label));

  const badgeCard = (badge) => el('article', {
    class: ['badge-card', `tier-${badge.tier}`, badge.unlocked && 'is-unlocked'],
  },
    el('div', { class: 'badge-card__icon' }, badge.unlocked ? badge.icon : '🔒'),
    el('div', { class: 'badge-card__name' }, badge.name),
    el('div', { class: 'badge-card__desc' }, badge.description),
    badge.unlocked
      ? el('div', { class: 'badge badge--success' },
          icon('check', { size: 11 }),
          // A badge earned in this very request has no stored timestamp yet.
          badge.unlocked_at
            ? formatDate(badge.unlocked_at.slice(0, 10), { locale: state.user.locale })
            : t('achv.earned'))
      : el('div', { class: 'badge-card__progress' },
          el('div', { class: 'bar bar--sm' },
            el('div', { class: 'bar__fill', style: { width: `${badge.progress}%` } })),
          el('div', { class: 'subtle tnum', style: { 'font-size': 'var(--text-xs)', 'margin-top': '5px' } },
            `${badge.value} / ${badge.target}`),
        ),
  );

  load();
}
