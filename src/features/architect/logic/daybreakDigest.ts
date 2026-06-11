// ── architect/logic/daybreakDigest.ts ────────────────────────────────────────
//
// Pure template + selection logic for the Daybreak Digest — a single
// 2–3 sentence morning anchor written once per UTC day and shown at the top
// of the Home page.  The plan calls for "a daily generated `narratives` row
// tagged `kind=daybreak`. Surfaces at top of Home page each morning" so fans
// have a reason to open the site first thing.
//
// WHY PURE TEMPLATES (NOT LLM)
//   Same rationale as decreeTemplates.ts and voicesInVoid.ts: determinism,
//   zero cost, no Anthropic-key dependency for daily content that fires
//   regardless of API health.  LLM enrichment (richer phrasing, name
//   references) is layerable later — keep the floor stable first.
//
// WHY HERE (not in features/match/)
//   The Daybreak Digest is the Architect's morning voice — same ownership
//   as the rest of the Galaxy Dispatch (Architect whispers, cosmic
//   disturbances).  Co-locating with voicesInVoid.ts keeps all
//   between-match cosmic content under one feature.
//
// DUPLICATION CONTRACT
//   The architect-galaxy-tick edge function (Deno) mirrors the template
//   banks below inline.  See voicesInVoid.ts for why and how — when
//   either bank changes, both must move together.

// ── Narrative kind discriminant ──────────────────────────────────────────────

/**
 * The `narratives.kind` value written by the daybreak generator.
 * The NewsFeedPage filter strip recognises this and the Home page
 * banner reads the most recent row matching it.
 */
export const DAYBREAK_KIND = 'daybreak';

// ── UTC window when the daybreak should fire ────────────────────────────────
//
// The cron runs every 2 hours.  We want the daybreak to appear during
// EU/US morning hours roughly — early UTC works for both timezones.
// 06:00 UTC = 07/08 CET morning, 02:00 EST late night → fans see fresh
// content when they open the site at start of their day.
//
// Window is intentionally wide (06–10 UTC) so a missed cron tick at
// exactly 06:00 still catches the digest on the 08:00 trigger.

/** Earliest UTC hour the cron may write the daybreak digest. */
export const DAYBREAK_WINDOW_START_HOUR_UTC = 6;

/** Latest UTC hour the cron may write the daybreak digest.  Exclusive. */
export const DAYBREAK_WINDOW_END_HOUR_UTC = 10;

// ── Input bundle ────────────────────────────────────────────────────────────

/**
 * Context the edge function passes to the digest builder.  All fields are
 * optional except `matchesPlayed` because that's the only signal the digest
 * always has access to — the others depend on whether anything happened
 * overnight.  The builder selects a template variant based on which fields
 * are populated, so a quiet night still produces something publishable.
 */
export interface DaybreakContext {
  /** Number of completed matches in the overnight window (since last digest). */
  matchesPlayed: number;
  /**
   * Whether each of the three cosmic voices spoke overnight.  Drives the
   * "the voices were noisy" vs "the voices were silent" template branches.
   */
  voicesSpoke: {
    fate:    boolean;
    balance: boolean;
    chaos:   boolean;
  };
  /**
   * Short qualitative label for the biggest overnight event.  PRE-REDACTED
   * — never a raw score or rank.  Examples:
   *   "an incineration"
   *   "a cosmic disturbance"
   *   "an upset in the outer rim"
   *   "a late equaliser that felt fated"
   *
   * Null when nothing rose above ambient noise.
   */
  bigEvent?: string | null;
}

// ── Template banks ──────────────────────────────────────────────────────────
//
// Variants are grouped by the dominant signal in the night.  Each opens
// with a quiet anchoring line (the cosmos surveying), then optionally
// names the big event.  Length capped at ~200 chars so the Home banner
// stays one line at desktop widths.

/**
 * Templates used when no matches were played overnight AND no big event
 * was logged.  These are the quietest mornings — fans open the page to
 * find the cosmos has been thinking, but says little.
 */
const QUIET_NIGHT_TEMPLATES: readonly string[] = [
  'Daybreak. The cosmos counted the hours and found them ordinary.',
  'Morning. Nothing changed. The cosmos waits.',
  'Daybreak. The void was quiet. The void is often quiet before it isn\'t.',
  'A morning without weight. The scales are level. For now.',
  'Daybreak. No new threads were spun. Old threads continue.',
  'The cosmos surveys an unchanged board. Daybreak.',
];

