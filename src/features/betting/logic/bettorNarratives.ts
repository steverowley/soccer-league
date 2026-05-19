// ── betting/logic/bettorNarratives.ts ────────────────────────────────────────
// Pure logic for generating anonymized bettor narrative text from a settled
// wager batch.  No React, no Supabase, no I/O.  100% unit-testable.
//
// DESIGN INTENT (Phase 4 — bettor narratives)
// ─────────────────────────────────────────────
// After every wager settlement batch, a short narrative is written to the
// `narratives` table (kind='wager_narrative') and surfaces in the Galaxy
// Dispatch news feed.  Rules:
//
//   - NEVER name users.  "A fan", "several fans", "a faction of the crowd" — always
//     collective or anonymous.  Individual identities are invisible; only the
//     aggregate pattern matters.
//
//   - TAGGED with a cosmic voice.  The voice that "noted" the pattern:
//       Chaos   — upsets, disasters, all-in losses, chaos (most common)
//       Balance — close finishes, near-symmetry in win/loss counts
//       (Fate/Architect rarely notes betting; it concerns itself with larger arcs)
//
//   - AGGREGATE PATTERNS detected and surfaced.  Interesting patterns:
//       mass_loss     — most bettors on the wrong side
//       upset_win     — underdog bettors triumph (implied by high odds win)
//       clean_sweep   — all bettors won or all lost
//       big_win       — single payout ≥ 500 IC
//       all_in        — stake that was the max seen in the batch
//       heavy_action  — large total stake volume (≥ 1000 IC)
//       equilibrium   — close to 50/50 win/loss split
//
// The output is a 1–2 sentence string in the appropriate cosmic voice register.
// Template banks follow the same philosophy as cosmicVoices.ts — hand-written
// for voice consistency, not LLM-generated.
// ──────────────────────────────────────────────────────────────────────────────

// ── Narrative voice constants ─────────────────────────────────────────────────

/**
 * The cosmic voice that authored this narrative.
 * Matches the voiceIndex convention in cosmicVoices.ts:
 *   2 = Balance, 3 = Chaos.
 * '1' (Fate) is intentionally excluded — the Architect doesn't audit ledgers.
 */
export type NarrativeVoice = 2 | 3;

// ── Settlement batch shape ─────────────────────────────────────────────────────

/**
 * Aggregate statistics computed from a single settlement batch.
 * Passed to narrative generation functions.
 *
 * All user-identifying fields are absent — only anonymous aggregate counts.
 */
export interface SettlementBatch {
  /** Total wagers in the batch. */
  totalWagers: number;
  /** Number of wagers that won. */
  wonsCount: number;
  /** Number of wagers that lost. */
  lostCount: number;
  /** Sum of all stakes in IC. */
  totalStaked: number;
  /** Sum of all payouts credited to winners. */
  totalPayout: number;
  /** The single highest payout in the batch (0 if no winners). */
  maxPayout: number;
  /** The single largest stake in the batch. */
  maxStake: number;
  /** Highest odds snapshot in the batch (proxy for "upset" detection). */
  maxOdds: number;
  /** The outcome that resolved the match: 'home' | 'away' | 'draw'. */
  outcome: 'home' | 'away' | 'draw';
  /** Short human-readable team names for narrative flavour (optional). */
  homeTeamName?: string;
  awayTeamName?: string;
}

// ── Pattern detection ─────────────────────────────────────────────────────────

/**
 * Detected interesting pattern for narrative selection.
 * Multiple patterns can apply; the most dramatic one wins (see pickPattern()).
 */
type BettingPattern =
  | 'clean_sweep_win'   // every bettor won
  | 'clean_sweep_loss'  // every bettor lost
  | 'upset_win'         // high-odds win (underdog triumph)
  | 'mass_loss'         // most bettors lost (≥ 70%)
  | 'big_win'           // single payout ≥ BIG_WIN_THRESHOLD IC
  | 'heavy_action'      // large total stake ≥ HEAVY_ACTION_THRESHOLD IC
  | 'equilibrium'       // win/loss split within EQUILIBRIUM_DELTA %
  | 'default';          // fallback

// ── Thresholds ────────────────────────────────────────────────────────────────

