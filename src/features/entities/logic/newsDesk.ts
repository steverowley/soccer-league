// ── features/entities/logic/newsDesk.ts ───────────────────────────────────
// The editorial rules behind /news (the Galaxy Dispatch desk), kept pure so
// they are tested without rendering:
//
//   splitHeadline   a dispatch has no headline column: its first sentence
//                   becomes the headline and the rest the body, the way a
//                   wire story leads with its point.
//   DESKS           four reader-facing sections instead of nine raw kinds.
//   pickLead        the lead story is reporting (a report or a column), not
//                   the newest line of any kind: a one-line cosmic whisper
//                   is atmosphere, not a front page.
//   groupBulletins  the scheduler files in batches; each batch is a
//                   "bulletin" with a time, which gives the feed rhythm.
//   byline          who filed it, from the actor entity: name plus a role
//                   line ("Columnist, BBM", "Pundit, former player").

import type { Entity, Narrative } from '../types';

// ── Kinds and desks ─────────────────────────────────────────────────────────

/** Kinds that are written reporting: headline plus body plus byline. */
export const REPORT_KINDS = ['journalist_report', 'sports_writer_column', 'daybreak', 'media_buzz', 'political_decree'] as const;
/** Kinds that are a person's spoken opinion: a quote with a speaker. */
export const PUNDIT_KINDS = ['pundit_takes', 'bookie_update'] as const;
/** The Architect's and the cosmic voices' kinds: short transmissions. */
export const COSMOS_KINDS = ['architect_whisper', 'cosmic_disturbance', 'cosmic_omen', 'balance_whisper', 'chaos_whisper', 'fate_whisper'] as const;

/** How a dispatch is set on the page. */
export type DispatchForm = 'report' | 'quote' | 'transmission';

/**
 * The form a kind is set in. Unknown kinds read as reports, the most
 * neutral form, so a new kind never renders as a mystery.
 *
 * @param kind  `narratives.kind`.
 * @returns     The form.
 */
export function dispatchForm(kind: string): DispatchForm {
  if ((PUNDIT_KINDS as readonly string[]).includes(kind)) return 'quote';
  if ((COSMOS_KINDS as readonly string[]).includes(kind)) return 'transmission';
  return 'report';
}

/** A reader-facing section of the desk. `kinds: null` is everything. */
export interface Desk {
  key: 'all' | 'reports' | 'pundits' | 'cosmos';
  label: string;
  kinds: readonly string[] | null;
}

/** The four desks, in filter order. */
export const DESKS: readonly Desk[] = [
  { key: 'all', label: 'All', kinds: null },
  { key: 'reports', label: 'Reports', kinds: REPORT_KINDS },
  { key: 'pundits', label: 'Pundits', kinds: PUNDIT_KINDS },
  { key: 'cosmos', label: 'The Cosmos', kinds: COSMOS_KINDS },
];

/** Kicker label per kind (the small uppercase line above a headline). */
const KICKER: Record<string, string> = {
  journalist_report: 'Report',
  sports_writer_column: 'Column',
  daybreak: 'Daybreak digest',
  media_buzz: 'Media buzz',
  political_decree: 'Decree',
  pundit_takes: 'Pundit',
  bookie_update: 'The bookmakers',
  architect_whisper: 'The Architect',
  cosmic_disturbance: 'Cosmic disturbance',
  cosmic_omen: 'Omen',
  balance_whisper: 'Balance',
  chaos_whisper: 'Chaos',
  fate_whisper: 'Fate',
};

/**
 * The kicker for a kind; unknown kinds are prettified from snake_case.
 *
 * @param kind  `narratives.kind`.
 * @returns     A short label.
 */
