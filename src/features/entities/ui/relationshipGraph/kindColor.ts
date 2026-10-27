// ── features/entities/ui/relationshipGraph/kindColor.ts ─────────────────────
// Maps an entity `kind` to the way the relationship graph (and the World
// atlas) draws it: a TIER, a glyph SHAPE and a token colour.
//
// WHY SHAPES, NOT COLOURS
//   The design language (docs/design-language.md, section 4) gives every
//   accent exactly one job: red means live or went wrong, purple means the
//   Cosmic Architect and the cosmic voices, orange is the one primary action
//   on a view, green is a good outcome. None of those is "a kind of entity",
//   so the old palette (orange managers and journalists, purple media, red
//   politicians and bookies, green referees) said things it did not mean.
//   Tiers are now told apart by shape and the three text tones:
//
//     tier         kinds                                         glyph     tone
//     player       player                                        circle    text
//     club         team (the club's shadow entity)               shield    club colour (Crest)
//     staff        manager, managing_staff                       square    text
//     media        pundit, commentator, journalist,              diamond   secondary
//                  sports_writer, media_company, social_media
//     officials    referee, association, officials_association   triangle  secondary
//     politics     politician, political_party, political_body,  inverted  secondary
//                  bookie                                        triangle
//     place        planet, colony, stadium, training_facility    ring      tertiary
//     cosmic       cosmic_voice (Fate, Balance, Chaos)           circle    architect
//     other        any future kind                               circle    tertiary
//
//   The only accent left is `architect` on the cosmic voices, which is
//   exactly the job the spec gives it. Club colour appears only on a club's
//   own shield, as everywhere else on the site.
//
// The seed node ignores the tone (it always renders in the text tone with a
// ring) so it stays visually anchored.

import { color } from '../../../../shared/design';

/** The visual tiers of the entity graph (see the table above). */
export type KindTier =
  | 'player'
  | 'club'
  | 'staff'
  | 'media'
  | 'officials'
  | 'politics'
  | 'place'
  | 'cosmic'
  | 'other';

/** The glyph a tier is drawn with. */
export type KindShape = 'circle' | 'shield' | 'square' | 'diamond' | 'triangle' | 'triangleDown' | 'ring';

/**
 * Resolve an entity kind to its tier. Unknown (future) kinds fall into
 * `other`, which draws as a quiet circle, so a new kind added by a later
 * migration renders visibly without a code change.
 *
 * @param kind  The `entities.kind` value; an empty string gives `other`.
 * @returns     The tier.
 */
export function kindTier(kind: string): KindTier {
  switch (kind) {
    case 'player':
      return 'player';
    case 'team':
      return 'club';
    case 'manager':
    case 'managing_staff':
      return 'staff';
    case 'pundit':
    case 'commentator':
    case 'journalist':
    case 'sports_writer':
    case 'media_company':
    case 'social_media':
      return 'media';
    case 'referee':
    case 'association':
    case 'officials_association':
      return 'officials';
    case 'politician':
    case 'political_party':
    case 'political_body':
    case 'bookie':
      return 'politics';
    case 'planet':
    case 'colony':
    case 'stadium':
    case 'training_facility':
      return 'place';
    case 'cosmic_voice':
      return 'cosmic';
    default:
      return 'other';
  }
}

/** Glyph per tier. */
const SHAPE: Record<KindTier, KindShape> = {
  player: 'circle',
  club: 'shield',
  staff: 'square',
  media: 'diamond',
  officials: 'triangle',
  politics: 'triangleDown',
  place: 'ring',
  cosmic: 'circle',
  other: 'circle',
};

/** Token colour per tier (a club's shield takes the club colour instead). */
const TONE: Record<KindTier, string> = {
  player: color.text,
  club: color.textSecondary,
  staff: color.text,
  media: color.textSecondary,
  officials: color.textSecondary,
  politics: color.textSecondary,
  place: color.textTertiary,
  cosmic: color.architect,
  other: color.textTertiary,
};

/** Legend wording per tier, in the legend's order (`other` is never listed). */
export const KIND_TIER_LABEL: ReadonlyArray<readonly [KindTier, string]> = [
  ['player', 'Player'],
  ['club', 'Club'],
  ['staff', 'Staff'],
  ['media', 'Media'],
  ['officials', 'Officials'],
  ['politics', 'Politics & markets'],
  ['place', 'Place'],
  ['cosmic', 'Cosmic voice'],
];

/**
 * The glyph a tier is drawn with.
 *
 * @param tier  A tier from kindTier().
 * @returns     The shape name.
 */
export function tierShape(tier: KindTier): KindShape {
  return SHAPE[tier];
}

/**
 * The token colour a tier is drawn in.
 *
 * @param tier  A tier from kindTier().
 * @returns     A `color.*` token (a CSS `var()` reference).
 */
export function tierColor(tier: KindTier): string {
  return TONE[tier];
}

/**
 * The glyph an entity kind is drawn with.
 *
 * @param kind  The `entities.kind` value.
 * @returns     The shape name.
 */
export function kindShape(kind: string): KindShape {
  return SHAPE[kindTier(kind)];
}

/**
 * The token colour an entity kind is drawn in: one of the three text tones,
 * or `architect` for the cosmic voices. Never red, orange or green.
 *
 * @param kind  The `entities.kind` value; an empty string gives the
 *              tertiary fallback.
 * @returns     A `color.*` token (a CSS `var()` reference).
 */
export function kindColor(kind: string): string {
  return TONE[kindTier(kind)];
}
