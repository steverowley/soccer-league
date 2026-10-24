// ── LoreHistory.tsx ─────────────────────────────────────────────────────────
// The pre-ISL history of a club or league, drawn from the canon export
// (src/data/lore.ts). Everything here is static, so it renders even when the
// live database is unreachable.
//
//   <ClubHistory clubId>        club page: honours, title years, archive
//                               fragments, terrace chants, the club's legends.
//   <LeagueRollOfHonour leagueId>  league page: all-time title table, recent
//                               champions, and every season in a disclosure.
//
// Lost clubs (Mars Rovers, Neptune Deep and the rest) appear by name in old
// honours lists with a dagger and no link: they have no page, and the site
// never explains why. That is the point.

import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { COLORS } from './Layout';
import {
  getClubLore,
  getLeagueLore,
  legendsForClub,
  fragmentsFor,
  titleTable,
  loreClubName,
  isIslClub,
  LAST_PRE_ISL_SEASON,
} from '../data/lore';

const { dust: DUST } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50 = COLORS.dust50;
const DUST_70 = COLORS.dust70;

const POSITION: Record<string, string> = {
  GK: 'Goalkeeper',
  DF: 'Defender',
  MF: 'Midfielder',
  FW: 'Forward',
};

const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: DUST_70,
  margin: '0 0 8px',
};
const bodyStyle: CSSProperties = { fontSize: 14, lineHeight: 1.7, color: DUST_50, margin: 0 };
const summaryStyle: CSSProperties = {
  ...labelStyle,
  cursor: 'pointer',
  margin: 0,
  padding: '12px 0',
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  listStyle: 'none',
};

/** The "+" that turns into an "x" when a disclosure opens (flex summaries drop the native marker). */
function SummaryMark() {
  return (
    <span
      className="isl-lore-mark"
      aria-hidden="true"
      style={{ fontSize: 16, lineHeight: 1, color: DUST, transition: 'transform 150ms ease' }}
    >
      +
    </span>
  );
}

/** Shared CSS: open-state marker, WebKit marker reset, and phone table sizing. */
function LoreStyles() {
  return (
    <style>{`
      details[open] > summary .isl-lore-mark { transform: rotate(45deg); }
      .isl-lore summary::-webkit-details-marker { display: none; }
      @media (max-width: 699px) {
        .isl-lore table td, .isl-lore table th { font-size: 13px !important; padding-right: 8px !important; }
      }
    `}</style>
  );
}

/** Club name: a link when the club is in the ISL, plain text with a dagger when it is lost. */
function ClubRef({ id }: { id: string }) {
  if (isIslClub(id)) {
    return (
      <Link to={`/teams/${id}`} style={{ color: DUST, textDecoration: 'none', fontWeight: 700 }}>
        {loreClubName(id)}
      </Link>
    );
  }
  return (
    <span style={{ color: DUST_70, fontWeight: 700 }} title="No longer playing">
      {loreClubName(id)}&nbsp;†
    </span>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ borderTop: `1px solid ${HAIRLINE}`, paddingTop: 12 }}>
      <p style={labelStyle}>{label}</p>
      <p
        style={{
          fontSize: 28,
          fontWeight: 700,
          lineHeight: 1.1,
          margin: 0,
          color: DUST,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </p>
    </div>
  );
}

function Quote({ children, small }: { children: ReactNode; small?: boolean }) {
  return (
    <blockquote
      style={{
        margin: 0,
        padding: '4px 0 4px 16px',
        borderLeft: `2px solid ${HAIRLINE}`,
        fontSize: small ? 14 : 16,
        lineHeight: 1.6,
        fontStyle: 'italic',
        color: small ? DUST_70 : DUST,
      }}
    >
      {children}
    </blockquote>
  );
}

/** Year list that stays short: everything inline when few, else a disclosure. */
function YearList({ label, years }: { label: string; years: number[] }) {
  if (years.length === 0) return null;
  const text = years.join(', ');
  if (years.length <= 10) {
    return (
      <div>
        <p style={labelStyle}>{label}</p>
        <p style={bodyStyle}>{text}</p>
      </div>
    );
  }
  return (
    <details>
      <summary style={summaryStyle}>
        <SummaryMark />
        {label}: all {years.length}, most recent {years[years.length - 1]}
      </summary>
      <p style={{ ...bodyStyle, paddingBottom: 8 }}>{text}</p>
    </details>
  );
}

// ── Club ─────────────────────────────────────────────────────────────────────

