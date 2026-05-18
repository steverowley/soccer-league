// ── Layout.jsx ──────────────────────────────────────────────────────────────
// Shared page chrome extracted from Home.jsx when the second page (Leagues)
// legitimately needed the same primitives — matches the rule called out in
// Home.jsx's file header.
//
// Exports:
//   - COLORS              palette object (the three brand tokens + tints)
//   - Container           fixed-max-width content wrapper
//   - SectionHeader       editorial kicker + title + subtitle + action header
//   - Footer              site-wide hairline footer
//   - PrimaryButton       dark Abyss + dust border CTA
//   - FlareCTA            flare-filled attention CTA
//   - DustButton          dust-filled CTA used inside cards
//
// PALETTE (seven semantic tokens, matches the Figma design system):
//   LUNAR DUST     #E3E0D5  — primary light: text on dark, default borders,
//                              button-secondary fill
//   GALACTIC ABYSS #111111  — primary dark: page bg, btn-primary fill
//   PHOBOS ASH     #1F1F1F  — secondary dark: layered surfaces (cards on
//                              cards, modal-on-dark)
//   QUANTUM PURPLE #9A5CF4  — focus colour: PRIMARY CTAs, live indicators,
//                              Architect, every "attention" highlight
//   SOLAR FLARE    #FF4F5E  — ERROR ONLY: validation failures, losses,
//                              relegation, cosmic disturbances
//   TERRA NOVA     #A5D6A7  — confirmation: "Saved" toasts, positive P&L,
//                              successful stat bumps
//   ASTRO EXPLORER #FF6637  — secondary focus: hot-streak / momentum cues
//                              that aren't errors
//
// PR 12 corrected the original 3-token assumption — the rebuild used
// Solar Flare for both errors AND focus highlights, which conflated
// two distinct semantic roles.

import { Link } from 'react-router-dom';

// ── Palette tokens ──────────────────────────────────────────────────────────
// Seven semantic tokens + four computed dust tints, frozen so a stray
// `COLORS.flare = '#000'` somewhere downstream fails loud in dev.
//
// SEMANTIC ASSIGNMENT (do NOT reuse a token across roles):
//   - `quantum` is THE focus colour for every primary CTA + live cue +
//     Architect highlight.  If a button wants attention, it's quantum.
//   - `flare` is ERROR-ONLY.  Reserved for validation failures, losses,
//     relegation cues, and cosmic-disturbance narratives.  A primary CTA
//     painted flare reads as "danger / red alert" — wrong signal.
//   - `terraNova` is the confirmation colour: positive P&L, "Saved"
//     toasts, successful stat-bump flashes.
//   - `astro` is a secondary focus accent for hot-streak / momentum
//     surfaces that aren't error-coded (e.g. Hot Movers strip).
//   - `phobosAsh` is the layered-surface fill — slightly lighter than
//     abyss so a card-on-card stack reads as depth without losing the
//     mono-dark canvas.
export const COLORS = Object.freeze({
  // ── Primary surfaces ──────────────────────────────────────────────
  dust:       '#E3E0D5', // Lunar Dust     — text on dark, button-secondary fill
  abyss:      '#111111', // Galactic Abyss — page bg, btn-primary fill
  phobosAsh:  '#1F1F1F', // Phobos Ash     — secondary dark / layered surfaces

  // ── Semantic accents ──────────────────────────────────────────────
  quantum:    '#9A5CF4', // Quantum Purple — focus / primary CTA / Architect
  flare:      '#FF4F5E', // Solar Flare    — ERROR ONLY
  terraNova:  '#A5D6A7', // Terra Nova     — confirmation / success
  astro:      '#FF6637', // Astro Explorer — secondary focus / momentum

  // ── Computed dust tints ───────────────────────────────────────────
  // Alpha overlays of Lunar Dust.  Used for hairlines, sub-text,
  // disabled / placeholder copy, and faint card-fill states.
  hairline:   'rgba(227, 224, 213, 0.18)',
  dust50:     'rgba(227, 224, 213, 0.50)',
  dust70:     'rgba(227, 224, 213, 0.70)',
  dustFaint:  'rgba(227, 224, 213, 0.12)',
});