/**
 * Minimum payout to qualify as a "big win" and trigger that template.
 * 500 IC = ~2.5× the minimum stake at 2.0 odds — a meaningful win but not
 * so high that the pattern never fires.
 */
const BIG_WIN_THRESHOLD = 500;

/**
 * Total-stake threshold for "heavy action" pattern.
 * 1000 IC across all bettors signals a well-wagered match.
 */
const HEAVY_ACTION_THRESHOLD = 1000;

/**
 * Maximum absolute difference between win% and 50% for "equilibrium" pattern.
 * ±10 percentage points of 50/50 feels cosmically balanced.
 */
const EQUILIBRIUM_DELTA = 0.10;

/**
 * Minimum odds snapshot to qualify the winning side as an "upset".
 * 2.5 = the payout was at least 2.5× the stake, implying the winner was an
 * underdog at placement time.
 */
const UPSET_ODDS_THRESHOLD = 2.5;

/**
 * Minimum percentage of losers to qualify as "mass loss".
 * 0.70 = 70% of bettors on the wrong side.
 */
const MASS_LOSS_THRESHOLD = 0.70;

// ── Pattern detection function ────────────────────────────────────────────────

/**
 * Detect the most dramatic betting pattern in a settlement batch.
 *
 * Pattern priority (highest drama wins):
 *   1. clean_sweep_win / clean_sweep_loss — unanimous outcome, rarest
 *   2. upset_win — high-odds winner against the consensus
 *   3. big_win — dramatic single payout
 *   4. clean_sweep_loss (if not already covered)
 *   5. mass_loss — most people wrong
 *   6. equilibrium — cosmically balanced split
 *   7. heavy_action — just a lot of action, nothing dramatic
 *   8. default — small or unremarkable batch
 *
 * @param batch  Settlement statistics.
 * @returns      The most dramatic applicable pattern.
 */
export function detectPattern(batch: SettlementBatch): BettingPattern {
  const { totalWagers, wonsCount, lostCount, maxPayout, totalStaked, maxOdds } = batch;
  if (totalWagers === 0) return 'default';

  const winRate = wonsCount / totalWagers;

  if (wonsCount === totalWagers)                         return 'clean_sweep_win';
  if (lostCount === totalWagers)                         return 'clean_sweep_loss';
  if (maxOdds >= UPSET_ODDS_THRESHOLD && wonsCount > 0) return 'upset_win';
  if (maxPayout >= BIG_WIN_THRESHOLD)                    return 'big_win';
  if (winRate <= (1 - MASS_LOSS_THRESHOLD))              return 'mass_loss';
  if (Math.abs(winRate - 0.5) <= EQUILIBRIUM_DELTA)      return 'equilibrium';
  if (totalStaked >= HEAVY_ACTION_THRESHOLD)             return 'heavy_action';
  return 'default';
}

// ── Voice assignment ──────────────────────────────────────────────────────────

/**
 * Assign the cosmic voice most likely to have noted this pattern.
 *
 * CHAOS (voiceIndex 3) — speaks when things went spectacularly wrong or
 *   when an improbable upset delights the void.  Upsets, mass losses,
 *   clean sweeps (especially complete losses) are Chaos's territory.
 *
 * BALANCE (voiceIndex 2) — speaks when the ledger is almost even, or when
 *   the total action is heavy enough that the cosmos wants equilibrium
 *   acknowledged.  Equilibrium, big wins (because large swings need noting),
 *   and heavy-action patterns lean toward Balance.
 *
 * @param pattern  The detected betting pattern.
 * @returns        Voice index (2=Balance, 3=Chaos).
 */
export function pickNarrativeVoice(pattern: BettingPattern): NarrativeVoice {
  switch (pattern) {
    case 'clean_sweep_loss':
    case 'upset_win':
    case 'mass_loss':
      return 3; // Chaos delights in collective failure and improbable outcomes

    case 'equilibrium':
    case 'big_win':
    case 'heavy_action':
      return 2; // Balance notes symmetry, large swings, and high-volume ledgers

    case 'clean_sweep_win':
      return 3; // Consensus victories bore Balance; Chaos is delighted by the absurdity

    default:
      return 3; // Default to Chaos — it notices more than Balance does
  }
}

