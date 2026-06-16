// ── TeamDetail.tsx ────────────────────────────────────────────────────────────
// Single-club dossier — `/teams/:teamId` route. Rebuilt to match the design
// system's `Club.html` worked screen ("club dossier — honours, squad table,
// fixtures, decrees").
//
// Layout (matches the prototype top → bottom):
//   Header (global)
//   I.   Eyebrow head    — breadcrumb (Teams link • league • location) + BackLink
//   II.  Club hero       — 160px monogram crest / name + meta row / honours
//                          (League position only — Titles/Seasons omitted, no
//                          such data exists on the teams table)
//   III. 6-cell stat strip — Played / Won / Drawn / Lost / Goal diff / Points,
//                          all from fetchLeagueStandings for this club's league
//   IV.  Two-column shell (1fr / 380px):
//          LEFT  — Squad table (#/Player(+tag)/Position/arrow; rows link to the
//                  player page). Apps/Goals columns are dropped — the players
//                  table carries no appearance/goal stats to fill them.
//          RIGHT — Next fixture card (next scheduled match involving this team,
//                  or omitted), Form card (last-5 from standings), and a
//                  "Go to voting" decrees link card.
//   Below — the preserved richer sections, rehomed under the new shell:
//          Manager card, Club Dossier (history/culture/facts/honours),
//          Web of Influence relationship graph.
//   Footer (shared)
//
// Data sources (all existing fetches preserved, one ADDED):
//   - Static team meta from TEAMS_BY_LEAGUE / LEAGUES (hero hydration + 404).
//   - getTeam(db, teamId)               — live squad + manager rows.
//   - getTeamSupporterCount(db, teamId) — supporter count (fan tag).
//   - getEntityProfile(db, entityId)    — authored club profile (dossier).
//   - fetchLeagueStandings(db, leagueId) — ADDED: stat strip / form / position.
//   - getUpcomingMatches(db, …)         — ADDED: next-fixture lookup.
//
// 404 case: teamId not in any league → renders an "Unknown Club" surface
// with a backlink to /teams.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, Footer, BackLink } from '../components/Layout';
import { usePageTitle } from '../shared/hooks/usePageTitle';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import {
  getTeam,
  fetchLeagueStandings,
  getUpcomingMatches,
  type LeagueStandingsRow,
} from '../features/match';
import { getTeamSupporterCount } from '../features/auth';
import { RelationshipGraph, getEntityProfile } from '../features/entities';
import { LEAGUES, TEAMS_BY_LEAGUE } from '../data/leagueData';

// ── Local aliases for terser inline styles ──────────────────────────────────
const { dust: DUST, abyss: ABYSS, phobosAsh: PHOBOS, terraNova: TERRA } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;
const FLARE    = COLORS.flare;

// ── Squad ordering constants ────────────────────────────────────────────────
// Canonical order of the four position groups (GK reads back-to-front), used to
// sort the flat squad table so goalkeepers lead and forwards trail.
const POSITION_ORDER = ['GK', 'DF', 'MF', 'FW'];
const POSITION_RANK: Record<string, number> = Object.fromEntries(
  POSITION_ORDER.map((p, i) => [p, i]),
);

// Display names for the four position groups — full words rather than
// abbreviations so the table reads as a roster, not a stats dump.
const POSITION_LABELS: Record<string, string> = {
  GK: 'Goalkeeper',
  DF: 'Defender',
  MF: 'Midfielder',
  FW: 'Forward',
};

// ── Live-row shapes ─────────────────────────────────────────────────────────
// The joined team row arrives wide + untyped (getTeam uses a `*` select); we
// narrow only the fields the page actually renders. Everything optional, since
// the row paints before — and degrades gracefully without — the live fetch.
interface LivePlayer {
  id: string;
  name: string;
  position: string | null;
  jersey_number: number | null;
  starter: boolean;
}
interface LiveManager {
  id?: string;
  name: string;
  nationality?: string | null;
  style?: string | null;
}
interface LiveTeam {
  entity_id?: string | null;
  players?: LivePlayer[];
  managers?: LiveManager[];
}

