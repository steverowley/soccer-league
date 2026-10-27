// ── About.tsx ───────────────────────────────────────────────────────────────
// `/about` route: the "what is this?" page for cold visitors arriving from
// social shares, search engines, or the footer. Sits alongside Privacy and
// Terms as the legal/marketing surface required for public launch.
//
// The vision rules out exposing simulation mechanics, but this page can name
// the *cast* and explain the *ritual* in plain English without breaking the
// pillar: the goal is to lower the bar for a stranger to understand why
// they'd come back tomorrow.
//
// On the design language since group 5a (docs/design-language.md), with no
// raw style values: the shared Prose pieces (src/shared/ui/Prose.tsx), one
// prose style for About, Privacy and Terms. Body type at the reading
// measure, sections numbered from I with SectionHeader (the h2s).

import { PageHeader, PageShell, Paragraph, Prose, ProseSection } from '../shared/ui';
import { usePageTitle } from '../shared/hooks/usePageTitle';

export default function About() {
  usePageTitle('About');
  return (
    <PageShell>
      <PageHeader
        eyebrow="About"
        title="What is the Intergalactic Soccer League?"
        subtitle="A Blaseball-inspired social experiment browser game. Thirty-two clubs across four orbital leagues, played out as AI-simulated matches you watch, bet on, and shape by collective vote."
      />

      <Prose>
        <ProseSection index="I" title="The loop">
          <Paragraph>
            Sign up, receive <strong>200 Intergalactic Credits</strong>, and pick a favourite
            club and player. Matches unfold in real time, paced like a wire-service
            broadcast: three commentators argue the play while the Cosmic Architect
            occasionally rewrites a rule mid-half. Bet credits on outcomes. Win, lose,
            survive.
          </Paragraph>
          <Paragraph>
            At season&apos;s end, fans of each club pool their credits and vote on two focuses
            (one major, one minor) that actually reshape the team for next season.
            The cosmos enacts what you collectively choose, then writes journalist
            takes about whether it worked.
          </Paragraph>
        </ProseSection>

        <ProseSection index="II" title="The cast">
          <Paragraph>
            <strong>Vox / Nexus-7 / Zara</strong>: the booth, three commentators with
            distinct voices arguing the run of play.
          </Paragraph>
          <Paragraph>
            <strong>The Cosmic Architect</strong>: the haunted thing in the rafters.
            Sometimes it speaks. Sometimes it changes the rules. You will not be told
            when.
          </Paragraph>
          <Paragraph>
            <strong>Balance &amp; Chaos</strong>: two cosmic voices weighing the
            equilibrium of every match. They speak softly. They are usually right.
          </Paragraph>
          <Paragraph>
            <strong>Pundits, journalists, bookies, referees</strong>: the supporting
            ecosystem. They post takes in the Galaxy Dispatch feed between matches.
          </Paragraph>
        </ProseSection>

        <ProseSection index="III" title="The non-goals">
          <Paragraph>
            No real-money gambling: credits are in-game only. No direct messaging
            between players. No mobile apps yet. No surface that exposes raw player
            statistics; the world is treated like real life.
          </Paragraph>
        </ProseSection>

        <ProseSection index="IV" title="Status">
          <Paragraph>
            Pre-launch. Open development. The roadmap is public; the source is on
            GitHub. Bugs and feedback welcome via the (forthcoming) in-app widget.
          </Paragraph>
        </ProseSection>
      </Prose>
    </PageShell>
  );
}