export function ClubHistory({ clubId }: { clubId: string }) {
  const club = getClubLore(clubId);
  if (!club) return null;
  const league = getLeagueLore(club.league);
  const archive = fragmentsFor(club.fragments, 'club page');
  const chants = fragmentsFor(club.fragments, 'chant');
  const legends = legendsForClub(clubId);

  return (
    <div
      className="isl-lore"
      style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 32 }}
    >
      <LoreStyles />
      {archive.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 760 }}>
          {archive.map((t) => (
            <Quote key={t}>{t}</Quote>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 24,
        }}
      >
        <Fact label="Founded" value={club.founded} />
        <Fact label={`In the ${league?.short ?? 'league'} since`} value={club.joined} />
        <Fact label="League titles" value={club.titles.length} />
        <Fact label={league ? `${league.cup}s` : 'Cups'} value={club.cups.length} />
        {club.celestialCups.length > 0 && (
          <Fact label="Celestial Cups" value={club.celestialCups.length} />
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {club.titles.length === 0 && (
          <p style={bodyStyle}>
            No league title in {LAST_PRE_ISL_SEASON - club.joined + 1} seasons before the ISL. Yet.
          </p>
        )}
        <YearList label="League champions" years={club.titles} />
        <YearList label={league ? `${league.cup} winners` : 'Cup winners'} years={club.cups} />
        <YearList label="Celestial Cup winners" years={club.celestialCups} />
      </div>

      {chants.length > 0 && (
        <div>
          <p style={labelStyle}>From the stands</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {chants.slice(0, 2).map((t) => (
              <Quote key={t} small>
                {t}
              </Quote>
            ))}
          </div>
        </div>
      )}

      {legends.length > 0 && (
        <div>
          <p style={labelStyle}>Legends</p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 16,
            }}
          >
            {legends.map((l) => {
              const line = fragmentsFor(l.fragments, 'club page')[0];
              return (
                <div key={l.name} style={{ border: `1px solid ${HAIRLINE}`, padding: 20 }}>
                  <p
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.01em',
                      margin: 0,
                      color: DUST,
                    }}
                  >
                    {l.name}
                  </p>
                  <p style={{ ...labelStyle, margin: '6px 0 0' }}>
                    {POSITION[l.position] ?? l.position} · {l.from}–{l.to}
                  </p>
                  {line && (
                    <p style={{ ...bodyStyle, marginTop: 12, fontStyle: 'italic' }}>{line}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── League ───────────────────────────────────────────────────────────────────

const cell: CSSProperties = {
  padding: '10px 12px 10px 0',
  borderTop: `1px solid ${HAIRLINE}`,
  fontSize: 14,
  verticalAlign: 'top',
};
const headCell: CSSProperties = {
  ...labelStyle,
  textAlign: 'left',
  padding: '0 12px 8px 0',
  margin: 0,
};

function SeasonTable({
  seasons,
  cupName,
}: {
  seasons: NonNullable<ReturnType<typeof getLeagueLore>>['seasons'];
  cupName: string;
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={headCell}>Season</th>
            <th style={headCell}>Champions</th>
            <th style={headCell}>Runners-up</th>
            <th style={headCell}>{cupName}</th>
          </tr>
        </thead>
        <tbody>
          {[...seasons].reverse().map((s) => (
            <tr key={s.year}>
              <td style={{ ...cell, color: DUST_70, fontVariantNumeric: 'tabular-nums' }}>
                {s.year}
              </td>
              <td style={cell}>
                <ClubRef id={s.champion} />
              </td>
              <td style={{ ...cell, color: DUST_70 }}>
                {s.runnerUp ? loreClubName(s.runnerUp) : ''}
              </td>
              <td style={{ ...cell, color: DUST_70 }}>{s.cup ? loreClubName(s.cup.winner) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LeagueRollOfHonour({ leagueId }: { leagueId: string }) {
  const league = getLeagueLore(leagueId);
  if (!league) return null;
  const table = titleTable(leagueId);
  const recent = league.seasons.slice(-10);
  const archive = fragmentsFor(league.fragments, 'club page');
  const hasLost = table.some((r) => !isIslClub(r.club));

  return (
    <div
      className="isl-lore"
      style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 40 }}
    >
      <LoreStyles />
      {archive.length > 0 && (
        <div style={{ maxWidth: 760 }}>
          {archive.map((t) => (
            <Quote key={t}>{t}</Quote>
          ))}
        </div>
      )}

      <div
        className="isl-honours-cols"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)',
          gap: 40,
          alignItems: 'start',
        }}
      >
        <div>
          <p style={labelStyle}>
            Most titles, {league.founded} to {LAST_PRE_ISL_SEASON}
          </p>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {table.slice(0, 8).map((r, i) => (
                <tr key={r.club}>
                  <td
                    style={{
                      ...cell,
                      width: 28,
                      color: DUST_70,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {i + 1}
                  </td>
                  <td style={cell}>
                    <ClubRef id={r.club} />
                  </td>
                  <td
                    style={{
                      ...cell,
                      textAlign: 'right',
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {r.titles}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasLost && (
            <p style={{ ...bodyStyle, fontSize: 12, marginTop: 12 }}>† No longer playing.</p>
          )}
        </div>

        <div>
          <p style={labelStyle}>The last ten seasons before the ISL</p>
          <SeasonTable seasons={recent} cupName={league.cup} />
        </div>
      </div>

      <details style={{ borderTop: `1px solid ${HAIRLINE}` }}>
        <summary style={summaryStyle}>
          <SummaryMark />
          Every season, {league.seasons.length} of them
        </summary>
        <SeasonTable seasons={league.seasons} cupName={league.cup} />
      </details>

      <style>{`
        @media (max-width: 899px) {
          .isl-honours-cols { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