// ── Template banks ────────────────────────────────────────────────────────────
// Each pattern has 4-6 templates.  One is selected randomly on generation.
// Template format: a factory function receiving the batch for interpolation.
// %n = wager count, %w = winner count, %l = loser count, %s = stake count

type TemplateFn = (b: SettlementBatch) => string;

const TEMPLATES: Record<BettingPattern, TemplateFn[]> = {

  clean_sweep_win: [
    b => `Every mortal who staked on this match emerged richer. ${b.totalWagers === 1 ? 'One bet.' : `${b.totalWagers} bets.`} All won. Chaos finds this insufficient.`,
    b => `The consensus was correct. ${b.totalWagers} fan${b.totalWagers !== 1 ? 's' : ''} wagered; ${b.totalWagers} fan${b.totalWagers !== 1 ? 's' : ''} collected. The cosmos shrugs.`,
    // Unused-param prefix because this template is interpolation-free flavour
    // text — the narrator chose not to cite a number.  Kept as a function for
    // bank-shape consistency rather than mixed string/fn arrays.
    _b => `A clean ledger. All who bet, won. The void notes this without enthusiasm — unanimity is the least interesting outcome.`,
  ],

  clean_sweep_loss: [
    b => `${b.totalWagers} mortal${b.totalWagers !== 1 ? 's' : ''} staked on this match. ${b.totalWagers === 1 ? 'One lost.' : 'All lost.'} The cosmos noted this without grief.`,
    b => `Every credit wagered on this match was consumed. ${b.totalWagers} bet${b.totalWagers !== 1 ? 's' : ''}. Zero survived. Chaos is pleased.`,
    _b => `The match concluded. Those who bet on it left with nothing. All of them. The pattern was unanimous, if nothing else.`,
    b => `${b.totalStaked} Intergalactic Credits entered the void through wagers on this fixture. None returned.`,
  ],

  upset_win: [
    _b => `A faction of the crowd defied the consensus and won. The odds were against them — the cosmos was not.`,
    `The expected thing did not happen. Fan${'' /* avoid "fans" vs "fan" complexity */} who read the signs correctly walked away richer. Chaos is delighted.`,
    `Against the numbers, against the logic of it — the underdog's backers collected. The void finds this amusing.`,
    b => `The ${b.awayTeamName ?? 'away side'} was not supposed to do that. Those who believed they would are now wealthier for the faith.`,
  ] as TemplateFn[],

  big_win: [
    b => `A single payout of ${b.maxPayout} Intergalactic Credits was registered. The cosmos noticed the transfer.`,
    b => `Someone wagered and walked away with ${b.maxPayout} IC. Balance watches large sums change hands with care.`,
    `A significant credit transfer occurred through the betting ledger. The equilibrium was briefly disturbed. It will settle.`,
    b => `${b.maxPayout} credits moved from the cosmos to a mortal's account. The ledger is noted.`,
  ] as TemplateFn[],

  mass_loss: [
    b => `${b.lostCount} of ${b.totalWagers} fans who staked on this match chose incorrectly. The majority was wrong. Chaos found this efficient.`,
    b => `Most who bet, lost. The consensus called it. The result disagreed. ${b.totalStaked - b.totalPayout} credits remain unrecovered.`,
    `The crowd leaned one way. The match went the other. The void noted the gap between expectation and truth.`,
    b => `${Math.round((b.lostCount / b.totalWagers) * 100)}% of bettors on this match are poorer for it. The cosmos does not apologize.`,
  ] as TemplateFn[],

  equilibrium: [
    b => `${b.wonsCount} fan${b.wonsCount !== 1 ? 's' : ''} won; ${b.lostCount} lost. The ledger is nearly even. Balance acknowledges this.`,
    `The wagers on this match resolved close to symmetry. Almost as many won as lost. The cosmos appreciates the balance, however brief.`,
    b => `Win count: ${b.wonsCount}. Loss count: ${b.lostCount}. The difference is small. Balance is satisfied.`,
    `A near-even split in the betting ledger. The cosmos notes equilibrium when it finds it — which is rarely.`,
  ] as TemplateFn[],

  heavy_action: [
    b => `${b.totalStaked} Intergalactic Credits were wagered on this match. It drew the crowd's attention, at least financially.`,
    b => `Significant betting volume on this fixture — ${b.totalWagers} wager${b.totalWagers !== 1 ? 's' : ''} totalling ${b.totalStaked} IC. The cosmos monitors large concentrations of mortal faith.`,
    `A heavily bet match. The credits moved; the void observed. Most patterns resolve to win or loss — the volume itself is the note.`,
  ] as TemplateFn[],

  default: [
    b => `${b.totalWagers} wager${b.totalWagers !== 1 ? 's' : ''} on this match settled. The credits moved. The cosmos blinked.`,
    `A small batch of wagers resolved. Wins and losses distributed. The ledger updates.`,
    `The match concluded. Those who bet on it know their outcome. The cosmos has filed the note.`,
  ] as TemplateFn[],
};