/**
 * Fixed-max-width content container — centres children at 1248 px.
 * Outer <section> still owns padding; this only constrains width.
 *
 * @param {{ children: React.ReactNode }} props
 */
export function Container({ children }) {
  return (
    <div style={{ maxWidth: 1248, margin: '0 auto', width: '100%' }}>
      {children}
    </div>
  );
}

/**
 * Editorial section header.
 *
 * Structure (top to bottom):
 *   1. PAGE_KICKER       — optional tiny mono tag (e.g. "TABLES")
 *   2. KICKER ROW        — "II • THE PRESENT" small-caps
 *   3. TITLE             — big display heading
 *   4. SUBTITLE + ACTION — subtitle prose + right-aligned ► action
 *   5. HAIRLINE          — divider that anchors the header
 *
 * @param {object} props
 * @param {string} [props.pageKicker]   Optional page-level kicker above the row.
 * @param {string} props.kicker         Roman numeral / index (e.g. "II").
 * @param {string} [props.label]        Two-part kicker label after the bullet.
 * @param {string} props.title          Display heading.
 * @param {string} [props.subtitle]     Subtitle prose under the title.
 * @param {string} [props.actionLabel]  Optional ► action label.
 * @param {string} [props.actionTo]     Required when actionLabel is set.
 */
export function SectionHeader({
  pageKicker,
  kicker,
  label,
  title,
  subtitle,
  actionLabel,
  actionTo,
}) {
  return (
    <header>
      {pageKicker && (
        <div style={{
          fontSize: 13,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.18em',
          color: COLORS.dust,
          marginBottom: 32,
        }}>
          {pageKicker}
        </div>
      )}

      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        fontSize: 13,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.18em',
        color: COLORS.dust70,
      }}>
        <span>{kicker}</span>
        <span style={{ color: COLORS.dust50 }}>•</span>
        {label && <span>{label}</span>}
      </div>

      <h2 style={{
        fontSize: 40,
        fontWeight: 700,
        textTransform: 'uppercase',
        lineHeight: 1.1,
        margin: '16px 0 0',
        letterSpacing: '0.02em',
      }}>
        {title}
      </h2>

      {(subtitle || actionLabel) && (
        <div style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 24,
          marginTop: 16,
        }}>
          {subtitle ? (
            <p style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: COLORS.dust70,
              margin: 0,
              maxWidth: '52ch',
            }}>
              {subtitle}
            </p>
          ) : <span />}
          {actionLabel && actionTo && (
            <Link
              to={actionTo}
              style={{
                fontSize: 13,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.14em',
                color: COLORS.dust,
                textDecoration: 'none',
                flexShrink: 0,
              }}
            >
              {actionLabel} ►
            </Link>
          )}
        </div>
      )}

      <hr style={{
        border: 0,
        height: 1,
        background: COLORS.hairline,
        margin: '24px 0 0',
      }} />
    </header>
  );
}

/**
 * Site-wide footer.  Single hairline + tracked small-caps band.  Build
 * version is a literal because the value is rendered for editorial flavour,
 * not for diagnostics.
 */