export function kicker(kind: string): string {
  return KICKER[kind] ?? kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

// ── Headline ────────────────────────────────────────────────────────────────

/** A first sentence longer than this is no headline: keep the paragraph whole. */
const MAX_HEADLINE_CHARS = 120;

/**
 * Split a dispatch into headline (its first sentence) and body (the rest).
 *
 * @param summary  The narrative text.
 * @returns        `body` is empty when the dispatch is one sentence, or
 *                 when its first sentence is too long to be a headline (in
 *                 which case `headline` is empty and `body` is the whole).
 */
export function splitHeadline(summary: string): { headline: string; body: string } {
  const text = summary.trim();
  const m = /^(.+?[.!?])["\u201D']?\s+(?=\S)/.exec(text);
  if (!m) return text.length <= MAX_HEADLINE_CHARS ? { headline: text, body: '' } : { headline: '', body: text };
  const first = m[0].trim();
  if (first.length > MAX_HEADLINE_CHARS) return { headline: '', body: text };
  return { headline: first, body: text.slice(m[0].length).trim() };
}

// ── Lead ────────────────────────────────────────────────────────────────────

/**
 * The lead story: the newest report or column, else the newest dispatch.
 *
 * @param rows  Narratives, newest first.
 * @returns     The lead, or null for an empty wire.
 */
export function pickLead<T extends Pick<Narrative, 'kind'>>(rows: readonly T[]): T | null {
  return rows.find((r) => dispatchForm(r.kind) === 'report' && r.kind !== 'daybreak') ?? rows[0] ?? null;
}

// ── Bulletins ───────────────────────────────────────────────────────────────

/** One filing batch: everything stamped in the same clock hour. */
export interface Bulletin<T> {
  /** Stable key: the hour, as an ISO prefix. */
  key: string;
  /** Start of the hour, for the label. */
  at: Date;
  items: T[];
}

/**
 * Group items into bulletins by the clock hour they were filed in,
 * preserving order (input is newest first, so bulletins are too).
 *
 * @param items    Feed items.
 * @param stampOf  The ISO timestamp of an item.
 * @returns        Bulletins, newest first. Items with a bad stamp join the
 *                 bulletin before them rather than being dropped.
 */
export function groupBulletins<T>(items: readonly T[], stampOf: (item: T) => string): Bulletin<T>[] {
  const out: Bulletin<T>[] = [];
  for (const item of items) {
    const t = new Date(stampOf(item));
    const valid = !Number.isNaN(t.getTime());
    const hour = valid ? new Date(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours()) : null;
    const key = hour ? hour.toISOString() : out[out.length - 1]?.key ?? 'undated';
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(item);
    else out.push({ key, at: hour ?? new Date(NaN), items: [item] });
  }
  return out;
}

/**
 * The bulletin heading: "Today, 16:00", "Yesterday, 22:00", "11 Nov, 08:00".
 *
 * @param at   Start of the bulletin's hour.
 * @param now  The current time (injected for tests).
 * @returns    The label; "Earlier" for an invalid date.
 */
export function bulletinLabel(at: Date, now: Date): string {
  if (Number.isNaN(at.getTime())) return 'Earlier';
  const time = `${String(at.getHours()).padStart(2, '0')}:00`;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((day(now) - day(at)) / 86_400_000);
  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return `Yesterday, ${time}`;
  return `${at.getDate()} ${at.toLocaleString('en-GB', { month: 'short' })}, ${time}`;
}

// ── Byline ──────────────────────────────────────────────────────────────────

/** Who filed a dispatch. `id` null means no entity page to link to. */
export interface Byline {
  id: string | null;
  name: string;
  role: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const sentence = (s: string) => s.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/**
 * The byline for a dispatch.
 *
 * @param kind    `narratives.kind` (decides the fallback voice).
 * @param author  The actor entity, when there is one and it loaded.
 * @returns       Name and role line.
 */
export function byline(kind: string, author: Pick<Entity, 'id' | 'kind' | 'name' | 'display_name' | 'meta'> | null | undefined): Byline {
  if (!author) {
    if (kind === 'architect_whisper' || kind === 'cosmic_disturbance' || kind === 'cosmic_omen') {
      return { id: null, name: 'The Cosmic Architect', role: 'Unattributed by statute' };
    }
    return { id: null, name: 'The Wire', role: 'Staff' };
  }
  const name = author.display_name ?? author.name;
  const meta = author.meta ?? {};
  switch (author.kind) {
    case 'journalist': {
      const beat = str(meta.beat);
      return { id: author.id, name, role: beat ? `${sentence(beat)} correspondent` : 'Correspondent' };
    }
    case 'sports_writer': {
      const employer = str(meta.employer);
      return { id: author.id, name, role: employer ? `Columnist, ${employer}` : 'Columnist' };
    }
    case 'pundit': {
      const era = str(meta.era);
      const was = era === 'retired_player' ? 'former player' : era === 'retired_coach' ? 'former coach' : null;
      return { id: author.id, name, role: was ? `Pundit, ${was}` : 'Pundit' };
    }
    case 'bookie':
      return { id: author.id, name, role: 'Bookmaker' };
    default:
      if (String(author.kind).startsWith('cosmic')) return { id: author.id, name, role: 'Cosmic voice' };
      return { id: author.id, name, role: sentence(String(author.kind)) };
  }
}
