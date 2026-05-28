// ── Terms.tsx ───────────────────────────────────────────────────────────────
// `/terms` route — terms of service required for public launch. Defines
// acceptable use, account termination, intellectual property, and
// no-warranty. Plain-English first pass; a lawyer review is a follow-up.
//
// PATTERN: shares the inline Article/H2/P/A helpers with About.tsx and
// Privacy.tsx. Promote to src/shared/ui/ on the fourth consumer.

import Header from '../components/Header';
import { COLORS, Container, Footer, SectionHeader } from '../components/Layout';
import { usePageTitle } from '../shared/hooks/usePageTitle';

const { dust: DUST, abyss: ABYSS } = COLORS;
const DUST_70 = COLORS.dust70;

/** Date the current terms text was last reviewed. Update when material text changes. */
const LAST_UPDATED = '2026-05-22';

export default function Terms() {
  usePageTitle('Terms');
  return (
    <div style={{
      background: ABYSS, color: DUST, minHeight: '100vh', fontFamily: 'Space Mono, monospace',
    }}>
      <Header />
      <Container>
        <SectionHeader
          pageKicker="LEGAL"
          kicker="I • TERMS"
          title="Terms of Service"
          subtitle={`Last updated: ${LAST_UPDATED}. The plain-English version: have fun, don't impersonate or abuse other users, don't try to break the site, and understand that this is an experiment that can change without notice.`}
        />

        <Article>
          <H2>What this is</H2>
          <P>
            The Intergalactic Soccer League (&quot;ISL&quot;, the &quot;Service&quot;) is
            a free browser game with simulated matches, in-game credits, and collective
            voting. By creating an account or using the Service, you agree to these
            terms.
          </P>

          <H2>Eligibility</H2>
          <P>
            You must be at least 18 years old to use the Service. The game contains
            simulated betting; we don&apos;t want to normalise gambling for minors even
            though no real money is involved. Sign-up requires self-attestation.
          </P>

          <H2>Account</H2>
          <P>
            You&apos;re responsible for keeping your password safe and for everything that
            happens on your account. Pick a username that isn&apos;t impersonation, isn&apos;t
            a slur, and isn&apos;t a reserved word (admin, architect, cosmic, etc.).
          </P>

          <H2>Acceptable use</H2>
          <P>
            Don&apos;t try to abuse, harass, or impersonate other users. Don&apos;t try to
            exploit bugs to manipulate balances, bets, votes, or leaderboards. Don&apos;t
            scrape the Service, automate gameplay, or run multiple accounts to
            inflate fan-support boosts or vote weight.
          </P>

          <H2>In-game credits</H2>
          <P>
            Intergalactic Credits have no real-world value. They cannot be purchased,
            withdrawn, exchanged for currency, or transferred to other users. Account
            balances may be reset, devalued, or wiped at any time as part of a
            season, an Architect intervention, or a system migration.
          </P>

          <H2>Content and intellectual property</H2>
          <P>
            The Service code is open source under the licence in the repository.
            Generated narrative content (commentary, journalist takes, Architect
            whispers) is produced by AI models against the project&apos;s prompts; we
            don&apos;t claim author copyright on individual generations. Club names,
            crests, and editorial copy are part of the project&apos;s design system.
          </P>

          <H2>Termination</H2>
          <P>
            You can delete your account at any time from the profile page. We may
            suspend or terminate accounts that violate these terms.
          </P>

          <H2>No warranty</H2>
          <P>
            The Service is provided &quot;as is&quot; without warranty of any kind.
            We do our best, but the Service may break, change, or disappear without
            notice — it&apos;s an experiment.
          </P>

          <H2>Changes to these terms</H2>
          <P>
            We may update these terms; material changes will be announced in the
            Galaxy Dispatch feed at least 7 days before they take effect.
          </P>

          <H2>Contact</H2>
          <P>
            Questions: open an issue at{' '}
            <A href="https://github.com/steverowley/soccer-league/issues">
              github.com/steverowley/soccer-league/issues
            </A>.
          </P>
        </Article>
      </Container>
      <Footer />
    </div>
  );
}

// ── Local presentational helpers ────────────────────────────────────────────
// Mirrored from About.tsx / Privacy.tsx. Three legal pages share these.

function Article({ children }: { children: React.ReactNode }) {
  return (
    <article style={{
      maxWidth: 720, margin: '32px auto 96px', fontSize: 15, lineHeight: 1.7,
      color: DUST_70,
    }}>
      {children}
    </article>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      marginTop: 40, marginBottom: 12, fontSize: 13, letterSpacing: '0.18em',
      textTransform: 'uppercase', color: DUST,
    }}>
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: '0 0 16px' }}>{children}</p>;
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{
      color: DUST, textDecoration: 'underline', textDecorationColor: COLORS.dust50,
    }}>
      {children}
    </a>
  );
}