// A trimmed upcoming-match row — the slice the next-fixture card reads.
interface UpcomingMatch {
  id: string;
  scheduled_at: string | null;
  round: string | null;
  stadium: string | null;
  home_team: { id: string; name: string } | null;
  away_team: { id: string; name: string } | null;
}

// The static team record extended with its parent league id.
interface StaticTeam {
  id: string;
  name: string;
  location: string;
  homeGround: string;
  capacity: string;
  color: string;
  tagline: string;
  description: string;
  leagueId: string;
}

/**
 * Two-letter club monogram for the crest fallback — first letters of the first
 * two "significant" words (pure abbreviations like FC/SC are skipped). Matches
 * the prototype's monogram crest, e.g. "Earth United FC" → "EU".
 */
function monogram(name: string): string {
  const words = name.split(/\s+/).filter((w) => !/^(FC|SC|AFC)$/i.test(w));
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** Goal difference with a leading "+" when positive, a real minus when negative. */
function gdLabel(gd: number): string {
  if (gd > 0) return `+${gd}`;
  if (gd < 0) return `−${Math.abs(gd)}`;
  return '0';
}

/** Roman-numeral league position for the honours block (matches the prototype). */
function toRoman(n: number): string {
  if (n <= 0) return '—';
  const table: Array<[number, string]> = [
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  let rem = n;
  for (const [value, sym] of table) {
    while (rem >= value) {
      out += sym;
      rem -= value;
    }
  }
  return out;
}

/** Look up a static team record across every league; null if unregistered. */
function findStaticTeam(teamId: string | undefined): StaticTeam | null {
  if (!teamId) return null;
  for (const [leagueId, teams] of Object.entries(TEAMS_BY_LEAGUE)) {
    const found = teams.find((t) => t.id === teamId);
    if (found) return { ...found, leagueId };
  }
  return null;
}

/**
 * Club dossier page.
 *
 * Hydrates immediately from the static team meta (so the hero paints on first
 * render) and supplements with the live squad + manager, standings, next
 * fixture, supporter count, and authored profile once each fetch settles.
 * Unknown `teamId` short-circuits to the UnknownClub surface.
 */
export default function TeamDetail() {
  const { teamId } = useParams();
  const db         = useSupabase();
  const staticTeam = findStaticTeam(teamId);
  usePageTitle(staticTeam?.name ?? 'Club');

  // Live row from Supabase: includes the `players` and `managers` collections
  // via getTeam's relational select. Null while loading or on error.
  const [liveTeam, setLiveTeam]   = useState<LiveTeam | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  // Supporter count from team_supporter_count_v. 0 = no supporters or error.
  const [supporterCount, setSupporterCount] = useState<number>(0);
  // Authored club profile from entities.meta.profile (history, kits, honours).
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  // This club's row from its league standings — drives the stat strip, the
  // honours position, and the Form card. Null until the fetch resolves.
  const [standing, setStanding] = useState<LeagueStandingsRow | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  // The next scheduled match involving this club, or null when none upcoming.
  const [nextMatch, setNextMatch] = useState<UpcomingMatch | null>(null);

  // ── Live team + supporter count ────────────────────────────────────────────
  useEffect(() => {
    if (!staticTeam || !teamId) return undefined;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-load pattern: reset error state, fire fetch, settle into liveTeam once it resolves
    setLoadError(null);
    getTeam(db, teamId)
      .then((data) => { if (!cancelled) setLiveTeam(data as unknown as LiveTeam); })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[TeamDetail] getTeam failed:', err);
        setLoadError(err);
      });
    getTeamSupporterCount(db, teamId).then((n) => {
      if (!cancelled) setSupporterCount(n);
    });
    return () => { cancelled = true; };
  }, [db, teamId, staticTeam]);

  // ── Standings for the stat strip / form / position ─────────────────────────
  // One query for this club's league. Rows arrive pre-sorted, so the row index
  // of this club + 1 is its league position.
  useEffect(() => {
    if (!staticTeam || !teamId) return undefined;
    let cancelled = false;
    fetchLeagueStandings(db, staticTeam.leagueId)
      .then((rows) => {
        if (cancelled) return;
        const idx = rows.findIndex((r) => r.id === teamId);
        setStanding(idx >= 0 ? (rows[idx] ?? null) : null);
        setPosition(idx >= 0 ? idx + 1 : null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[TeamDetail] standings fetch failed:', err);
      });
    return () => { cancelled = true; };
  }, [db, teamId, staticTeam]);

  // ── Next fixture ───────────────────────────────────────────────────────────
  // Scan the upcoming-match window for the first fixture involving this club.
  // Omitted (card hidden) when none is scheduled.
  useEffect(() => {
    if (!teamId) return undefined;
    let cancelled = false;
    getUpcomingMatches(db, 50)
      .then((rows) => {
        if (cancelled) return;
        const list = rows as unknown as UpcomingMatch[];
        const found = list.find(
          (m) => m.home_team?.id === teamId || m.away_team?.id === teamId,
        );
        setNextMatch(found ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[TeamDetail] upcoming matches fetch failed:', err);
      });
    return () => { cancelled = true; };
  }, [db, teamId]);

  // ── Authored club profile (dossier) ────────────────────────────────────────
  useEffect(() => {
    const entityId = liveTeam?.entity_id ?? undefined;
    if (!entityId) return undefined;
    let cancelled = false;
    getEntityProfile(db, entityId)
      .then((res) => { if (!cancelled) setProfile(res?.profile ?? null); })
      .catch(() => { /* supplementary; silently omit on error */ });
    return () => { cancelled = true; };
  }, [db, liveTeam?.entity_id]);

  if (!staticTeam) return <UnknownClub teamId={teamId} />;

  const league   = LEAGUES.find((l) => l.id === staticTeam.leagueId);
  const players  = liveTeam?.players  ?? [];
  const managers = liveTeam?.managers ?? [];
  const manager  = managers[0];

  return (
    <div style={{ background: ABYSS, color: DUST, minHeight: '100vh' }}>
      <Header />

      <Container>
        {/* I — Eyebrow head: breadcrumb + backlink. */}
        <header style={{ padding: '48px 0 0' }}>
          <BackLink to="/teams">All Clubs</BackLink>
          <div style={{ ...eyebrowStyle, marginTop: 20 }}>
            <Link to="/teams" style={{ color: DUST, textDecoration: 'none' }}>Teams</Link>
            <span style={{ color: DUST_50 }}>•</span>
            <span>{league?.name ?? staticTeam.leagueId}</span>
            {staticTeam.location && (
              <>
                <span style={{ color: DUST_50 }}>•</span>
                <span>{staticTeam.location}</span>
              </>
            )}
          </div>
        </header>

        {/* II — Club hero. */}
        <ClubHero
          team={staticTeam}
          managerName={manager?.name}
          position={position}
          supporterCount={supporterCount}
        />

        {/* III — 6-cell stat strip. */}
        <StatStrip standing={standing} />

        {/* IV — Two-column shell. */}
        <div
          className="isl-club-cols"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 380px',
            gap: 24,
            alignItems: 'start',
            padding: '24px 0 64px',
          }}
        >
          {/* LEFT — Squad. */}
          <div>
            <div style={sectHStyle}>
              <span>Squad</span>
              <Link to="/world" style={sectHLinkStyle}>Trace the web in World ▸</Link>
            </div>
            {loadError != null ? (
              <p style={mutedNote(FLARE)}>
                Squad data unavailable. The void has consumed the team sheet.
              </p>
            ) : players.length === 0 ? (
              <p style={mutedNote(DUST_50)}>Loading squad…</p>
            ) : (
              <SquadTable players={players} />
            )}
          </div>

          {/* RIGHT — rail. */}
          <aside
            className="isl-club-rail"
            style={{ display: 'flex', flexDirection: 'column', gap: 24, position: 'sticky', top: 24 }}
          >
            {nextMatch && <NextFixtureCard match={nextMatch} teamId={staticTeam.id} />}
            <FormCard standing={standing} />
            <DecreesCard />
          </aside>
        </div>
      </Container>

      {/* ── Preserved richer sections, rehomed below the shell ── */}

      {/* Manager. */}
      <section style={{ padding: '0 16px 64px' }}>
        <Container>
          <SectionLabel kicker="Dugout" title="Manager" />
          {loadError != null ? (
            <p style={mutedNote(FLARE)}>Manager data unavailable.</p>
          ) : !manager ? (
            <p style={mutedNote(DUST_50)}>No manager appointed.</p>
          ) : (
            <ManagerCard manager={manager} />
          )}
        </Container>
      </section>

      {/* Club Dossier — authored narrative profile. Hidden when none exists. */}
      {profile && (
        <section style={{ padding: '0 16px 64px' }}>
          <Container>
            <SectionLabel kicker="The Story" title="Club Dossier" />
            <ClubDossier profile={profile} />
          </Container>
        </section>
      )}

      {/* Web of Influence — relationship graph seeded from the shadow entity. */}
      {liveTeam?.entity_id && (
        <section style={{ padding: '0 16px 80px' }}>
          <Container>
            <SectionLabel kicker="Connections" title="Web of Influence" />
            <div style={{ marginTop: 24 }}>
              <RelationshipGraph entityId={liveTeam.entity_id} />
            </div>
          </Container>
        </section>
      )}

      <Footer />

      {/* The two-column shell collapses to one column on tablet/mobile; the rail
          drops below the squad and stops sticking. */}
      <style>{`
        @media (max-width: 899px) {
          .isl-club-cols { grid-template-columns: 1fr !important; }
          .isl-club-rail { position: static !important; }
        }
      `}</style>
    </div>
  );
}

