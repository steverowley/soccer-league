// ── voting/logic/focusTemplates.ts ───────────────────────────────────────────
// WHY: Static focus option templates used to generate per-team per-season
// focus options. In later phases, these will be replaced by LLM-generated
// options based on team lore via the Architect. For now, every team gets
// the same menu of choices.
//
// The templates are split into major (high-impact) and minor (smaller tweaks)
// tiers. The plan specifies 3–5 options per tier per team.

import type { FocusOptionTemplate } from '../types';

/**
 * Major focus options — high-impact changes that reshape the team.
 * One of these is enacted per team per season based on the vote.
 */
export const MAJOR_FOCUS_TEMPLATES: FocusOptionTemplate[] = [
  {
    option_key: 'sign_star_player',
    label: 'Sign a Star Player',
    description:
      'Invest heavily in the transfer market to bring in a proven star. ' +
      'Boosts one position significantly but costs a large chunk of the budget.',
    tier: 'major',
  },
  {
    option_key: 'stadium_upgrade',
    label: 'Upgrade the Stadium',
    description:
      'Expand capacity and improve facilities. Increases ticket revenue per fan ' +
      'for future seasons and gives a small home advantage boost.',
    tier: 'major',
  },
  {
    option_key: 'tactical_overhaul',
    label: 'Tactical Overhaul',
    description:
      'Hire a specialist coaching team to revamp the club\'s playing style. ' +
      'Changes the manager\'s tactical preferences and boosts mental stats.',
    tier: 'major',
  },
  {
    option_key: 'youth_academy',
    label: 'Invest in Youth Academy',
    description:
      'Pour resources into developing young talent. Promotes 2–3 youth players ' +
      'with high potential into the first team for next season.',
    tier: 'major',
  },
];

/**
 * Minor focus options — smaller tweaks that provide incremental advantages.
 * One of these is enacted per team per season alongside the major focus.
 */
export const MINOR_FOCUS_TEMPLATES: FocusOptionTemplate[] = [
  {
    option_key: 'preseason_camp',
    label: 'Intensive Preseason Camp',
    description:
      'Run a gruelling preseason training programme. Small boost to athletic ' +
      'and stamina stats across the squad at the cost of early-season fitness.',
    tier: 'minor',
  },
  {
    option_key: 'scout_network',
    label: 'Expand Scout Network',
    description:
      'Send scouts to uncharted colonies. Unlocks access to a wider pool of ' +
      'transfer targets and may discover a hidden gem.',
    tier: 'minor',
  },
  {
    option_key: 'fan_engagement',
    label: 'Fan Engagement Drive',
    description:
      'Invest in community outreach and fan events. Slightly increases the fan ' +
      'presence bonus and ticket revenue multiplier for next season.',
    tier: 'minor',
  },
  {
    option_key: 'sports_science',
    label: 'Sports Science Programme',
    description:
      'Hire cutting-edge physio and medical staff. Reduces injury frequency and ' +
      'speeds up recovery times for the entire squad.',
    tier: 'minor',
  },
  {
    option_key: 'mental_coaching',
    label: 'Mental Resilience Coaching',
    description:
      'Bring in a sports psychologist. Boosts mental stats across the squad, ' +
      'making players more consistent under pressure.',
    tier: 'minor',
  },
];

/**
 * All focus templates combined. Used by the option generator to create
 * per-team per-season rows.
 */
export const ALL_FOCUS_TEMPLATES: FocusOptionTemplate[] = [
  ...MAJOR_FOCUS_TEMPLATES,
  ...MINOR_FOCUS_TEMPLATES,
];
