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
// PALETTE (strict 3-colour app-wide; mirrors Header.jsx):
//   DUST   #E3E0D5  — text on dark, default borders, button-secondary fill
//   ABYSS  #111111  — page background, button-primary fill
//   FLARE  #FF4F5E  — auth CTA + every "attention" highlight in the design

import { Link } from 'react-router-dom';

// ── Palette tokens ──────────────────────────────────────────────────────────
// Three brand tokens + four computed dust tints.  Frozen so a stray
// `COLORS.flare = '#000'` somewhere downstream fails loud in dev.
export const COLORS = Object.freeze({
  dust:      '#E3E0D5',
  abyss:     '#111111',
  flare:     '#FF4F5E',
  hairline:  'rgba(227, 224, 213, 0.18)',
  dust50:    'rgba(227, 224, 213, 0.50)',
  dust70:    'rgba(227, 224, 213, 0.70)',
  dustFaint: 'rgba(227, 224, 213, 0.12)',
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
 * Solar Flare CTA — flare fill, dust text, flare border.
 * THE attention button across the entire app.
 *
 * @param {{ to: string, children: React.ReactNode }} props
 */
export function FlareCTA({ to, children }) {
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
        background: COLORS.flare,
        border: `1px solid ${COLORS.flare}`,
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
