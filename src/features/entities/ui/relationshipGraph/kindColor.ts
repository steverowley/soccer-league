// ── features/entities/ui/relationshipGraph/kindColor.ts ─────────────────────
// Maps an entity `kind` to a node-fill colour from the design-system palette
// (`COLORS` in src/components/Layout.tsx).
//
// WHY THESE MAPPINGS
//   The relationship graph is the most "people-soup" surface in the app — a
//   single render can show players, journalists, pundits, referees, and
//   political bodies all at once.  Coding each kind to a palette token (no
//   raw hex) keeps the legend mentally tractable:
//
//     player        → DUST          (the canonical "subject" colour)
//     manager       → ASTRO         (decision-makers, secondary focus colour)
//     referee       → TERRA NOVA    (officiating = positive/neutral authority)
//     pundit        → QUANTUM       (commentary = primary focus)
//     commentator   → QUANTUM       (same family as pundits)
//     journalist    → ASTRO         (writers — hot orange like managers)
//     media_company → QUANTUM       (publishing institution)
//     association   → TERRA NOVA    (governing body — neutral authority)
//     bookie        → FLARE         (the only red-coded kind — risk/markets)
//     political_body→ FLARE         (authority that can disrupt the league)
//     team          → ASTRO         (clubs — secondary-focus identity tier)
//     planet        → DUST 70       (places — quieter than people)
//     colony        → DUST 50       (places — quietest tier)
//     <everything else (coach/physio/doctor/scout/owner/analyst)>
//                   → DUST 70       (support entities — visible but muted)
//
// The seed node ignores this mapping — it always renders in DUST (full
// opacity) regardless of kind so it stays visually anchored.

import { COLORS } from '../../../../components/Layout';

/**
 * Resolve an entity-kind string into a node-fill colour drawn from the ISL
 * palette.  Falls back to `DUST 70` for any kind not in the explicit map so
 * future kinds (added in later migrations) render visibly without a code
 * change — a defensive default that costs nothing.
 *
 * @param kind  The `entities.kind` value (free-text but typed as EntityKind
 *              in the app).  Pass an empty string to get the fallback colour.
 * @returns     A hex/rgba string from `COLORS`.  Never returns null.
 */
export function kindColor(kind: string): string {
  switch (kind) {
    // ── People (warm or focus-coloured) ─────────────────────────────────
    case 'player':         return COLORS.dust;
    case 'manager':        return COLORS.astro;
    case 'journalist':     return COLORS.astro;
    case 'pundit':         return COLORS.quantum;
    case 'commentator':    return COLORS.quantum;
    case 'referee':        return COLORS.terraNova;

    // ── Institutions ────────────────────────────────────────────────────
    case 'media_company':  return COLORS.quantum;
    case 'association':    return COLORS.terraNova;
    case 'bookie':         return COLORS.flare;
    case 'political_body': return COLORS.flare;

    // ── Clubs (shadow team entities, isl-3ov) ───────────────────────────
    // Astro orange picks up the secondary-focus / momentum hue so a
    // team node reads as "another active node in the universe" — a
    // distinct identity from the pundit/commentator quantum tier and
    // the bookie/political flare tier.  Click resolution lives in
    // entityRoute → /teams/:team_id.
    case 'team':           return COLORS.astro;

    // ── Places (muted) ──────────────────────────────────────────────────
    case 'planet':         return COLORS.dust70;
    case 'colony':         return COLORS.dust50;

    // ── Default: support entities + future kinds ────────────────────────
    // Returning the same colour as "places" is deliberate — both tiers
    // are "background context" in a relationship graph and don't earn
    // their own legend slot.
    default:               return COLORS.dust70;
  }
}