// ── Narrative assembly ────────────────────────────────────────────────────────

/**
 * Generate an anonymized bettor narrative string from a settlement batch.
 *
 * Selects the most dramatic pattern, then picks a random template from that
 * pattern's bank and interpolates the batch statistics.
 *
 * @param batch  Settlement statistics.
 * @param rng    Optional random function for testability.
 * @returns      1–2 sentence narrative string ready to write to `narratives.summary`.
 */
export function buildSettlementNarrative(
  batch: SettlementBatch,
  rng: () => number = Math.random,
): string {
  if (batch.totalWagers === 0) return '';
  const pattern   = detectPattern(batch);
  // Defensive fallback to TEMPLATES.default — guarantees a non-empty bank
  // even if a future BettingPattern value is added without a matching key.
  const templates = TEMPLATES[pattern] ?? TEMPLATES.default;
  // `templates` is guaranteed non-empty by construction; the indexed access
  // could still resolve to `undefined` under TypeScript's noUncheckedIndexedAccess,
  // so we coerce to the first entry as a guaranteed-defined fallback.
  const template  = templates[Math.floor(rng() * templates.length)] ?? templates[0];
  if (!template) return '';
  return typeof template === 'function' ? template(batch) : template;
}

// ── Batch construction helper ─────────────────────────────────────────────────

/**
 * Minimal wager shape needed to build a SettlementBatch.
 * Callers supply only what they already have from the wagers query result.
 */
export interface SettledWager {
  status: 'won' | 'lost' | 'void';
  stake: number;
  /** Null for lost wagers; positive integer for won wagers. */
  payout: number | null;
  odds_snapshot: number;
}

/**
 * Build a SettlementBatch aggregate from an array of settled wager rows.
 *
 * Void wagers are excluded from all counts and sums — they are neither wins
 * nor losses and carry no narrative weight.
 *
 * @param wagers       Settled wager rows for the match.
 * @param outcome      The match outcome that resolved the wagers.
 * @param homeTeamName Optional — for narrative flavour text.
 * @param awayTeamName Optional — for narrative flavour text.
 */
export function buildSettlementBatch(
  wagers: SettledWager[],
  outcome: SettlementBatch['outcome'],
  homeTeamName?: string,
  awayTeamName?: string,
): SettlementBatch {
  // Exclude void wagers — they refund stake and carry no narrative meaning.
  const active = wagers.filter(w => w.status !== 'void');

  // Build the batch with only the always-present numeric fields first; team
  // names are conditionally spread in afterwards.  This avoids assigning
  // `undefined` to optional string fields under TypeScript's
  // `exactOptionalPropertyTypes` setting (which treats `homeTeamName: undefined`
  // as a real value, not an absent key).
  const batch: SettlementBatch = {
    totalWagers: active.length,
    wonsCount:   active.filter(w => w.status === 'won').length,
    lostCount:   active.filter(w => w.status === 'lost').length,
    totalStaked: active.reduce((s, w) => s + w.stake, 0),
    totalPayout: active.reduce((s, w) => s + (w.payout ?? 0), 0),
    maxPayout:   Math.max(0, ...active.map(w => w.payout ?? 0)),
    maxStake:    Math.max(0, ...active.map(w => w.stake)),
    maxOdds:     Math.max(0, ...active.map(w => w.odds_snapshot)),
    outcome,
  };
  if (homeTeamName !== undefined) batch.homeTeamName = homeTeamName;
  if (awayTeamName !== undefined) batch.awayTeamName = awayTeamName;
  return batch;
}
