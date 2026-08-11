// ── Leagues.tsx ─────────────────────────────────────────────────────────────
// Leagues index page — second page rebuilt after the 2026-05 nuke (PR 3).
//
// Layout:
//   Header (global)
//   I.   Page hero      — kicker "Tables" + display title + intro prose
//   II.  League grid    — one card per LEAGUES entry (4 cards, 2 × 2 ≥ 900 px)
//   Footer (shared)
//
// Each card shows the league shortName badge, full name, the leading
// editorial paragraph (truncated), the top-3 club names with their
// position pipes, and a "View Full Table ►" dust link.
//
// Data sources:
//   - LEAGUES                     from src/data/leagueData
//   - fetchLeagueStandings (top-3) from src/features/match
//
// LOAD SIGNALLING
// ───────────────
// Each card's leader strip has three distinct states — loading, unavailable,
// and "no fixtures played yet" — and says which one it is. They used to share
// the pre-season placeholder, so a slow standings fetch told the reader
// "Awaiting first kick-off" about a league that had already played 14 rounds.
//
// PALETTE: mirrors Home — three brand tokens (dust / abyss / flare).
// The page uses only the shared COLORS object — no new hex literals.

import { useEffect, useState } from 'react';
import Header from '../components/Header';
import { COLORS, Container, SectionHeader, Footer } from '../components/Layout';
import { Card, Skeleton } from '../shared/ui';
import { LEAGUES } from '../data/leagueData';
import type { League } from '../data/leagueData';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { fetchLeagueStandingsResult, type LeagueStandingsRow } from '../features/match';

// ── Derived row type ─────────────────────────────────────────────────────────
// fetchLeagueStandings returns the canonical StandingsRow shape sourced from
// Supabase.  Stamping a 1-based position on each row keeps the rendered
// leader strip identical to the previous synchronous path.
type PositionedStandingsRow = LeagueStandingsRow & { position: number };

// ── Per-card load state ──────────────────────────────────────────────────────
// One league card's knowledge of its own table. The three variants are the
// three things the strip can honestly say:
//   loading     — the fetch is in flight; we know nothing yet.
//   ready       — the fetch came back; `rows` may legitimately be empty, which
//                 means the league has played no fixtures yet.
//   unavailable — the fetch rejected; we still know nothing, and must not
//                 imply the season hasn't started.
export type LeagueStandingsState =
  | { status: 'loading' }
  | { status: 'ready'; rows: PositionedStandingsRow[] }
  | { status: 'unavailable' };

// ── Local aliases for terser inline styles ──────────────────────────────────
// COLORS is the source of truth; we destructure into single-letter aliases
// so the JSX below reads close to the design spec rather than verbose
// COLORS.dust70 lookups on every line.
const { dust: DUST, abyss: ABYSS, flare: FLARE } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Card display constants ──────────────────────────────────────────────────
// CARD_TOP_N — number of leading clubs surfaced in each league card.  3
// matches the ISL competition structure (top 3 per league qualify for
// the Celestial Cup), so the card's mini-list reads as "the chase pack".
const CARD_TOP_N = 3;

// CARD_DESCRIPTION_MAX_CHARS — soft cap for the editorial paragraph
// excerpt drawn inside each card.  Long descriptions break the card
// rhythm; 320 chars ≈ 4 lines at 13 px / 1.6 line-height inside the
// card's max-width.  Truncation appends an ellipsis at the nearest
// word boundary so the cut never lands mid-word.
const CARD_DESCRIPTION_MAX_CHARS = 320;

/**
 * Leagues index page.
 *
 * Renders a 2 × 2 grid of league cards.  Standings for every league are
 * fetched in parallel from Supabase via `fetchLeagueStandings` on mount,
 * then the top CARD_TOP_N rows of each league are passed down to its
 * card.  Each card settles independently — a slow league doesn't hold up
 * the other three — and shows skeleton rows until its own fetch lands.
 *
 * The previous synchronous path (computeStandings + buildStandingsRows
 * reading from localStorage) silently surfaced stale data on any browser
 * that hadn't watched matches recently — the Supabase-backed worker
 * never writes to that cache.  This page now mirrors LeagueDetail's
 * async fetch so all standings surfaces share one source of truth.
 */
import { usePageTitle } from '../shared/hooks/usePageTitle';