// ── Page-head + section text styles ──────────────────────────────────────────
const eyebrowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  flexWrap: 'wrap',
  color: DUST,
};
const sectHStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  fontSize: 16,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  margin: '0 0 16px',
};
const sectHLinkStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: DUST,
  textDecoration: 'none',
};

/** Italic muted note used for the squad/manager loading + error states. */
function mutedNote(color: string): CSSProperties {
  return { color, fontStyle: 'italic', fontSize: 13, marginTop: 8 };
}

// ── Club hero ─────────────────────────────────────────────────────────────────

interface ClubHeroProps {
  team: StaticTeam;
  managerName?: string | undefined;
  position: number | null;
  supporterCount: number;
}

/**
 * Club hero — 160px monogram crest, 48px uppercase name + meta row, and an
 * honours block. The honours block carries League position only (real, from
 * standings); Titles and Seasons are omitted because the teams table has no
 * such columns to fill them.
 */
function ClubHero({ team, managerName, position, supporterCount }: ClubHeroProps) {
  const accent = team.color || DUST;
  const meta: ReactNode[] = [];
  meta.push(<span key="ground">Home • {team.homeGround}</span>);
  if (team.capacity) meta.push(<span key="cap">{team.capacity} souls</span>);
  if (managerName)   meta.push(<span key="mgr">{managerName}</span>);
  if (supporterCount > 0) {
    meta.push(
      <span key="fans" style={{ color: TERRA }}>
        {supporterCount} {supporterCount === 1 ? 'fan' : 'fans'}
      </span>,
    );
  }

  return (
    <div
      className="isl-club-hero"
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr auto',
        gap: 40,
        alignItems: 'center',
        border: `1px solid ${HAIRLINE}`,
        padding: 40,
        marginTop: 24,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 160,
          height: 160,
          borderRadius: '50%',
          background: PHOBOS,
          border: `1px solid ${accent}`,
          display: 'grid',
          placeItems: 'center',
          fontWeight: 700,
          fontSize: 56,
          color: DUST,
        }}
      >
        {monogram(team.name)}
      </div>

      <div>
        <h1 style={{ fontWeight: 700, fontSize: 48, lineHeight: 1, margin: 0, textTransform: 'uppercase' }}>
          {team.name}
        </h1>
        <div
          style={{
            display: 'flex',
            gap: 14,
            flexWrap: 'wrap',
            alignItems: 'center',
            fontWeight: 700,
            fontSize: 14,
            textTransform: 'uppercase',
            marginTop: 16,
            color: DUST_70,
          }}
        >
          {meta.map((node, i) => (
            <span key={i} style={{ display: 'contents' }}>
              {i > 0 && <span style={{ color: DUST_50 }}>•</span>}
              {node}
            </span>
          ))}
        </div>
      </div>

      {/* Honours — League position only. */}
      <div style={{ display: 'flex', gap: 32 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 32 }}>
            {position != null ? toRoman(position) : '—'}
          </div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 6, color: DUST_70 }}>
            League position
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stat strip ──────────────────────────────────────────────────────────────

