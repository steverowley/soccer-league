// ── Layout.tsx ──────────────────────────────────────────────────────────────
// Site chrome shared by every page: the content Container and the Footer.
//
// Exports:
//   - Container   max-width content wrapper on the layout tokens
//   - Footer      site-wide footer (2 px rule, badge, legal links)
//
// On the design language since group 5a (docs/design-language.md), with no
// raw style values (scripts/designTokens.test.ts). The old page primitives
// that used to live here (SectionHeader, PrimaryButton, FocusCTA, DustButton,
// TeamCrest, BackLink) are gone: their last users moved to src/shared/ui
// (SectionHeader, Button, Crest, BackLink). The deprecated `COLORS` palette
// went with the design system's last group, when its final importers (the
// admin panels, What if, the match viewer and the mini pitch) moved to the
// `color` tokens. Nothing imports from this file except PageShell (Footer)
// and the route fallback skeleton (Container).

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { color, glyph, layout, space, tone, type } from '../shared/design';

/**
 * Fixed-max-width content container: centres children at the design
 * language's container width with its gutter (`--isl-container` and
 * `--isl-gutter` from src/shared/design/tokens.css: 1248 px, padding 24 px,
 * 16 px on a phone). PageShell uses the same two, so every page shares one
 * left edge.
 */
export function Container({ children }: { children: ReactNode }) {
  return (
    <div style={{ maxWidth: layout.container, margin: '0 auto', width: '100%', paddingLeft: layout.gutter, paddingRight: layout.gutter, boxSizing: 'border-box' }}>
      {children}
    </div>
  );
}

/** Middot separator between footer items (decorative). */
function Dot() {
  return (
    <span aria-hidden="true" style={{ ...tone.tertiary, marginLeft: space[12], marginRight: space[12] }}>
      {glyph.middot}
    </span>
  );
}

/**
 * Site-wide footer. The ISL badge over the 2 px rule (the one place the
 * design system draws a 2 px line, in `rule-strong`), then the brand line in
 * the label token and the legal links. Legal links (About, Privacy, Terms)
 * live here rather than in the header so the main nav stays on gameplay.
 *
 * Type: everything is the `label` token (11 px, uppercase, 0.12em). The
 * links were raised to 12 px in #722 for legibility; they now sit on the
 * label token (the floor of the scale) and gain their legibility from
 * contrast instead: the default text tone (14.3:1) where the old 70% dust
 * gave 6.4:1. Each link carries its own vertical padding so the tap target
 * is 44 px tall.
 */
export function Footer() {
  return (
    <footer
      style={{
        borderTop: `2px solid ${color.ruleStrong}`,
        paddingTop: space[32],
        paddingBottom: space[32],
        paddingLeft: layout.gutter,
        paddingRight: layout.gutter,
        textAlign: 'center',
        ...type.label,
        ...tone.secondary,
      }}
    >
      {/* Brand badge: leads the footer, centred above the text rows. */}
      <img
        src={`${import.meta.env.BASE_URL}isl-logo.svg`}
        alt="Intergalactic Soccer League"
        style={{ height: 40, width: 'auto', display: 'block', margin: `0 auto ${space[16]}px` }}
      />
      {/* Row 1: brand, tagline, version. */}
      <div>
        <span>Intergalactic Soccer League</span>
        <Dot />
        <span>Charted from Earth Orbit</span>
        <Dot />
        <span>v 0.7.0</span>
      </div>
      {/* Row 2: legal links, each padded to a 44 px tap target. */}
      <nav aria-label="Legal" style={{ marginTop: space[4] }}>
        <FooterLink to="/about">About</FooterLink>
        <Dot />
        <FooterLink to="/privacy">Privacy</FooterLink>
        <Dot />
        <FooterLink to="/terms">Terms</FooterLink>
      </nav>
    </footer>
  );
}

/** Footer-only link: label type in the default tone, padded to a 44 px tap target. */
function FooterLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      style={{
        ...tone.primary,
        textDecoration: 'none',
        display: 'inline-block',
        paddingTop: 15,
        paddingBottom: 15,
        paddingLeft: space[4],
        paddingRight: space[4],
      }}
    >
      {children}
    </Link>
  );
}