export default function Leagues() {
  usePageTitle('Leagues');
  const db = useSupabase();

  // ── Per-league top-N standings state ──────────────────────────────────────
  // Keyed by league id so each card looks up its own state without
  // re-scanning the array.  Every league starts at `loading` and moves to
  // `ready` or `unavailable` on its own — see LeagueStandingsState.
  const [standingsByLeague, setStandingsByLeague] = useState<
    Record<string, LeagueStandingsState>
  >(() => Object.fromEntries(LEAGUES.map((l) => [l.id, { status: 'loading' } as LeagueStandingsState])));

  useEffect(() => {
    let cancelled = false;
    // Fire all four league fetches at once — independent network round-trips,
    // each ~1 RTT — and commit each as it lands rather than waiting on the
    // slowest. A card's skeleton clears the moment its own table arrives.
    for (const league of LEAGUES) {
      // The *Result variant is required here: supabase-js surfaces query
      // errors in the resolved value, not as a rejection, so the plain
      // `fetchLeagueStandings` would hand back `[]` and the card would
      // announce "Awaiting first kick-off" over a failed read.
      fetchLeagueStandingsResult(db, league.id)
        .then((result): LeagueStandingsState =>
          result.ok
            ? { status: 'ready', rows: result.rows.map((row, idx) => ({ ...row, position: idx + 1 })) }
            : { status: 'unavailable' },
        )
        .catch((err): LeagueStandingsState => {
          // Belt-and-braces: an unexpected throw (bad client, aborted page
          // teardown) must not leave the card spinning forever.
          console.warn(`[Leagues] standings fetch threw for ${league.id}:`, err);
          return { status: 'unavailable' };
        })
        .then((state) => {
          if (cancelled) return;
          setStandingsByLeague((prev) => ({ ...prev, [league.id]: state }));
        });
    }
    return () => { cancelled = true; };
  }, [db]);

  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
    }}>
      <Header />

      {/* Section I — Page hero. */}
      <section style={{ padding: '48px 0 16px' }}>
        <Container>
          <SectionHeader
            pageKicker="Tables"
            kicker="II"
            label="The Four Leagues"
            title="Four Conferences, Thirty-Two Clubs"
            subtitle="Rocky Inner, Gas/Ice Giants, Outer Reaches, Kuiper Belt. Each league plays a round-robin home-and-away schedule across the season. The top three from each qualify for the Celestial Cup; ranks four through six fall into the Solar Shield."
          />
        </Container>
      </section>

      {/* Section II — League grid. */}
      <section style={{ padding: '0 0 80px' }}>
        <Container>
          <div
            className="isl-leagues-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 24,
              marginTop: 24,
            }}
          >
            {LEAGUES.map((league) => (
              <LeagueCard
                key={league.id}
                league={league}
                standings={standingsByLeague[league.id] ?? { status: 'loading' }}
              />
            ))}
          </div>
        </Container>
      </section>

      <Footer />

      {/* Single breakpoint — 2-col grid collapses to 1-col under 900 px so
          cards don't squish below the readable description width. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-leagues-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

interface LeagueCardProps {
  league: League;
  /**
   * This league's standings load state, owned by the parent.  The card
   * renders one of three strips from it — skeleton rows while loading, a
   * flare-tinted note when the table couldn't be reached, or the real
   * leaders (falling back to the pre-season placeholder when the league
   * has genuinely played nothing yet).
   */
  standings: LeagueStandingsState;
}

/**
 * Single league card.
 *
 * Layout (top → bottom):
 *   1. Header row     — shortName badge + full league name
 *   2. Body prose     — truncated editorial paragraph
 *   3. Top-N strip    — top CARD_TOP_N clubs with position pipes
 *   4. Footer link    — "View Full Table ►" to /leagues/:id
 *
 * The card itself is a clickable region (`<Link>` wrapping the chrome)
 * so anywhere on the card navigates to the detail page — the footer
 * link is a redundant cue for keyboard / screen-reader users.
 *
 * Standings are passed in from the parent (Leagues) which fetched them
 * in parallel via `fetchLeagueStandings`.  This card renders whichever
 * strip its load state calls for — see LeaderStrip.
 */
