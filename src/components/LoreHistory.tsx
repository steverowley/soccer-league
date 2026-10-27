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
//
// On the design language since the group 4 migration (docs/design-language.md),
// with no raw style values (scripts/designTokens.test.ts): honours counts are
// StatBlocks, the honours tables use the shared DataTable styles with a Crest
// beside every club (a lost club's crest is the neutral shield, since it has
// no colour on record), legends are hairline Cards, quotes sit behind a 1 px
// rule, and tied title counts rank as "=2" (shared/utils/rankLabels).

import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TEAMS_BY_LEAGUE } from '../data/leagueData';
import { color, size, space, tone, type } from '../shared/design';
import { Card, Crest, DataTable, StatBlock, dataCell, dataHead } from '../shared/ui';
import { rankLabels } from '../shared/utils/rankLabels';
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

const POSITION: Record<string, string> = {
  GK: 'Goalkeeper',
  DF: 'Defender',
  MF: 'Midfielder',
  FW: 'Forward',
};

/** Club colour by team id, for the crest beside a club (club colour is data). */
const TEAM_COLOR: ReadonlyMap<string, string> = new Map(
  Object.values(TEAMS_BY_LEAGUE).flat().map((t) => [t.id, t.color]),
);

/** Uppercase label above a group (secondary tone). */
const labelStyle: CSSProperties = {
  ...type.label,
  ...tone.secondary,
  margin: 0,
  marginBottom: space[8],
};

/** Secondary prose and year lists. */
const bodyStyle: CSSProperties = { ...type.small, ...tone.secondary, margin: 0 };

/** A disclosure's summary row: label type, 44 px touch target. */
const summaryStyle: CSSProperties = {
  ...type.label,
  ...tone.secondary,
  cursor: 'pointer',
  margin: 0,
  paddingTop: space[12],
  paddingBottom: space[12],
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
  gap: space[12],
  listStyle: 'none',
};

/** The "+" that turns into an "x" when a disclosure opens (flex summaries drop the native marker). */
function SummaryMark() {
  return (
    <span
      className="isl-lore-mark"
      aria-hidden="true"
      style={{ fontSize: size.subheading, lineHeight: 1, color: color.text, transition: 'transform 150ms ease' }}
    >
      +
    </span>
  );
}

/** Shared CSS: open-state marker, WebKit marker reset, and phone cell padding. */
function LoreStyles() {
  return (
    <style>{`
      details[open] > summary .isl-lore-mark { transform: rotate(45deg); }
      .isl-lore summary::-webkit-details-marker { display: none; }
      @media (max-width: 599px) {
        .isl-lore table td, .isl-lore table th { padding-left: 8px !important; padding-right: 8px !important; }
      }
    `}</style>
  );
}

/**
 * Club name with its crest: a link when the club is in the ISL, plain text
 * with a dagger (and the neutral crest) when it is lost.
 *
 * @param id  A lore club id.
 * @returns   An inline crest + name.
 */
function ClubRef({ id }: { id: string }) {
  const row: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: space[8] };
  if (isIslClub(id)) {
    return (
      <Link to={`/teams/${id}`} style={{ ...row, color: color.text, textDecoration: 'none', fontWeight: 700 }}>
        <Crest color={TEAM_COLOR.get(id) ?? null} size={16} />
        {loreClubName(id)}
      </Link>
    );
  }
  return (
    <span style={{ ...row, ...tone.secondary, fontWeight: 700 }} title="No longer playing">
      <Crest color={null} size={16} />
      <span>{loreClubName(id)}&nbsp;†</span>
    </span>
  );
}

/**
 * A quotation from the archive: italic, behind a 1 px rule.
 *
 * @param small  Secondary, smaller quotes (terrace chants).
 */
