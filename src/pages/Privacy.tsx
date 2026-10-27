// ── Privacy.tsx ─────────────────────────────────────────────────────────────
// `/privacy` route: privacy policy required for GDPR / UK-GDPR compliance
// and for compatibility with Apple/Google policy if a webview wrapper is ever
// shipped. Plain English by design; legal precision is a future review pass.
//
// On the design language since group 5a (docs/design-language.md), with no
// raw style values: the shared Prose pieces (src/shared/ui/Prose.tsx), one
// prose style for About, Privacy and Terms. Body type at the reading
// measure, sections numbered from I with SectionHeader (the h2s).

import { PageHeader, PageShell, Paragraph, Prose, ProseSection, TextLink } from '../shared/ui';
import { usePageTitle } from '../shared/hooks/usePageTitle';

/** Date the current policy text was last reviewed. Update when material text changes. */
const LAST_UPDATED = '2026-05-22';

export default function Privacy() {
  usePageTitle('Privacy');
  return (
    <PageShell>
      <PageHeader
        eyebrow="Legal"
        title="Privacy Policy"
        subtitle={`Last updated: ${LAST_UPDATED}. The plain-English version: we store the minimum we need to run the game, we don't sell your data, and you can delete your account at any time.`}
      />

      <Prose>
        <ProseSection index="I" title="What we collect">
          <Paragraph>
            <strong>Account data:</strong> the email and username you provide at sign-up,
            and a hash of your password. We never store your password in plain text.
          </Paragraph>
          <Paragraph>
            <strong>Game data:</strong> your in-game credits, favourite club / player,
            wagers, training-clicker activity, votes, and aggregated last-seen
            timestamps used to grant your team a fan-support boost during matches.
          </Paragraph>
          <Paragraph>
            <strong>Diagnostic data:</strong> error reports captured automatically when
            the app crashes (so we can fix bugs). These include the page URL, a stack
            trace, and your browser version; they do not include passwords, credits, or
            personal messages.
          </Paragraph>
        </ProseSection>

        <ProseSection index="II" title="What we don't collect">
          <Paragraph>
            Real names, addresses, phone numbers, payment information, location, or
            anything else not listed above.
          </Paragraph>
        </ProseSection>

        <ProseSection index="III" title="How we use it">
          <Paragraph>
            Only to run the game and to debug it when it breaks. We don&apos;t sell your
            data, we don&apos;t run advertising, and we don&apos;t share account-level data with
            third parties.
          </Paragraph>
        </ProseSection>

        <ProseSection index="IV" title="Where it lives">
          <Paragraph>
            Account and game data are stored in Supabase (Postgres hosted by Supabase
            Inc.). Diagnostic data, when collected, is stored by our error-tracking
            provider.
          </Paragraph>
        </ProseSection>

        <ProseSection index="V" title="Your rights">
          <Paragraph>
            <strong>Access:</strong> you can see most of your data on your profile page.
            For a full export, email us (address below).
          </Paragraph>
          <Paragraph>
            <strong>Correction:</strong> change your username, email, club, and player
            on your profile page.
          </Paragraph>
          <Paragraph>
            <strong>Deletion:</strong> the &quot;Delete Account&quot; control on your
            profile page wipes your auth row, anonymises any historical
            wagers/votes (so league history stays consistent), and removes you from
            public leaderboards within minutes.
          </Paragraph>
        </ProseSection>

        <ProseSection index="VI" title="Cookies and local storage">
          <Paragraph>
            We use localStorage and a single auth session cookie to keep you signed in.
            We do not use third-party tracking cookies.
          </Paragraph>
        </ProseSection>

        <ProseSection index="VII" title="Children">
          <Paragraph>
            The site simulates betting (with fictional in-game credits). It is intended
            for users aged 18 or older; sign-up requires self-attestation.
          </Paragraph>
        </ProseSection>

        <ProseSection index="VIII" title="Contact">
          <Paragraph>
            Questions or data requests: open an issue at{' '}
            <TextLink newTab href="https://github.com/steverowley/soccer-league/issues">
              github.com/steverowley/soccer-league/issues
            </TextLink>.
          </Paragraph>
        </ProseSection>
      </Prose>
    </PageShell>
  );
}