function LeagueCard({ league, standings }: LeagueCardProps) {
  const excerpt = truncateAtWord(league.description ?? '', CARD_DESCRIPTION_MAX_CHARS);

  // Status note beside the strip heading. Only the two states the reader can
  // do nothing about get a label; a loaded table needs no annotation.
  const statusNote =
    standings.status === 'loading'     ? { text: 'Loading…',    tone: DUST_50 } :
    standings.status === 'unavailable' ? { text: 'Unavailable', tone: FLARE }   :
    null;

  return (
    <Card
      to={`/leagues/${league.id}`}
      padding={32}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        height: '100%',
      }}
    >
      {/* Header row — shortName badge + full name.  The badge reads as a
          publication-section tag; the full name carries the editorial
          weight beneath it. */}
      <div>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '4px 10px',
          border: `1px solid ${HAIRLINE}`,
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: DUST,
          marginBottom: 12,
        }}>
          {league.shortName}
        </div>

        <h3 style={{
          fontSize: 24,
          fontWeight: 700,
          textTransform: 'uppercase',
          lineHeight: 1.15,
          margin: 0,
          letterSpacing: '0.01em',
        }}>
          {league.name}
        </h3>
      </div>

      {/* Body prose — truncated description.  Set max-width so very wide
          card widths (e.g. 1248 / 2 = 624 px) don't stretch the line
          length past the comfortable reading range. */}
      <p style={{
        fontSize: 13,
        lineHeight: 1.6,
        color: DUST_70,
        margin: 0,
        maxWidth: '54ch',
      }}>
        {excerpt}
      </p>

      {/* Top-N strip — leaders preview.  No table chrome — these rows are
          a teaser, not a substitute for the full table on the detail
          page.  Every state fills CARD_TOP_N row slots so the card height
          stays stable across leagues and across the load. */}
      <div style={{
        borderTop: `1px solid ${HAIRLINE}`,
        paddingTop: 16,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: DUST_70,
          marginBottom: 12,
        }}>
          <span>Current Leaders</span>
          {statusNote && <span style={{ color: statusNote.tone }}>{statusNote.text}</span>}
        </div>

        <ol
          aria-busy={standings.status === 'loading'}
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <LeaderStrip standings={standings} />
        </ol>
      </div>

      {/* Footer link — redundant for sighted users (whole card is clickable)
          but explicit for keyboard / screen-reader navigation. */}
      <div style={{
        marginTop: 'auto',
        paddingTop: 8,
        fontSize: 13,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: DUST,
      }}>
        View Full Table ►
      </div>
    </Card>
  );
}

/**
 * The contents of one card's leader strip, chosen by load state.  Split out
 * of LeagueCard so each state is a flat early return rather than a nest of
 * ternaries inside JSX — the point of this component is that the four cases
 * stay readable and mutually exclusive.
 *
 * Cases:
 *   loading     → CARD_TOP_N skeleton rows (the honest "we don't know yet")
 *   unavailable → one flare-tinted row; the reader can retry by reloading
 *   ready, []   → pre-season placeholders ("Awaiting first kick-off")
 *   ready, rows → the real top CARD_TOP_N leaders
 *
 * Exported for tests (the page itself needs auth + router + Supabase
 * providers to mount; the strip is the part with the branching).
 *
 * @param standings  This league's load state.
 * @returns          The `<li>` children of the card's leader `<ol>`.
 */
export function LeaderStrip({ standings }: { standings: LeagueStandingsState }) {
  if (standings.status === 'loading') {
    return (
      <>
        {Array.from({ length: CARD_TOP_N }, (_, i) => (
          <SkeletonLeaderRow key={i} position={i + 1} />
        ))}
      </>
    );
  }

  if (standings.status === 'unavailable') {
    return <UnavailableLeaderRow />;
  }

  if (standings.rows.length === 0) {
    return (
      <>
        {Array.from({ length: CARD_TOP_N }, (_, i) => (
          <PlaceholderLeaderRow key={i} position={i + 1} />
        ))}
      </>
    );
  }

  return (
    <>
      {standings.rows.slice(0, CARD_TOP_N).map((row) => (
        <LeaderRow key={row.id} row={row} />
      ))}
    </>
  );
}

interface LeaderRowProps {
  // position is stamped on by the parent fetch effect; all other fields
  // come directly from fetchLeagueStandings so the shape stays in sync
  // automatically with the canonical Supabase-sourced standings row.
  row: PositionedStandingsRow;
}

