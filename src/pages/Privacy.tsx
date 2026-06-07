// ── Privacy.tsx ─────────────────────────────────────────────────────────────
// `/privacy` route — privacy policy required for GDPR / UK-GDPR compliance
// and for compatibility with Apple/Google policy if a webview wrapper is ever
// shipped. Plain English by design; legal precision is a future review pass.
//
// PATTERN: shares the inline Article/H2/P helpers with About.tsx and
// Terms.tsx. When a fourth prose page arrives, promote to src/shared/ui/.

import Header from '../components/Header';
import { COLORS, Container, Footer, SectionHeader } from '../components/Layout';
import { usePageTitle } from '../shared/hooks/usePageTitle';

const { dust: DUST, abyss: ABYSS } = COLORS;
const DUST_70 = COLORS.dust70;

/** Date the current policy text was last reviewed. Update when material text changes. */
const LAST_UPDATED = '2026-05-22';

export default function Privacy() {
  usePageTitle('Privacy');
  return (
    <div style={{
      background: ABYSS, color: DUST, minHeight: '100vh', 
    }}>
      <Header />
      <Container>
        <SectionHeader
          pageKicker="LEGAL"
          kicker="I • PRIVACY"
          title="Privacy Policy"
          subtitle={`Last updated: ${LAST_UPDATED}. The plain-English version: we store the minimum we need to run the game, we don't sell your data, and you can delete your account at any time.`}
        />

        <Article>
          <H2>What we collect</H2>
          <P>
            <strong>Account data:</strong> the email and username you provide at sign-up,
            and a hash of your password. We never store your password in plain text.
          </P>
          <P>
            <strong>Game data:</strong> your in-game credits, favourite club / player,
            wagers, training-clicker activity, votes, and aggregated last-seen
            timestamps used to grant your team a fan-support boost during matches.
          </P>
          <P>
            <strong>Diagnostic data:</strong> error reports captured automatically when
            the app crashes (so we can fix bugs). These include the page URL, a stack
            trace, and your browser version; they do not include passwords, credits, or
            personal messages.
          </P>

          <H2>What we don&apos;t collect</H2>
          <P>
            Real names, addresses, phone numbers, payment information, location, or
            anything else not listed above.
          </P>

          <H2>How we use it</H2>
          <P>
            Only to run the game and to debug it when it breaks. We don&apos;t sell your
            data, we don&apos;t run advertising, and we don&apos;t share account-level data with
            third parties.
          </P>

          <H2>Where it lives</H2>
          <P>
            Account and game data are stored in Supabase (Postgres hosted by Supabase
            Inc.). Diagnostic data, when collected, is stored by our error-tracking
            provider.
          </P>

          <H2>Your rights</H2>
          <P>
            <strong>Access:</strong> you can see most of your data on your profile page.
            For a full export, email us (address below).
          </P>
          <P>
            <strong>Correction:</strong> change your username, email, club, and player
            on your profile page.
          </P>
          <P>
            <strong>Deletion:</strong> the &quot;Delete Account&quot; control on your
            profile page (forthcoming) wipes your auth row, anonymises any historical
            wagers/votes (so league history stays consistent), and removes you from
            public leaderboards within minutes.
          </P>

          <H2>Cookies and local storage</H2>
          <P>
            We use localStorage and a single auth session cookie to keep you signed in.
            We do not use third-party tracking cookies.
          </P>

          <H2>Children</H2>
          <P>
            The site simulates betting (with fictional in-game credits). It is intended
            for users aged 18 or older; sign-up requires self-attestation.
          </P>

          <H2>Contact</H2>
          <P>
            Questions or data requests: open an issue at{' '}
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
// Mirrored from About.tsx — one consumer in each of three legal pages.

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