/**
 * 6-cell stat strip — Played / Won / Drawn / Lost / Goal diff / Points, gridded
 * with hairline gutters. Won + Points read Terra-Nova when positive (the
 * prototype's `.up`). All values come from this club's standings row; before it
 * resolves every cell shows an em-dash so the strip never shifts size.
 */
function StatStrip({ standing }: { standing: LeagueStandingsRow | null }) {
  const dash = (v: number | undefined) => (standing ? String(v) : '—');
  const cells: Array<{ k: string; v: string; up?: boolean }> = [
    { k: 'Played',    v: dash(standing?.played) },
    { k: 'Won',       v: dash(standing?.wins),  up: (standing?.wins ?? 0) > 0 },
    { k: 'Drawn',     v: dash(standing?.draws) },
    { k: 'Lost',      v: dash(standing?.loses) },
    { k: 'Goal diff', v: standing ? gdLabel(standing.gd) : '—' },
    { k: 'Points',    v: dash(standing?.points), up: (standing?.points ?? 0) > 0 },
  ];
  return (
    <div
      className="isl-club-strip"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: 1,
        background: HAIRLINE,
        border: `1px solid ${HAIRLINE}`,
        marginTop: 1,
      }}
    >
      {cells.map((c) => (
        <div key={c.k} style={{ background: ABYSS, padding: 24, textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 28, color: c.up && standing ? TERRA : DUST }}>{c.v}</div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 8, color: DUST_70 }}>
            {c.k}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Squad table ───────────────────────────────────────────────────────────────

/**
 * Squad table — the prototype's bordered roster. A head row over player rows on
 * `40px / 1fr / 130px / 24px` (the prototype's Apps + Goals columns are dropped:
 * the players table carries no appearance or goal stats to fill them). Players
 * are sorted by position group (GK → DF → MF → FW), starters before subs, then
 * jersey number. Each row links to the player detail page.
 */
function SquadTable({ players }: { players: LivePlayer[] }) {
  const sorted = [...players].sort((a, b) => {
    const ra = POSITION_RANK[a.position ?? ''] ?? POSITION_ORDER.length;
    const rb = POSITION_RANK[b.position ?? ''] ?? POSITION_ORDER.length;
    if (ra !== rb) return ra - rb;
    if (a.starter !== b.starter) return a.starter ? -1 : 1;
    return (a.jersey_number ?? 99) - (b.jersey_number ?? 99);
  });

  return (
    <div style={{ border: `1px solid ${HAIRLINE}` }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '40px 1fr 130px 24px',
          gap: 16,
          padding: '16px 24px',
          borderBottom: `1px solid ${HAIRLINE}`,
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: DUST_70,
        }}
      >
        <span>#</span>
        <span>Player</span>
        <span>Position</span>
        <span />
      </div>
      {sorted.map((p) => (
        <PlayerRow key={p.id} player={p} />
      ))}
    </div>
  );
}

