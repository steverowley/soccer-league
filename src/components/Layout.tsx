// ── Layout.tsx ──────────────────────────────────────────────────────────────
// Shared page chrome — typed React primitives for the ISL design system.
//
// Exports:
//   - COLORS              palette object (seven semantic tokens + tints)
//   - Container           fixed-max-width content wrapper
//   - SectionHeader       editorial kicker + title + subtitle + action header
//   - Footer              site-wide hairline footer
//   - PrimaryButton       dark Abyss + dust border CTA
//   - FocusCTA            quantum-filled focus CTA
//   - TeamCrest           clip-path shield placeholder for a club crest
//   - BackLink            tiny back-to-listing link for detail pages
//   - DustButton          dust-filled CTA used inside cards
//
// PALETTE (seven semantic tokens, matches the Figma design system):
//   LUNAR DUST     #E3E0D5  — primary light: text on dark, default borders
//   GALACTIC ABYSS #111111  — primary dark: page bg, btn-primary fill
//   PHOBOS ASH     #1F1F1F  — secondary dark: layered surfaces
//   QUANTUM PURPLE #9A5CF4  — focus colour: PRIMARY CTAs, live indicators
//   SOLAR FLARE    #FF4F5E  — ERROR ONLY: losses, relegation, disturbances
//   TERRA NOVA     #A5D6A7  — confirmation: "Saved" toasts, positive P&L
//   ASTRO EXPLORER #FF6637  — secondary focus: hot-streak / momentum cues

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

// ── Palette tokens ──────────────────────────────────────────────────────────
export const COLORS = Object.freeze({
  dust:       '#E3E0D5',
  abyss:      '#111111',
  phobosAsh:  '#1F1F1F',
  quantum:    '#9A5CF4',
  flare:      '#FF4F5E',
  terraNova:  '#A5D6A7',
  astro:      '#FF6637',
  // Pure white — reserved by the design system for hard dividers (the footer
  // rule) and the logged-in nav outline. Never a fill or body-text colour.
  white:      '#FFFFFF',
  hairline:   'rgba(227, 224, 213, 0.18)',
  dust50:     'rgba(227, 224, 213, 0.50)',
  dust70:     'rgba(227, 224, 213, 0.70)',
  dustFaint:  'rgba(227, 224, 213, 0.12)',
});

/**
 * Fixed-max-width content container — centres children at 1248 px with
 * 16 px left/right padding for consistent text spacing and page alignment.
 */
export function Container({ children }: { children: ReactNode }) {
  return (
    <div style={{ maxWidth: 1248, margin: '0 auto', width: '100%', paddingLeft: 16, paddingRight: 16, boxSizing: 'border-box' }}>
      {children}
    </div>
  );
}

interface SectionHeaderProps {
  pageKicker?: string;
  kicker: string;
  label?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  actionTo?: string;
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
 */
export function SectionHeader({
  pageKicker,
  kicker,
  label,
  title,
  subtitle,
  actionLabel,
  actionTo,
}: SectionHeaderProps) {
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
 * Site-wide footer. Carries the ISL badge over a 2px white rule, then brand,
 * tagline, version, and legal links. The white top rule + centred badge are
 * the design system's canonical footer treatment (white is reserved for hard
 * dividers). Legal links (about / privacy / terms) live here rather than in
 * the header so the main nav stays focused on gameplay surfaces.
 */
export function Footer() {
  return (
    <footer style={{
      // 2px white rule — the one place the design system uses a bold white
      // divider (everywhere else dividers are 1px Lunar Dust hairlines).
      borderTop: `2px solid ${COLORS.white}`,
      padding: '32px',
      textAlign: 'center',
      fontSize: 11,
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
      color: COLORS.dust50,
    }}>
      {/* Brand badge — leads the footer, centred above the text rows. */}
      <img
        src={`${import.meta.env.BASE_URL}isl-logo.svg`}
        alt="Intergalactic Soccer League"
        style={{ height: 40, width: 'auto', display: 'block', margin: '0 auto 16px' }}
      />
      {/* Row 1: brand / tagline / version */}
      <div>
        <span>Intergalactic Soccer League</span>
        <span style={{ margin: '0 12px', opacity: 0.5 }}>•</span>
        <span>Charted from Earth Orbit</span>
        <span style={{ margin: '0 12px', opacity: 0.5 }}>•</span>
        <span>v 0.7.0</span>
      </div>
      {/* Row 2: legal links — slightly smaller, looser tracking. */}
      <div style={{ marginTop: 12, fontSize: 10, letterSpacing: '0.14em' }}>
        <FooterLink to="/about">About</FooterLink>
        <span style={{ margin: '0 10px', opacity: 0.5 }}>•</span>
        <FooterLink to="/privacy">Privacy</FooterLink>
        <span style={{ margin: '0 10px', opacity: 0.5 }}>•</span>
        <FooterLink to="/terms">Terms</FooterLink>
      </div>
    </footer>
  );
}

/** Footer-only link: inherits the small-caps treatment, gets an underline on hover. */
function FooterLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} style={{
      color: COLORS.dust50,
      textDecoration: 'none',
      borderBottom: `1px solid transparent`,
    }}>
      {children}
    </Link>
  );
}

/**
 * Primary CTA — dark Abyss fill, 1 px dust border, dust text.
 * Touch-friendly: 44px+ minimum height for WCAG AAA tap target compliance.
 */
export function PrimaryButton({ to, children }: { to: string; children: ReactNode }) {
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
        padding: '16px 28px',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        minHeight: 44,
      }}
    >
      {children}
    </Link>
  );
}

/**
 * Focus CTA — Astro Explorer (#FF6637) fill, abyss text, orange border.
 * THE loud call to action: Sign Up, Watch Live, Cast Vote, Place Wager.
 *
 * Matches the design system's "Active button": the loud action colour is
 * Astro Explorer orange, NOT Quantum Purple (purple is the focus/live colour,
 * never a button fill) and NOT Solar Flare (flare is error-only). Orange wants
 * dark text for contrast, so the label is abyss rather than dust.
 * Touch-friendly: 44px+ minimum height for WCAG AAA tap target compliance.
 */
export function FocusCTA({ to, children }: { to: string; children: ReactNode }) {
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
        background: COLORS.astro,
        border: `1px solid ${COLORS.astro}`,
        padding: '16px 28px',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        minHeight: 44,
      }}
    >
      {children}
    </Link>
  );
}

/**
 * Shield silhouette placeholder for a club crest. Drawn with clip-path
 * so the colour is fully data-driven. 56 × 64 px reads at score-row scale.
 *
 * Null colour falls back to neutral dust so a missing brand value
 * paints a placeholder shield rather than an invisible one.
 */
export function TeamCrest({ color }: { color: string | null }) {
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
 * Tiny back-to-listing link used at the top of every detail page.
 * Mono small-caps cue with a ◄ glyph so the direction is obvious.
 */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
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
 * Dust-filled CTA — dust fill, abyss text. Used inside cards where the
 * surrounding panel is already Abyss.
 * Touch-friendly: 44px+ minimum height for WCAG AAA tap target compliance.
 */
export function DustButton({ to, children }: { to: string; children: ReactNode }) {
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
        padding: '16px 28px',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        alignSelf: 'flex-start',
        minHeight: 44,
      }}
    >
      {children}
    </Link>
  );
}
