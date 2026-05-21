// ── Roadmap.tsx ─────────────────────────────────────────────────────────────
// `/roadmap` route — visual project-management dashboard for the team.
//
// WHY this page exists:
//   Product/design ideas were getting lost across chats, Notion, and the
//   `bd` engineering tracker.  /roadmap gives a single visual at-a-glance
//   home for ideas → planned → in-progress → shipped.  The page itself is
//   intentionally thin — it's a Header + Container + intro + the
//   `RoadmapBoard` feature component + Footer.
//
// AUTH STATES:
//   * anonymous     → read-only board, no admin chrome.
//   * non-admin     → read-only board, no admin chrome.
//   * admin         → full create / edit / delete / reprioritise controls.
//
// The page does not gate access — that would defeat the "everyone can see
// the roadmap" intent.  The board itself renders different chrome based on
// the auth state.

import Header from '../components/Header';
import { COLORS, Container, Footer, SectionHeader } from '../components/Layout';
import { RoadmapBoard } from '../features/roadmap';

/**
 * Render the /roadmap page.  Page chrome is identical to the other live
 * pages (Voting, Training, etc.): Header on top, SectionHeader intro,
 * the feature component in the middle, Footer on the bottom.
 *
 * @returns The full page tree.
 */
export default function Roadmap() {
  return (
    <div style={{ background: COLORS.abyss, minHeight: '100vh', color: COLORS.dust }}>
      <Header />
      <main>
        <Container>
          <section style={{ padding: '32px 0' }}>
            <SectionHeader
              pageKicker="ROADMAP"
              kicker="0"
              label="THE NEXT FRONTIER"
              title="What's brewing in the league"
              subtitle="A curator-tended board of ideas, planned work, and shipped milestones. New ideas land in the leftmost column; the team moves cards right as work progresses. Public-read by design — players are welcome to see what's coming."
            />
          </section>

          <section style={{ padding: '8px 0 48px' }}>
            <RoadmapBoard />
          </section>
        </Container>
      </main>
      <Footer />
    </div>
  );
}