/** Single squad row — jersey number, name (+ Captain tag for starters with a
 * known position label), position, and a trailing arrow. Links to the player. */
function PlayerRow({ player }: { player: LivePlayer }) {
  const [hovered, setHovered] = useState(false);
  const posLabel = player.position ? (POSITION_LABELS[player.position] ?? player.position) : '—';
  return (
    <Link
      to={`/players/${player.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '40px 1fr 130px 24px',
        gap: 16,
        alignItems: 'center',
        padding: '16px 24px',
        borderBottom: `1px solid ${HAIRLINE}`,
        background: hovered ? PHOBOS : 'transparent',
        color: DUST,
        textDecoration: 'none',
        transition: 'background 0.12s linear',
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 15, color: DUST_70, fontVariantNumeric: 'tabular-nums' }}>
        {String(player.jersey_number ?? 0).padStart(2, '0')}
      </span>
      <span style={{ fontWeight: 700, fontSize: 16 }}>{player.name}</span>
      <span style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.03em', color: DUST_70 }}>
        {posLabel}
      </span>
      <span style={{ color: DUST_50, display: 'flex', justifyContent: 'flex-end' }} aria-hidden="true">▸</span>
    </Link>
  );
}

// ── Side rail cards ─────────────────────────────────────────────────────────

/** A bordered rail card: optional uppercase heading over its content. */
function Card({ children }: { children: ReactNode }) {
  return (
    <div style={{ border: `1px solid ${HAIRLINE}`, padding: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {children}
    </div>
  );
}

/**
 * Next-fixture card — monogram-v-monogram, the matchup line, a when/where line
 * (round / kickoff / stadium, omitting any piece that's missing), and a
 * "Watch & stake" CTA to the match. Rendered only when a fixture exists.
 */
function NextFixtureCard({ match, teamId }: { match: UpcomingMatch; teamId: string }) {
  const home = match.home_team;
  const away = match.away_team;
  const detail = [
    match.round ?? null,
    formatKickoff(match.scheduled_at),
    match.stadium ?? null,
  ].filter((x): x is string => Boolean(x));
  const isHome = home?.id === teamId;

  return (
    <Card>
      <div style={{ ...sectHStyle, margin: 0 }}>
        <span>Next fixture</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <MiniCrest name={home?.name ?? '—'} dim={!isHome} />
          <span style={{ fontWeight: 700, fontSize: 14 }}>v</span>
          <MiniCrest name={away?.name ?? '—'} dim={isHome} />
        </div>
        <div style={{ fontWeight: 700, fontSize: 14, textTransform: 'uppercase' }}>
          {(home?.name ?? '—')} v {(away?.name ?? '—')}
        </div>
        {detail.length > 0 && (
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.03em', color: DUST_70 }}>
            {detail.join(' • ')}
          </div>
        )}
        <Link
          to={`/matches/${match.id}`}
          style={{
            width: '100%',
            textAlign: 'center',
            boxSizing: 'border-box',
            fontSize: 13,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: ABYSS,
            background: COLORS.astro,
            border: `1px solid ${COLORS.astro}`,
            padding: '14px 20px',
            textDecoration: 'none',
            minHeight: 44,
          }}
        >
          Watch &amp; stake
        </Link>
      </div>
    </Card>
  );
}

/** 48px monogram crest used inside the next-fixture card. */
function MiniCrest({ name, dim }: { name: string; dim: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 48,
        height: 48,
        borderRadius: '50%',
        background: PHOBOS,
        border: `1px solid ${HAIRLINE}`,
        display: 'grid',
        placeItems: 'center',
        fontWeight: 700,
        fontSize: 14,
        color: DUST,
        opacity: dim ? 0.6 : 1,
      }}
    >
      {monogram(name)}
    </span>
  );
}

/**
 * Form card — the W/D/L strip from this club's last-5 standings form, plus a
 * short prose summary. Hidden values degrade to a single dash so the card never
 * collapses; the prose is derived from the real tally, not invented.
 */
function FormCard({ standing }: { standing: LeagueStandingsRow | null }) {
  const form = standing?.form ?? [];
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ ...sectHStyle, margin: 0 }}><span>Form</span></div>
        <FormStrip form={form} />
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.5, color: DUST_70 }}>
        {formProse(form)}
      </div>
    </Card>
  );
}

/** Build a truthful one-liner from the last-5 results, or a quiet fallback. */
function formProse(form: Array<'W' | 'D' | 'L'>): string {
  if (form.length === 0) {
    return 'No matches played yet this cycle — the record is a blank slate.';
  }
  const w = form.filter((r) => r === 'W').length;
  const d = form.filter((r) => r === 'D').length;
  const l = form.filter((r) => r === 'L').length;
  const parts: string[] = [];
  if (w) parts.push(`${w} won`);
  if (d) parts.push(`${d} drawn`);
  if (l) parts.push(`${l} lost`);
  const span = form.length === 1 ? 'Last match' : `Last ${form.length} matches`;
  return `${span}: ${parts.join(', ')}.`;
}

/**
 * Active-decrees card. Open focus options for a club need a season id and a
 * dedicated query, so rather than fabricate decrees this links straight to the
 * voting surface where the live focuses are surfaced.
 */
function DecreesCard() {
  return (
    <Card>
      <div style={{ ...sectHStyle, margin: 0 }}><span>Active decrees</span></div>
      <p style={{ fontSize: 13, lineHeight: 1.6, color: DUST_70, margin: 0 }}>
        End-of-season focuses are pooled and enacted by this club&rsquo;s fans. Cast your
        credits when voting opens.
      </p>
      <Link
        to="/voting"
        style={{
          width: '100%',
          textAlign: 'center',
          boxSizing: 'border-box',
          fontSize: 13,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: DUST,
          background: ABYSS,
          border: `1px solid ${DUST}`,
          padding: '14px 20px',
          textDecoration: 'none',
          minHeight: 44,
        }}
      >
        Go to voting
      </Link>
    </Card>
  );
}

/**
 * Last-5 form strip: a row of 24px bordered W/D/L cells, most-recent first.
 * Draws read muted; losses take the Solar-Flare border + text. An empty form
 * renders a single muted dash so the row never collapses.
 */
function FormStrip({ form }: { form: Array<'W' | 'D' | 'L'> }) {
  if (form.length === 0) {
    return <span style={{ color: DUST_50, fontSize: 12, fontWeight: 700 }}>—</span>;
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {form.map((r, i) => {
        const isDraw = r === 'D';
        const isLoss = r === 'L';
        return (
          <span
            key={i}
            style={{
              width: 24,
              height: 24,
              display: 'grid',
              placeItems: 'center',
              fontWeight: 700,
              fontSize: 12,
              border: `1px solid ${isLoss ? FLARE : isDraw ? 'rgba(227,224,213,0.45)' : HAIRLINE}`,
              color: isLoss ? FLARE : isDraw ? 'rgba(227,224,213,0.82)' : DUST,
            }}
          >
            {r}
          </span>
        );
      })}
    </span>
  );
}

// ── Below-shell preserved sections ──────────────────────────────────────────

/** Small section label (uppercase kicker + title) used for the rehomed blocks. */
function SectionLabel({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: DUST_70 }}>
        {kicker}
      </div>
      <h2 style={{ fontSize: 28, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em', lineHeight: 1.1, margin: '12px 0 0' }}>
        {title}
      </h2>
      <hr style={{ border: 0, height: 1, background: HAIRLINE, margin: '20px 0 0' }} />
    </div>
  );
}

/**
 * Club Dossier block — the authored narrative profile (entities.meta.profile):
 * the history + culture prose, a grid of identity facts, and the honours lists.
 * Defensive against missing/mistyped fields since the profile arrives untyped;
 * empty fields are omitted.
 */
function ClubDossier({ profile }: { profile: Record<string, unknown> }) {
  const str = (k: string): string => (typeof profile[k] === 'string' ? (profile[k] as string) : '');
  const list = (k: string): string[] =>
    Array.isArray(profile[k]) ? (profile[k] as unknown[]).filter((x): x is string => typeof x === 'string') : [];

  const labelStyle: CSSProperties = {
    fontSize: 11,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: DUST_70,
    margin: '0 0 6px',
  };
  const bodyStyle: CSSProperties = { fontSize: 14, lineHeight: 1.7, color: DUST_50, margin: 0 };

  const history = str('history');
  const culture = str('club_culture');
  const facts: Array<[string, string]> = (
    [
      ['Fans', str('fans_nickname')],
      ['Founded', str('date_founded')],
      ['Allegiance', str('political_leaning')],
      ['Following', str('number_of_fans')],
      ['Badge', str('badge')],
      ['Home Kit', str('home_kit')],
      ['Away Kit', str('away_kit')],
      ['Third Kit', str('third_kit')],
    ] as Array<[string, string]>
  ).filter(([, v]) => v.length > 0);
  const trophies = list('trophy_cabinet');
  const legends = list('legends');
  const achievements = list('achievements');

  const renderList = (label: string, items: string[]) =>
    items.length > 0 ? (
      <div style={{ marginTop: 24 }}>
        <p style={labelStyle}>{label}</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {items.map((i) => (
            <li key={i} style={{ ...bodyStyle, marginBottom: 4 }}>{i}</li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <div style={{ marginTop: 24 }}>
      {history && <p style={{ ...bodyStyle, maxWidth: 760, marginBottom: culture ? 20 : 0 }}>{history}</p>}
      {culture && <p style={{ ...bodyStyle, maxWidth: 760, fontStyle: 'italic', color: DUST_70 }}>{culture}</p>}
      {facts.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 24,
            marginTop: 28,
          }}
        >
          {facts.map(([label, value]) => (
            <div key={label}>
              <p style={labelStyle}>{label}</p>
              <p style={bodyStyle}>{value}</p>
            </div>
          ))}
        </div>
      )}
      {renderList('Trophy Cabinet', trophies)}
      {renderList('Legends', legends)}
      {renderList('Achievements', achievements)}
    </div>
  );
}

/**
 * Single-manager card. Bold name (links to /managers/:id when present),
 * nationality small-caps, italic tactical-style descriptor (underscores
 * prettified, words titlecased so the raw key never leaks).
 */
function ManagerCard({ manager }: { manager: LiveManager }) {
  const styleLabel = manager.style
    ? manager.style.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
    : null;

  return (
    <div style={{ border: `1px solid ${HAIRLINE}`, padding: 24, marginTop: 24, maxWidth: 480 }}>
      <h3 style={{ fontSize: 22, fontWeight: 700, textTransform: 'uppercase', lineHeight: 1.2, margin: 0, letterSpacing: '0.01em' }}>
        {manager.id ? (
          <Link to={`/managers/${manager.id}`} style={{ color: DUST, textDecoration: 'none' }}>
            {manager.name}
          </Link>
        ) : (
          manager.name
        )}
      </h3>
      {manager.nationality && (
        <div style={{ marginTop: 8, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: DUST_70 }}>
          {manager.nationality}
        </div>
      )}
      {styleLabel && (
        <p style={{ marginTop: 16, fontSize: 13, fontStyle: 'italic', color: DUST }}>
          Tactical philosophy: {styleLabel}
        </p>
      )}
    </div>
  );
}

/**
 * Format a kickoff ISO timestamp into a tight day/time label, e.g.
 * "Tue 19:00". Returns null on a missing/invalid timestamp so the caller can
 * drop the piece rather than render an em-dash.
 */
function formatKickoff(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Unknown-club fallback surface. Minimal central message with a backlink, no
 * router redirect — mirrors LeagueDetail's UnknownLeague.
 */
function UnknownClub({ teamId }: { teamId?: string | undefined }) {
  return (
    <div style={{ background: ABYSS, color: DUST, minHeight: '100vh' }}>
      <Header />
      <section style={{ padding: '120px 32px' }}>
        <Container>
          <BackLink to="/teams">All Clubs</BackLink>
          <h1 style={{ fontSize: 32, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em', marginTop: 24 }}>
            Unknown Club
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: DUST_70, marginTop: 16, maxWidth: '52ch' }}>
            No club registered under{' '}
            <code style={{ color: DUST, fontFamily: 'inherit', background: COLORS.dustFaint, padding: '2px 6px', border: `1px solid ${HAIRLINE}` }}>
              {teamId ?? '—'}
            </code>
            . Try the{' '}
            <Link to="/teams" style={{ color: DUST }}>full directory</Link>{' '}
            to find the side you were after.
          </p>
        </Container>
      </section>
      <Footer />
    </div>
  );
}