/**
 * Single leader row inside a league card.
 *
 * Three columns: position numeral (dust qualification pipe), team name
 * (bold), and points (mono numeric, right-aligned).  Plays the same
 * visual chord as a single row of the full standings table without the
 * surrounding chrome.
 */
function LeaderRow({ row }: LeaderRowProps) {
  const pos = row.position ?? 0;
  const points = row.points ?? 0;
  return (
    <li style={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      alignItems: 'center',
      gap: 12,
      fontSize: 13,
    }}>
      {/* Pipe + position numeral — always dust (these are the leaders,
          so the relegation flare variant never applies here). */}
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontWeight: 700,
        color: DUST,
      }}>
        <span aria-hidden="true" style={{ color: DUST }}>|</span>
        <span>{String(pos).padStart(2, '0')}</span>
      </span>

      <span style={{ fontWeight: 700, color: DUST }}>
        {row.team ?? '—'}
      </span>

      <span style={{
        fontWeight: 700,
        color: DUST,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {points} pts
      </span>
    </li>
  );
}

interface PlaceholderLeaderRowProps {
  position: number;
}

/**
 * Pre-season placeholder row.  Mirrors the LeaderRow layout but with
 * em-dash glyphs so the card height stays stable before any fixtures
 * have been simulated.  The position numeral is real (rendered with
 * faint-pipe colour) so the row still reads as "slot one / two / three".
 */
function PlaceholderLeaderRow({ position }: PlaceholderLeaderRowProps) {
  return (
    <li style={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      alignItems: 'center',
      gap: 12,
      fontSize: 13,
      color: DUST_50,
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
        <span aria-hidden="true" style={{ opacity: 0.4 }}>|</span>
        <span>{String(position).padStart(2, '0')}</span>
      </span>
      <span style={{ fontStyle: 'italic' }}>Awaiting first kick-off</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>— pts</span>
    </li>
  );
}

/**
 * Loading row.  Keeps the real position numeral (so the strip still reads as
 * "slot one / two / three") and replaces the club name and points with dust-
 * faint blocks.  Same three-column grid as LeaderRow, so nothing shifts
 * sideways when the table lands.
 *
 * Deliberately NOT the em-dash placeholder: "Awaiting first kick-off" is a
 * claim about the season, and during a fetch we have no basis for it.
 */
function SkeletonLeaderRow({ position }: { position: number }) {
  return (
    <li style={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      alignItems: 'center',
      gap: 12,
      fontSize: 13,
      color: DUST_50,
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
        <span aria-hidden="true" style={{ opacity: 0.4 }}>|</span>
        <span>{String(position).padStart(2, '0')}</span>
      </span>
      {/* Club-name band, narrowing down the strip so three stacked rows read
          as a list of names rather than a solid block. */}
      <Skeleton height={13} width={`${72 - position * 8}%`} />
      <Skeleton height={13} width={48} />
    </li>
  );
}

/**
 * Fetch-failed row.  Says the table couldn't be reached, in flare, and points
 * at the one recovery the reader has.  A retry button would have to live
 * inside the card's <Link>, which nests an interactive control in an anchor —
 * so the reload cue is text, and the card still navigates to the full table
 * (which does its own fetch and may well succeed).
 */
function UnavailableLeaderRow() {
  return (
    <li style={{
      fontSize: 13,
      lineHeight: 1.5,
      color: FLARE,
      fontStyle: 'italic',
    }}>
      The table could not be reached. Reload to try again.
    </li>
  );
}

/**
 * Truncate a string at the nearest word boundary at or before `limit`.
 * Returns the original string unchanged when shorter than the limit.
 * The ellipsis is a single Unicode glyph (…) rather than three dots so
 * it occupies exactly one character cell in the truncated output.
 *
 * Edge cases:
 *   - empty / null / undefined → returns ''
 *   - no whitespace before `limit` → returns the hard-truncated slice + …
 *     (rare; only fires on pathological inputs like 320-char single words)
 */
function truncateAtWord(text: string, limit: number): string {
  if (!text) return '';
  if (text.length <= limit) return text;
  const sliced = text.slice(0, limit);
  const lastSpace = sliced.lastIndexOf(' ');
  const cut = lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced;
  return `${cut}…`;
}
