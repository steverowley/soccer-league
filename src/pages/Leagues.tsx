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
//   - LEAGUES, TEAMS_BY_LEAGUE   from src/data/leagueData
//   - computeStandings (top-3)   from src/lib/matchResultsService
//
// PALETTE: mirrors Home — three brand tokens (dust / abyss / flare).
// The page uses only the shared COLORS object — no new hex literals.

import { useEffect, useState } from 'react';
import Header from '../components/Header';
import { COLORS, Container, SectionHeader, Footer } from '../components/Layout';
import { Card } from '../shared/ui';
import { LEAGUES } from '../data/leagueData';
import type { League } from '../data/leagueData';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { fetchLeagueStandings, type LeagueStandingsRow } from '../features/match';

// ── Derived row type ─────────────────────────────────────────────────────────
// fetchLeagueStandings returns the canonical StandingsRow shape sourced from
// Supabase.  Stamping a 1-based position on each row keeps the rendered
// leader strip identical to the previous synchronous path.
type PositionedStandingsRow = LeagueStandingsRow & { position: number };

// ── Local aliases for terser inline styles ──────────────────────────────────
// COLORS is the source of truth; we destructure into single-letter aliases
// so the JSX below reads close to the design spec rather than verbose
// COLORS.dust70 lookups on every line.
const { dust: DUST, abyss: ABYSS } = COLORS;
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
 * card.  Cards display placeholder rows during the fetch so card heights
 * stay stable.
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
  // Keyed by league id so each card looks up its own slice without
  // re-scanning the array.  `null` (the initial value) means "fetch in
  // flight" so cards can render the em-dash placeholder; once resolved,
  // an empty array means "league has no fixtures yet".
  const [standingsByLeague, setStandingsByLeague] = useState<
    Record<string, PositionedStandingsRow[] | null>
  >(() => Object.fromEntries(LEAGUES.map((l) => [l.id, null])));

  useEffect(() => {
    let cancelled = false;
    // Fire all four league fetches in parallel — independent network
    // round-trips, each ~1 RTT, so Promise.all keeps total latency at
    // single-fetch cost rather than 4× serial.
    Promise.all(
      LEAGUES.map((league) =>
        fetchLeagueStandings(db, league.id)
          .then((rows) => ({
            id: league.id,
            rows: rows.map((row, idx) => ({ ...row, position: idx + 1 })),
          }))
          .catch((err) => {
            console.warn(`[Leagues] standings fetch failed for ${league.id}:`, err);
            return { id: league.id, rows: [] as PositionedStandingsRow[] };
          }),
      ),
    ).then((results) => {
      if (cancelled) return;
      setStandingsByLeague((prev) => {
        const next = { ...prev };
        for (const { id, rows } of results) next[id] = rows;
        return next;
      });
    });
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
                standings={standingsByLeague[league.id] ?? null}
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
   * Full standings rows fetched from Supabase by the parent.  `null`
   * means the fetch is still in flight — the card shows placeholder
   * rows in that case.  An empty array means "no fixtures yet".
   */
  standings: PositionedStandingsRow[] | null;
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
 * in parallel via `fetchLeagueStandings`.  This card just slices to the
 * top CARD_TOP_N and renders; placeholders cover the pre-fetch state.
 */
function LeagueCard({ league, standings }: LeagueCardProps) {
  // ── Top-N leader slice ────────────────────────────────────────────────────
  // `standings === null` → fetch in flight; show placeholders.
  // `standings === []`   → league has no completed fixtures yet; also show
  //                        placeholders so card height stays stable.
  // Otherwise slice the first CARD_TOP_N rows for the leaders strip.
  const topRows: PositionedStandingsRow[] =
    standings && standings.length > 0 ? standings.slice(0, CARD_TOP_N) : [];

  const excerpt = truncateAtWord(league.description ?? '', CARD_DESCRIPTION_MAX_CHARS);

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
          page.  Render placeholders when standings are pre-season so the
          card height stays stable across leagues. */}
      <div style={{
        borderTop: `1px solid ${HAIRLINE}`,
        paddingTop: 16,
      }}>
        <div style={{
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: DUST_70,
          marginBottom: 12,
        }}>
          Current Leaders
        </div>

        <ol style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          {topRows.length === 0
            ? Array.from({ length: CARD_TOP_N }, (_, i) => (
                <PlaceholderLeaderRow key={i} position={i + 1} />
              ))
            : topRows.map((row: any) => (
                <LeaderRow key={row.id ?? row.team ?? row.position} row={row} />
              ))
          }
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
