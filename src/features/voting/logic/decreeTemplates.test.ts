// ── voting/logic/decreeTemplates.test.ts ─────────────────────────────────────
// Unit tests for the Election Night decree text builders.
//
// COVERAGE INTENT
// ───────────────
//   • Determinism: same RNG, same output.
//   • Token substitution: {TEAM} / {FOCUS} / {PLAYER} resolve correctly,
//     unknown tokens are preserved literally.
//   • Idol-band switching: top-10 players use the love-themed bank, others
//     use the neutral bank.
//   • Tier switching: major focuses use the heavier bank, minor uses lighter.
//   • Output sanity: no template is empty, every output contains at least one
//     of the expected substitutions.

import { describe, expect, it } from 'vitest';
import {
  buildProclamationDecree,
  buildFocusEnactmentDecree,
  buildIncinerationDecree,
} from './decreeTemplates';

// Deterministic RNG stub for snapshot-style assertions.
// Always returns the same value so pickTemplate selects index 0 every call.
const FIRST_TEMPLATE_RNG = (): number => 0;

// Maximally-late RNG: pushes pickTemplate to the last index of every pool.
const LAST_TEMPLATE_RNG = (): number => 0.9999;

describe('buildProclamationDecree', () => {
  it('returns a non-empty string', () => {
    const text = buildProclamationDecree(FIRST_TEMPLATE_RNG);
    expect(text).toBeTruthy();
    expect(text.length).toBeGreaterThan(10);
  });

  it('is deterministic when given a deterministic RNG', () => {
    const a = buildProclamationDecree(FIRST_TEMPLATE_RNG);
    const b = buildProclamationDecree(FIRST_TEMPLATE_RNG);
    expect(a).toBe(b);
  });

  it('produces different lines when seeded to first vs last bank entry', () => {
    expect(buildProclamationDecree(FIRST_TEMPLATE_RNG)).not.toBe(
      buildProclamationDecree(LAST_TEMPLATE_RNG),
    );
  });
});

describe('buildFocusEnactmentDecree', () => {
  it('substitutes {TEAM} and {FOCUS} tokens', () => {
    const text = buildFocusEnactmentDecree(
      'Olympus Mons FC',
      'Sign Star Player',
      'major',
      FIRST_TEMPLATE_RNG,
    );
    expect(text).toContain('Olympus Mons FC');
    expect(text).toContain('Sign Star Player');
    expect(text).not.toContain('{TEAM}');
    expect(text).not.toContain('{FOCUS}');
  });

  it('uses the major bank for major-tier focuses', () => {
    const major = buildFocusEnactmentDecree('Saturn Rings United', 'Sign Star Player', 'major', FIRST_TEMPLATE_RNG);
    // First entry in FOCUS_MAJOR_TEMPLATES uses "cosmos has heard you"
    expect(major).toContain('cosmos has heard you');
  });

  it('uses the minor bank for minor-tier focuses', () => {
    const minor = buildFocusEnactmentDecree('Mars Athletic', 'Upgrade Stadium', 'minor', FIRST_TEMPLATE_RNG);
    // First entry in FOCUS_MINOR_TEMPLATES uses "quieter wish"
    expect(minor).toContain('quieter wish');
  });

  it('is deterministic across repeated calls with the same RNG', () => {
    const a = buildFocusEnactmentDecree('Mercury Runners FC', 'Promote Youth', 'minor', FIRST_TEMPLATE_RNG);
    const b = buildFocusEnactmentDecree('Mercury Runners FC', 'Promote Youth', 'minor', FIRST_TEMPLATE_RNG);
    expect(a).toBe(b);
  });
});

describe('buildIncinerationDecree', () => {
  it('substitutes {PLAYER} and {TEAM} tokens', () => {
    const text = buildIncinerationDecree('Nova Tachyon', 'Saturn Rings United', null, FIRST_TEMPLATE_RNG);
    expect(text).toContain('Nova Tachyon');
    expect(text).toContain('Saturn Rings United');
    expect(text).not.toContain('{PLAYER}');
    expect(text).not.toContain('{TEAM}');
  });

  it('uses the love-themed bank for top-10 idols', () => {
    // First entry in INCINERATION_TOP_IDOL_TEMPLATES uses "loved too much"
    const text = buildIncinerationDecree('Star Player', 'Earth United FC', 3, FIRST_TEMPLATE_RNG);
    expect(text).toContain('loved too much');
  });

  it('uses the neutral bank for non-top players (rank > 10)', () => {
    // First entry in INCINERATION_COMMON_TEMPLATES uses "cosmos has chosen"
    const text = buildIncinerationDecree('Unknown Player', 'Pluto FC Wanderers', 47, FIRST_TEMPLATE_RNG);
    expect(text).toContain('cosmos has chosen');
    expect(text).not.toContain('loved too much');
  });

  it('uses the neutral bank when idol rank is null', () => {
    const text = buildIncinerationDecree('Ghost', 'Vesta United', null, FIRST_TEMPLATE_RNG);
    expect(text).not.toContain('loved too much');
  });

  it('switches at the rank-10 boundary', () => {
    const rank10 = buildIncinerationDecree('Rank10', 'Mars', 10, FIRST_TEMPLATE_RNG);
    const rank11 = buildIncinerationDecree('Rank11', 'Mars', 11, FIRST_TEMPLATE_RNG);
    // rank 10 → top-idol bank, rank 11 → common bank.  First-template RNG
    // selects different leading strings between the two banks.
    expect(rank10).toContain('loved too much');
    expect(rank11).toContain('cosmos has chosen');
  });
});
