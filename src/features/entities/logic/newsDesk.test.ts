// ── features/entities/logic/newsDesk.test.ts ──────────────────────────────
// The /news editorial rules: headline split, desks, lead, bulletins, bylines.

import { describe, expect, it } from 'vitest';
import {
  DESKS,
  bulletinLabel,
  byline,
  COSMOS_KINDS,
  cosmicVoice,
  dispatchForm,
  groupBulletins,
  kicker,
  pickLead,
  splitHeadline,
} from './newsDesk';

describe('splitHeadline', () => {
  it('leads with the first sentence and keeps the rest as body', () => {
    expect(splitHeadline('Three clubs went into the weekend with something to prove. Right now the top is wobbling.'))
      .toEqual({ headline: 'Three clubs went into the weekend with something to prove.', body: 'Right now the top is wobbling.' });
  });

  it('keeps a one-sentence dispatch whole as the headline', () => {
    expect(splitHeadline('The standings have shifted.')).toEqual({ headline: 'The standings have shifted.', body: '' });
  });

  it('handles question and exclamation marks and a closing quote', () => {
    expect(splitHeadline('Who saw that coming? Nobody did.').headline).toBe('Who saw that coming?');
    expect(splitHeadline('"It is over." The manager left.').headline).toBe('"It is over."');
  });

  it('refuses a headline longer than a headline should be', () => {
    const long = `${'A very long opening clause that keeps going '.repeat(4)}and ends. Short.`;
    expect(splitHeadline(long)).toEqual({ headline: '', body: long });
  });
});

describe('desks and forms', () => {
  it('offers three desks, All first, every feed kind on exactly one other desk', () => {
    expect(DESKS.map((d) => d.label)).toEqual(['All', 'Reports', 'Pundits']);
    const kinds = DESKS.flatMap((d) => d.kinds ?? []);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const k of ['journalist_report', 'sports_writer_column', 'pundit_takes', 'media_buzz', 'political_decree']) {
      expect(kinds, k).toContain(k);
    }
  });

  it('keeps the cosmos out of every desk: it has one panel of its own', () => {
    const all = DESKS.find((d) => d.key === 'all')!;
    expect(all.exclude).toEqual(COSMOS_KINDS);
    for (const d of DESKS) for (const k of COSMOS_KINDS) expect(d.kinds ?? [], d.key + ':' + k).not.toContain(k);
  });

  it('names the voice behind every cosmic kind', () => {
    expect(cosmicVoice('balance_whisper')).toBe('The Arbiter');
    expect(cosmicVoice('chaos_whisper')).toBe('The Trickster');
    for (const k of ['architect_whisper', 'cosmic_omen', 'cosmic_disturbance', 'fate_whisper']) expect(cosmicVoice(k), k).toBe('The Architect');
  });

  it('sets pundits as quotes, the cosmos as transmissions, the rest as reports', () => {
    expect(dispatchForm('pundit_takes')).toBe('quote');
    expect(dispatchForm('balance_whisper')).toBe('transmission');
    expect(dispatchForm('sports_writer_column')).toBe('report');
    expect(dispatchForm('something_new')).toBe('report');
  });

  it('labels kinds in plain words, prettifying unknown ones', () => {
    expect(kicker('sports_writer_column')).toBe('Column');
    expect(kicker('brand_new_kind')).toBe('Brand new kind');
  });
});

describe('pickLead', () => {
  it('leads with the newest report, skipping newer whispers and quotes', () => {
    const rows = [{ kind: 'architect_whisper' }, { kind: 'pundit_takes' }, { kind: 'journalist_report' }];
    expect(pickLead(rows)).toBe(rows[2]);
  });

  it('falls back to the newest dispatch when there is no reporting', () => {
    const rows = [{ kind: 'architect_whisper' }, { kind: 'pundit_takes' }];
    expect(pickLead(rows)).toBe(rows[0]);
    expect(pickLead([])).toBeNull();
  });
});

describe('bulletins', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 13, h, m).toISOString();

  it('groups consecutive items filed in the same hour, newest first', () => {
    const items = [{ t: at(16, 0) }, { t: at(16, 1) }, { t: at(14, 0) }, { t: at(12, 0) }, { t: at(12, 5) }];
    const groups = groupBulletins(items, (i) => i.t);
    expect(groups.map((g) => g.items.length)).toEqual([2, 1, 2]);
    expect(groups[0]!.at.getHours()).toBe(16);
  });

  it('keeps an undated item in the bulletin before it', () => {
    const groups = groupBulletins([{ t: at(9) }, { t: 'nonsense' }], (i) => i.t);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(2);
  });

  it('labels today, yesterday and older bulletins', () => {
    const now = new Date(2026, 10, 13, 18);
    expect(bulletinLabel(new Date(2026, 10, 13, 16), now)).toBe('Today, 16:00');
    expect(bulletinLabel(new Date(2026, 10, 12, 8), now)).toBe('Yesterday, 08:00');
    expect(bulletinLabel(new Date(2026, 10, 9, 22), now)).toBe('9 Nov, 22:00');
    expect(bulletinLabel(new Date(NaN), now)).toBe('Earlier');
  });
});

describe('byline', () => {
  const e = (kind: string, meta: Record<string, unknown>) =>
    ({ id: 'id-1', kind, name: 'Zara Brennan', display_name: null, meta }) as Parameters<typeof byline>[1];

  it('names correspondents by beat, columnists by outlet, pundits by past', () => {
    expect(byline('journalist_report', e('journalist', { beat: 'gas-giants' })).role).toBe('Gas giants correspondent');
    expect(byline('sports_writer_column', e('sports_writer', { employer: 'BBM' })).role).toBe('Columnist, BBM');
    expect(byline('pundit_takes', e('pundit', { era: 'retired_player' })).role).toBe('Pundit, former player');
    expect(byline('pundit_takes', e('pundit', { era: 'retired_coach' })).role).toBe('Pundit, former coach');
    expect(byline('balance_whisper', e('cosmic_voice', {})).role).toBe('Cosmic voice');
  });

  it('links to the author and falls back to the house voices when there is none', () => {
    expect(byline('journalist_report', e('journalist', {})).id).toBe('id-1');
    expect(byline('architect_whisper', null)).toEqual({ id: null, name: 'The Cosmic Architect', role: 'Unattributed by statute' });
    expect(byline('journalist_report', undefined)).toEqual({ id: null, name: 'The Wire', role: 'Staff' });
  });
});
