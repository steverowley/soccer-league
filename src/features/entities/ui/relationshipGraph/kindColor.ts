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
//     player               → DUST          (the canonical "subject" colour)
//     manager              → ASTRO         (decision-makers, secondary focus)
//     managing_staff       → ASTRO         (club staff — same warm tier as managers)
//     referee              → TERRA NOVA    (officiating = positive/neutral authority)
//     pundit               → QUANTUM       (commentary = primary focus)
//     commentator          → QUANTUM       (same family as pundits)
//     journalist           → ASTRO         (writers — hot orange like managers)
//     sports_writer        → ASTRO         (column writers — same tier as journalists)
//     media_company        → QUANTUM       (publishing institution)
//     social_media         → QUANTUM       (platform entity — same media family)
//     association          → TERRA NOVA    (governing body — neutral authority)
//     officials_association→ TERRA NOVA    (officials' governing body — same tier)
//     bookie               → FLARE         (risk/markets — only truly red kind)
//     political_body       → FLARE         (authority that can disrupt the league)
//     political_party      → FLARE         (political institution — disruption tier)
//     politician           → FLARE         (political actor — same disruption tier)
//     team                 → ASTRO         (clubs — secondary-focus identity tier)
//     planet               → DUST 70       (places — quieter than people)
//     colony               → DUST 50       (places — quietest tier)
//     stadium              → DUST 70       (venue — background context, like a place)
//     training_facility    → DUST 50       (venue — quieter than a stadium)
//     <everything else (coach/physio/doctor/scout/owner/analyst)>
//                          → DUST 70       (support entities — visible but muted)
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
    // ── Players — the canonical "subject" kind ───────────────────────────
    // DUST is the ISL's neutral foreground: legible on dark backgrounds and
    // distinct from every other tier without screaming for attention.
    case 'player':               return COLORS.dust;

    // ── Club-adjacent people (warm ASTRO tier) ───────────────────────────
    // Managers, coaching/support staff, journalists, and sports writers all
    // orbit the clubs.  ASTRO orange signals "warm, active, club-world" and
    // groups them visually without making them indistinguishable from teams.
    case 'manager':              return COLORS.astro;
    case 'managing_staff':       return COLORS.astro;
    case 'journalist':           return COLORS.astro;
    case 'sports_writer':        return COLORS.astro;

    // ── Commentary & media family (QUANTUM tier) ─────────────────────────
    // Pundits, commentators, media companies, and social-media platforms are
    // all "voices" rather than actors.  QUANTUM groups the entire media layer
    // so a viewer can instantly identify "this node talks, it doesn't play".
    case 'pundit':               return COLORS.quantum;
    case 'commentator':          return COLORS.quantum;
    case 'media_company':        return COLORS.quantum;
    case 'social_media':         return COLORS.quantum;

    // ── Officiating & governance (TERRA NOVA tier) ───────────────────────
    // Referees, the officials' association, and general governing bodies
    // enforce rules rather than disrupt them — a positive-neutral authority.
    // TERRA NOVA (teal/green) codes as "institutional trust", distinct from
    // the red FLARE tier that signals disruption.
    case 'referee':              return COLORS.terraNova;
    case 'association':          return COLORS.terraNova;
    case 'officials_association':return COLORS.terraNova;

    // ── Risk & disruption (FLARE tier — red) ────────────────────────────
    // Bookies, political bodies, political parties, and politicians are the
    // only kinds coded red.  Red in the ISL palette = "this node can
    // interfere with the league's natural order."  Bookies through markets,
    // politicians through legislation/decree, parties through collective power.
    case 'bookie':               return COLORS.flare;
    case 'political_body':       return COLORS.flare;
    case 'political_party':      return COLORS.flare;
    case 'politician':           return COLORS.flare;

    // ── Clubs (shadow team entities) ─────────────────────────────────────
    // ASTRO orange gives clubs the same warm identity as their people-tier
    // counterparts (managers, staff) while keeping them visually distinct
    // from the DUST (players) and QUANTUM (media) tiers.  Click resolution
    // lives in entityRoute → /teams/:team_id.
    case 'team':                 return COLORS.astro;

    // ── Places: planets, colonies, venues ───────────────────────────────
    // Physical locations are "background context" — they situate other nodes
    // rather than acting themselves.  Stadiums read like planets (DUST 70);
    // training facilities and colonies use DUST 50 for the quietest tier.
    case 'planet':               return COLORS.dust70;
    case 'stadium':              return COLORS.dust70;
    case 'colony':               return COLORS.dust50;
    case 'training_facility':    return COLORS.dust50;

    // ── Default: support entities + future kinds ─────────────────────────
    // Returning DUST 70 for unrecognised kinds is intentional — new entity
    // kinds added in future migrations render visibly without a code change.
    // "Background context" is always the safe default for an unknown node.
    default:                     return COLORS.dust70;
  }
}
