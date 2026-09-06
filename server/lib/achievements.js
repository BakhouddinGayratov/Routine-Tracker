/**
 * Achievement catalogue.
 *
 * Each badge declares how to measure itself against a snapshot of the user's
 * data, returning `{ value, target }`. The badge unlocks when value >= target,
 * and until then the same numbers drive the progress bar in the UI — one
 * definition, no drift between "locked" and "unlocked" logic.
 */
export const ACHIEVEMENTS = [
  {
    code: 'first_step',
    name: 'First Step',
    description: 'Complete your very first routine',
    icon: '🌱',
    tier: 'bronze',
    measure: (s) => ({ value: s.totalDone, target: 1 }),
  },
  {
    code: 'getting_serious',
    name: 'Getting Serious',
    description: 'Complete 25 routines',
    icon: '💪',
    tier: 'bronze',
    measure: (s) => ({ value: s.totalDone, target: 25 }),
  },
  {
    code: 'century',
    name: 'Century',
    description: 'Complete 100 routines',
    icon: '💯',
    tier: 'silver',
    measure: (s) => ({ value: s.totalDone, target: 100 }),
  },
  {
    code: 'machine',
    name: 'The Machine',
    description: 'Complete 500 routines',
    icon: '⚙️',
    tier: 'gold',
    measure: (s) => ({ value: s.totalDone, target: 500 }),
  },
  {
    code: 'perfect_day',
    name: 'Perfect Day',
    description: 'Finish everything scheduled for a single day',
    icon: '🎯',
    tier: 'bronze',
    measure: (s) => ({ value: s.perfectDays, target: 1 }),
  },
  {
    code: 'perfect_week',
    name: 'Flawless Week',
    description: 'Reach 7 perfect days',
    icon: '🏅',
    tier: 'silver',
    measure: (s) => ({ value: s.perfectDays, target: 7 }),
  },
  {
    code: 'perfect_month',
    name: 'Untouchable',
    description: 'Reach 30 perfect days',
    icon: '👑',
    tier: 'gold',
    measure: (s) => ({ value: s.perfectDays, target: 30 }),
  },
  {
    code: 'streak_3',
    name: 'Warming Up',
    description: 'Hold a 3-day streak',
    icon: '🔥',
    tier: 'bronze',
    measure: (s) => ({ value: s.bestStreak, target: 3 }),
  },
  {
    code: 'streak_7',
    name: 'One Week Strong',
    description: 'Hold a 7-day streak',
    icon: '🔥',
    tier: 'silver',
    measure: (s) => ({ value: s.bestStreak, target: 7 }),
  },
  {
    code: 'streak_30',
    name: 'Unbreakable',
    description: 'Hold a 30-day streak',
    icon: '🚀',
    tier: 'gold',
    measure: (s) => ({ value: s.bestStreak, target: 30 }),
  },
  {
    code: 'streak_100',
    name: 'Legend',
    description: 'Hold a 100-day streak',
    icon: '🏆',
    tier: 'platinum',
    measure: (s) => ({ value: s.bestStreak, target: 100 }),
  },
  {
    code: 'architect',
    name: 'Architect',
    description: 'Design 5 routines',
    icon: '📐',
    tier: 'bronze',
    measure: (s) => ({ value: s.routineCount, target: 5 }),
  },
  {
    code: 'well_rounded',
    name: 'Well Rounded',
    description: 'Keep routines in 4 different categories',
    icon: '🧭',
    tier: 'silver',
    measure: (s) => ({ value: s.categoryCount, target: 4 }),
  },
  {
    code: 'early_bird',
    name: 'Early Bird',
    description: 'Complete 10 routines scheduled before 08:00',
    icon: '🌅',
    tier: 'silver',
    measure: (s) => ({ value: s.earlyDone, target: 10 }),
  },
  {
    code: 'night_owl',
    name: 'Night Owl',
    description: 'Complete 10 routines scheduled after 21:00',
    icon: '🌙',
    tier: 'silver',
    measure: (s) => ({ value: s.lateDone, target: 10 }),
  },
  {
    code: 'reflective',
    name: 'Reflective',
    description: 'Write 10 journal entries',
    icon: '📓',
    tier: 'bronze',
    measure: (s) => ({ value: s.journalCount, target: 10 }),
  },
  {
    code: 'level_5',
    name: 'Rising',
    description: 'Reach level 5',
    icon: '⭐',
    tier: 'silver',
    measure: (s) => ({ value: s.level, target: 5 }),
  },
  {
    code: 'level_10',
    name: 'Ascended',
    description: 'Reach level 10',
    icon: '🌟',
    tier: 'gold',
    measure: (s) => ({ value: s.level, target: 10 }),
  },
];

/** Evaluate the whole catalogue against a stats snapshot. */
export function evaluate(snapshot, unlockedCodes = new Set()) {
  return ACHIEVEMENTS.map((a) => {
    const { value, target } = a.measure(snapshot);
    const earned = value >= target;
    return {
      code: a.code,
      name: a.name,
      description: a.description,
      icon: a.icon,
      tier: a.tier,
      target,
      value: Math.min(value, target),
      raw_value: value,
      progress: Math.min(100, Math.round((value / target) * 100)),
      unlocked: earned || unlockedCodes.has(a.code),
    };
  });
}