function Quote({ children, small }: { children: ReactNode; small?: boolean }) {
  return (
    <blockquote
      style={{
        ...(small ? type.small : type.body),
        ...(small ? tone.secondary : tone.primary),
        margin: 0,
        paddingTop: space[4],
        paddingBottom: space[4],
        paddingLeft: space[16],
        borderLeft: `1px solid ${color.line}`,
        fontStyle: 'italic',
        maxWidth: '70ch',
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
        <p style={{ ...bodyStyle, ...tone.primary, fontVariantNumeric: 'tabular-nums' }}>{text}</p>
      </div>
    );
  }
  return (
    <details>
      <summary style={summaryStyle}>
        <SummaryMark />
        {label}: all {years.length}, most recent {years[years.length - 1]}
      </summary>
      <p style={{ ...bodyStyle, ...tone.primary, paddingBottom: space[8], fontVariantNumeric: 'tabular-nums' }}>{text}</p>
    </details>
  );
}

// ── Club ─────────────────────────────────────────────────────────────────────

/**
 * A club's history and honours from the canon.
 *
 * @param clubId  The club's team id.
 * @returns       The history block, or null for a club with no canon entry.
 */
export function ClubHistory({ clubId }: { clubId: string }) {
  const club = getClubLore(clubId);
  if (!club) return null;
  const league = getLeagueLore(club.league);
  const archive = fragmentsFor(club.fragments, 'club page');
  const chants = fragmentsFor(club.fragments, 'chant');
  const legends = legendsForClub(clubId);

  return (
    <div className="isl-lore" style={{ display: 'flex', flexDirection: 'column', gap: space[32] }}>
      <LoreStyles />
      {archive.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[12] }}>
          {archive.map((t) => (
            <Quote key={t}>{t}</Quote>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: space[24],
        }}
      >
        {[
          ['Founded', club.founded],
          [`In the ${league?.short ?? 'league'} since`, club.joined],
          ['League titles', club.titles.length],
          [league ? `${league.cup}s` : 'Cups', club.cups.length],
          ...(club.celestialCups.length > 0 ? [['Celestial Cups', club.celestialCups.length] as const] : []),
        ].map(([label, value]) => (
          <StatBlock
            key={String(label)}
            label={label}
            value={value}
            style={{ paddingTop: space[12], borderTop: `1px solid ${color.line}` }}
          />
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: space[12] }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[8] }}>
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
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
              gap: space[16],
            }}
          >
            {legends.map((l) => {
              const line = fragmentsFor(l.fragments, 'club page')[0];
              return (
                <Card key={l.name}>
                  <p style={{ ...type.subheading, margin: 0, overflowWrap: 'anywhere' }}>{l.name}</p>
                  <p style={{ ...labelStyle, margin: 0, marginTop: space[4] }}>
                    {POSITION[l.position] ?? l.position} · {l.from}–{l.to}
                  </p>
                  {line && (
                    <p style={{ ...bodyStyle, marginTop: space[12], fontStyle: 'italic' }}>{line}</p>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── League ───────────────────────────────────────────────────────────────────

/** One season of a league's register. */
type LoreSeason = NonNullable<ReturnType<typeof getLeagueLore>>['seasons'][number];

/**
 * A table of seasons, newest first: year, champions, runners-up, cup.
 *
 * @param seasons  Seasons in register order (oldest first).
 * @param cupName  The league cup's name, for its column header.
 * @param caption  Accessible table name.
 */
function SeasonTable({
  seasons,
  cupName,
  caption,
}: {
  seasons: readonly LoreSeason[];
  cupName: string;
  caption: string;
}) {
  return (
    <DataTable caption={caption} minWidth={420}>
      <thead>
        <tr>
          <th style={dataHead('left', 72)}>Season</th>
          <th style={dataHead()}>Champions</th>
          <th style={dataHead()}>Runners-up</th>
          <th style={dataHead()}>{cupName}</th>
        </tr>
      </thead>
      <tbody>
        {[...seasons].reverse().map((s) => (
          <tr key={s.year}>
            <td style={{ ...dataCell(), ...tone.secondary }}>{s.year}</td>
            <td style={dataCell()}>
              <ClubRef id={s.champion} />
            </td>
            <td style={{ ...dataCell(), ...tone.secondary }}>
              {s.runnerUp ? loreClubName(s.runnerUp) : ''}
            </td>
            <td style={{ ...dataCell(), ...tone.secondary }}>{s.cup ? loreClubName(s.cup.winner) : ''}</td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

/**
 * A league's roll of honour from the canon.
 *
 * @param leagueId  The league id.
 * @returns         The roll of honour, or null for a league with no canon.
 */
export function LeagueRollOfHonour({ leagueId }: { leagueId: string }) {
  const league = getLeagueLore(leagueId);
  if (!league) return null;
  const table = titleTable(leagueId).slice(0, 8);
  // Clubs level on titles share a rank ("=2"), never two "2"s in a row.
  const ranks = rankLabels(table, (r) => String(r.titles));
  const recent = league.seasons.slice(-10);
  const archive = fragmentsFor(league.fragments, 'club page');
  const hasLost = table.some((r) => !isIslClub(r.club));

  return (
    <div className="isl-lore" style={{ display: 'flex', flexDirection: 'column', gap: space[48] }}>
      <LoreStyles />
      {archive.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[12] }}>
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
          gap: space[48],
          alignItems: 'start',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p style={labelStyle}>
            Most titles, {league.founded} to {LAST_PRE_ISL_SEASON}
          </p>
          <DataTable caption={`Most league titles, ${league.founded} to ${LAST_PRE_ISL_SEASON}`}>
            <thead>
              <tr>
                <th style={dataHead('left', 48)}>#</th>
                <th style={dataHead()}>Club</th>
                <th style={dataHead('right', 72)}>Titles</th>
              </tr>
            </thead>
            <tbody>
              {table.map((r, i) => (
                <tr key={r.club}>
                  <td style={{ ...dataCell(), ...tone.secondary }}>{ranks[i]}</td>
                  <td style={dataCell()}>
                    <ClubRef id={r.club} />
                  </td>
                  <td style={{ ...dataCell('right'), fontWeight: 700 }}>{r.titles}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          {hasLost && (
            <p style={{ ...bodyStyle, ...tone.tertiary, marginTop: space[12] }}>† No longer playing.</p>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <p style={labelStyle}>The last ten seasons before the ISL</p>
          <SeasonTable seasons={recent} cupName={league.cup} caption="The last ten seasons before the ISL" />
        </div>
      </div>

      <details style={{ borderTop: `1px solid ${color.line}` }}>
        <summary style={summaryStyle}>
          <SummaryMark />
          Every season, {league.seasons.length} of them
        </summary>
        <SeasonTable seasons={league.seasons} cupName={league.cup} caption="Every season before the ISL" />
      </details>

      <style>{`
        @media (max-width: 899px) {
          .isl-honours-cols { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
