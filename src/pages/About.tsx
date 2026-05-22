// ── About.tsx ───────────────────────────────────────────────────────────────
// `/about` route — the "what is this?" page for cold visitors arriving from
// social shares, search engines, or the footer. Sits alongside Privacy and
// Terms as the legal/marketing surface required for public launch.
//
// The vision rules out exposing simulation mechanics, but this page can name
// the *cast* and explain the *ritual* in plain English without breaking the
// pillar — the goal is to lower the bar for a stranger to understand why
// they'd come back tomorrow.

import Header from '../components/Header';
import { COLORS, Container, Footer, SectionHeader } from '../components/Layout';
import { usePageTitle } from '../shared/hooks/usePageTitle';

const { dust: DUST, abyss: ABYSS } = COLORS;
const DUST_70 = COLORS.dust70;

export default function About() {
  usePageTitle('About');
  return (
    <div style={{
      background: ABYSS, color: DUST, minHeight: '100vh', fontFamily: 'Space Mono, monospace',
    }}>
      <Header />
      <Container>
        <SectionHeader
          pageKicker="ABOUT"
          kicker="I • THE PREMISE"
          title="What is the Intergalactic Soccer League?"
          subtitle="A Blaseball-inspired social experiment browser game. Thirty-two clubs across four orbital leagues, played out as AI-simulated matches you watch, bet on, and shape by collective vote."
        />

        <Article>
          <H2>The loop</H2>
          <P>
            Sign up, receive <strong>200 Intergalactic Credits</strong>, and pick a favourite
            club and player. Matches unfold in real time, paced like a wire-service
            broadcast — three commentators argue the play while the Cosmic Architect
            occasionally rewrites a rule mid-half. Bet credits on outcomes. Win, lose,
            survive.
          </P>
          <P>
            At season's end, fans of each club pool their credits and vote on two focuses
            — one major, one minor — that actually reshape the team for next season.
            The cosmos enacts what you collectively choose, then writes journalist
            takes about whether it worked.
          </P>

          <H2>The cast</H2>
          <P>
            <strong>Vox / Nexus-7 / Zara</strong> — the booth, three commentators with
            distinct voices arguing the run of play.
          </P>
          <P>
            <strong>The Cosmic Architect</strong> — the haunted thing in the rafters.
            Sometimes it speaks. Sometimes it changes the rules. You will not be told
            when.
          </P>
          <P>
            <strong>Balance &amp; Chaos</strong> — two cosmic voices weighing the
            equilibrium of every match. They speak softly. They are usually right.
          </P>
          <P>
            <strong>Pundits, journalists, bookies, referees</strong> — the supporting
            ecosystem. They post takes in the Galaxy Dispatch feed between matches.
          </P>

          <H2>The non-goals</H2>
          <P>
            No real-money gambling — credits are in-game only. No direct messaging
            between players. No mobile apps yet. No surface that exposes raw player
            statistics; the world is treated like real life.
          </P>

          <H2>Status</H2>
          <P>
            Pre-launch. Open development. The roadmap is public; the source is on
            GitHub. Bugs and feedback welcome via the (forthcoming) in-app widget.
          </P>
        </Article>
      </Container>
      <Footer />
    </div>
  );
}

// ── Local presentational helpers ────────────────────────────────────────────
// These three primitives only have one consumer (About / Privacy / Terms),
// so they live here as inline helpers. If a fourth long-form prose page
// arrives, promote them to src/shared/ui/ — see roadmap #378.

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