export function Footer() {
  return (
    <footer style={{
      borderTop: `1px solid ${COLORS.hairline}`,
      padding: '32px',
      textAlign: 'center',
      fontSize: 11,
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
      color: COLORS.dust50,
    }}>
      <span>Intergalactic Soccer League</span>
      <span style={{ margin: '0 12px', opacity: 0.5 }}>•</span>
      <span>Charted from Earth Orbit</span>
      <span style={{ margin: '0 12px', opacity: 0.5 }}>•</span>
      <span>v 0.7.0</span>
    </footer>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

/**
 * Primary CTA — dark Abyss fill, 1 px dust border, dust text.
 * App-wide standard "secondary entry path" button.
 *
 * @param {{ to: string, children: React.ReactNode }} props
 */
export function PrimaryButton({ to, children }) {
  return (
    <Link
      to={to}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 13,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: COLORS.dust,
        background: COLORS.abyss,
        border: `1px solid ${COLORS.dust}`,
        padding: '14px 28px',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Link>
  );
}

/**
 * Focus CTA — Quantum Purple fill, dust text, purple border.  THE
 * primary-attention button across the entire app: Sign Up, Watch Live,
 * Cast Vote, Place Wager, Click for XP, Log In, Save Allegiance.
 *
 * Renamed from `FlareCTA` in PR 12 once the actual design palette was
 * surfaced — Solar Flare is the ERROR colour, not the focus colour.
 * The old name + flare fill collapsed two distinct semantic roles into
 * one visual cue; using Quantum Purple here keeps Solar Flare reserved
 * for genuine error states (validation, losses, cosmic disturbances).
 *
 * @param {{ to: string, children: React.ReactNode }} props
 */
export function FocusCTA({ to, children }) {
  return (
    <Link
      to={to}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 13,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: COLORS.dust,
        background: COLORS.quantum,
        border: `1px solid ${COLORS.quantum}`,
        padding: '14px 28px',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Link>
  );
}

/**
 * Shield silhouette placeholder for a club crest.  Drawn with
 * clip-path so the colour is fully data-driven and there is no asset
 * swap when team.color changes.  56 × 64 px reads at score-row scale
 * without dominating the row.
 *
 * Two tint stops baked off the brand colour:
 *   - fill: hex + '33' alpha (faint wash, ≈ 20 %)
 *   - edge: hex + 'AA' alpha (medium border, ≈ 67 %)
 * Null colour falls back to neutral dust so a missing brand value
 * paints a placeholder shield rather than an invisible one.
 *
 * Extracted into Layout.jsx in PR 11 when MatchDetail duplicated the
 * Home-page primitive verbatim — crossed the "extract on 2nd use"
 * threshold the Home.jsx file header sets up.
 *
 * @param {{ color: string | null }} props
 */
export function TeamCrest({ color }) {
  const tint = color ? `${color}33` : 'rgba(227,224,213,0.10)';
  const edge = color ? `${color}AA` : 'rgba(227,224,213,0.30)';
  return (
    <div
      aria-hidden="true"
      style={{
        width: 56,
        height: 64,
        background: tint,
        border: `1px solid ${edge}`,
        clipPath: 'polygon(0 0, 100% 0, 100% 65%, 50% 100%, 0 65%)',
        flexShrink: 0,
      }}
    />
  );
}

/**
 * Tiny back-to-listing link used at the top of every detail page above
 * its SectionHeader.  Mono small-caps cue with a ◄ glyph so the
 * direction is obvious at a glance.  Extracted in PR 6 once the third
 * detail surface (MatchDetail) duplicated it from LeagueDetail and
 * TeamDetail.
 *
 * @param {{ to: string, children: React.ReactNode }} props
 */
export function BackLink({ to, children }) {
  return (
    <Link
      to={to}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: COLORS.dust70,
        textDecoration: 'none',
      }}
    >
      <span aria-hidden="true">◄</span>
      <span>{children}</span>
    </Link>
  );
}

/**
 * Dust-filled CTA — dust fill, abyss text.  Used inside cards where the
 * surrounding panel is already Abyss and a third dark-outline button
 * would lose contrast.
 *
 * @param {{ to: string, children: React.ReactNode }} props
 */
export function DustButton({ to, children }) {
  return (
    <Link
      to={to}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 13,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: COLORS.abyss,
        background: COLORS.dust,
        border: `1px solid ${COLORS.dust}`,
        padding: '14px 28px',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        alignSelf: 'flex-start',
      }}
    >
      {children}
    </Link>
  );
}