/**
 * Templates used when matches were played overnight but no single event
 * dominated.  Plural-aware: `{N}` is substituted with the integer count.
 */
const MATCH_NIGHT_TEMPLATES: readonly string[] = [
  'Daybreak. {N} matches resolved overnight. The standings shifted, gently.',
  'Morning. {N} fixtures completed. The cosmos took notes.',
  'Daybreak. The cosmos watched {N} matches close out and recorded each.',
  '{N} matches. None of them surprising enough to name. Daybreak.',
];

/**
 * Templates used when a "big event" was flagged.  `{EVENT}` is substituted
 * verbatim with the pre-redacted label from DaybreakContext.bigEvent.
 * The cosmos states the event tersely and lets the fans absorb it.
 */
const BIG_EVENT_TEMPLATES: readonly string[] = [
  'Daybreak. Overnight: {EVENT}. The cosmos noted it. The cosmos always notes.',
  'Morning. {EVENT} happened. Some are still reading the omens.',
  'The cosmos surveys the day. {EVENT}. Daybreak.',
  'Daybreak. {EVENT} reshaped the night. The standings will reckon with it later.',
];

/**
 * Templates used when all three cosmic voices spoke overnight — a noisy
 * night the digest must acknowledge.  Rare; uses a separate bank so
 * fans recognise the tone shift.
 */
const TRIPLE_VOICE_TEMPLATES: readonly string[] = [
  'Daybreak. All three voices spoke overnight. The cosmos is paying close attention.',
  'A loud night. All three voices were heard. The cosmos rarely speaks together.',
  'Daybreak. The cosmos was busy. All three voices weighed in. Something is shifting.',
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pick a random element from a non-empty pool with the supplied RNG.
 * Local-only — kept inline to match the single-file duplication contract
 * with the Deno edge function copy.
 */
function pick<T>(pool: readonly T[], rng: () => number): T {
  // pool guaranteed non-empty by every callsite in this file.
  return pool[Math.floor(rng() * pool.length)]!;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Synthesize a single daybreak digest summary from the overnight context.
 *
 * Selection rules (highest priority first):
 *   1. All three voices spoke → TRIPLE_VOICE_TEMPLATES.
 *   2. A `bigEvent` label is provided → BIG_EVENT_TEMPLATES.
 *   3. At least one match played → MATCH_NIGHT_TEMPLATES.
 *   4. Otherwise → QUIET_NIGHT_TEMPLATES.
 *
 * The first matching rule wins.  Template substitution:
 *   `{N}`     → context.matchesPlayed (decimal integer)
 *   `{EVENT}` → context.bigEvent (raw string; caller pre-redacts scores/numbers)
 *
 * @param ctx  Overnight context bundle, see DaybreakContext.
 * @param rng  Random source for variant selection.  Default Math.random.
 * @returns    Final summary string ready for `INSERT INTO narratives`.
 */
export function buildDaybreakDigest(
  ctx: DaybreakContext,
  rng: () => number = Math.random,
): string {
  const tripleVoice =
    ctx.voicesSpoke.fate && ctx.voicesSpoke.balance && ctx.voicesSpoke.chaos;

  if (tripleVoice) return pick(TRIPLE_VOICE_TEMPLATES, rng);

  if (ctx.bigEvent) {
    return pick(BIG_EVENT_TEMPLATES, rng).replace('{EVENT}', ctx.bigEvent);
  }

  if (ctx.matchesPlayed > 0) {
    return pick(MATCH_NIGHT_TEMPLATES, rng).replace('{N}', String(ctx.matchesPlayed));
  }

  return pick(QUIET_NIGHT_TEMPLATES, rng);
}

/**
 * Returns true iff the current UTC hour falls within the daybreak window.
 * The galaxy-tick cron uses this to gate the digest generation so it only
 * fires during morning ticks, not throughout the day.
 *
 * @param date  Default = `new Date()`.  Override for tests.
 */
export function isDaybreakWindow(date: Date = new Date()): boolean {
  const hour = date.getUTCHours();
  return hour >= DAYBREAK_WINDOW_START_HOUR_UTC && hour < DAYBREAK_WINDOW_END_HOUR_UTC;
}
