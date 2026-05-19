// ── StandingsTable.tsx ──────────────────────────────────────────────────────
// League standings table — extracted from Home.jsx in PR 3 when LeagueDetail
// became a second consumer, per the "extract on 2nd use" rule in Home.jsx's
// file header.
//
// The component owns:
//   - the column definitions (# / Club / P W D L GD Form Pts)
//   - the 3-tier position-pipe logic (top-N qualification dust pipe; bottom-N
//     relegation flare pipe; middle rows: no pipe)
//   - the "losses bleeding" flare flag on the L column
//   - the 5-cell bordered-letter Form strip and its em-dash placeholders

import { Link } from 'react-router-dom';
import { COLORS } from './Layout';

// ── Standings tier counts ────────────────────────────────────────────────────
// QUALIFICATION_COUNT — top N rows get the dust qualification pipe (Celestial
// Cup cue).  Matches the ISL competition structure: top 3 per league qualify.
const QUALIFICATION_COUNT = 3;
// RELEGATION_COUNT — bottom N rows get the flare relegation pipe.  Loose
// editorial cue; the league structure is currently closed (no relegation).
const RELEGATION_COUNT = 2;

// FORM_PIP_COUNT — number of recent-result tiles drawn per row.  5 mirrors
// the array cap returned by computeStandings.
const FORM_PIP_COUNT = 5;
// FORM_PIP_SIZE — edge length in px.  24 px lines up with the standings
// row height (~28 px including the row hairline) so the tiles read inset.
const FORM_PIP_SIZE = 24;

type FormResult = 'W' | 'D' | 'L';

interface StandingsRowData {
  id?: string;
  position?: number;
  team?: string;
  club?: string;
  team_link?: string;
  played?: number;
  wins?: number;
  draws?: number;
  loses?: number;
  gd?: number | null;
  points?: number;
  form?: FormResult[];
}

/**
 * League standings table.
 *
 * Columns: # | CLUB | P | W | D | L | GD | FORM | PTS
 *
 * - Position renders the 3-tier pipe (top-3 dust / middle none / bottom-2
 *   flare) when the league has more rows than QUALIFICATION + RELEGATION
 *   combined.
 * - Form renders bordered W/D/L letter tiles, most-recent-first.
 * - Loses column flips to flare when losses ≥ half the matches played.
 */
export default function StandingsTable({ rows }: { rows: StandingsRowData[] }) {
  const cols = [
    { key: 'pos',    label: '#',    align: 'left',  width: 64 },
    { key: 'club',   label: 'Club', align: 'left' },
    { key: 'played', label: 'P',    align: 'right', width: 56 },
    { key: 'wins',   label: 'W',    align: 'right', width: 56 },
    { key: 'draws',  label: 'D',    align: 'right', width: 56 },
    { key: 'loses',  label: 'L',    align: 'right', width: 56 },
    { key: 'gd',     label: 'GD',   align: 'right', width: 64 },
    { key: 'form',   label: 'Form', align: 'left',  width: 168 },
    { key: 'pts',    label: 'Pts',  align: 'right', width: 56 },
  ];
  const total = rows.length;

  return (
    <div style={{ border: `1px solid ${COLORS.hairline}`, overflowX: 'auto' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 13,
        color: COLORS.dust,
      }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${COLORS.hairline}` }}>
            {cols.map((c) => (
              <th
                key={c.key}
                style={{
                  textAlign: c.align as 'left' | 'right',
                  padding: '14px 16px',
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.14em',
                  color: COLORS.dust70,
                  width: c.width,
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <StandingsRowComponent
              key={row.id ?? row.team ?? row.position}
              row={row}
              total={total}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const cellLeft  = { textAlign: 'left'  as const, padding: '14px 16px' };
const cellRight = { textAlign: 'right' as const, padding: '14px 16px' };

/**
 * Single standings row.
 *
 * - The position cell paints the 3-tier pipe (or leaves it invisible for
 *   the middle band) so the column rhythm stays stable.
 * - The form cell renders 5 bordered letter tiles; sparse arrays fall back
 *   to em-dash placeholders.
 * - The L cell flips to flare when losses ≥ half the matches played.
 *   Math.ceil so it activates at exactly half, not strictly more.
 */
function StandingsRowComponent({ row, total }: { row: StandingsRowData; total: number }) {
  const pos = row.position ?? 0;

  // Only paint the position pipes when there's a genuine middle band.
  // For a 4-team league with QUAL=3 + REL=2, every row would otherwise
  // get a pipe — breaking the visual cue of "these tiers are exceptional".
  const hasRoom    = total > QUALIFICATION_COUNT + RELEGATION_COUNT;
  const isQualify  = hasRoom && pos <= QUALIFICATION_COUNT;
  const isRelegate = hasRoom && pos > total - RELEGATION_COUNT;

  const pipeColor = isRelegate ? COLORS.flare : COLORS.dust;
  const numColor  = isRelegate ? COLORS.flare : COLORS.dust;
  const showPipe  = isQualify || isRelegate;

  // Loses-cell editorial cue.  Half-matches-as-losses is the rough
  // threshold; Math.ceil ensures it activates at exactly half.
  const losesCount  = row.loses ?? 0;
  const losesIsHigh = (row.played ?? 0) > 0 && losesCount >= Math.ceil((row.played ?? 0) / 2);
  const losesColor  = losesIsHigh ? COLORS.flare : COLORS.dust;

  return (
    <tr style={{ borderBottom: `1px solid ${COLORS.hairline}` }}>
      <td style={cellLeft}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontWeight: 700,
          color: numColor,
        }}>
          {/* Pipe is always in the DOM so the column width stays stable;
              opacity 0 hides it for the middle band without reflow. */}
          <span aria-hidden="true" style={{ color: pipeColor, opacity: showPipe ? 1 : 0 }}>|</span>
          <span>{String(pos).padStart(2, '0')}</span>
        </span>
      </td>
      <td style={cellLeft}>
        {row.team_link ? (
          <Link to={row.team_link} style={{ color: COLORS.dust, textDecoration: 'none' }}>
            {row.team ?? row.club ?? '—'}
          </Link>
        ) : (
          <span>{row.team ?? row.club ?? '—'}</span>
        )}
      </td>
      <td style={cellRight}>{row.played ?? 0}</td>
      <td style={cellRight}>{row.wins   ?? 0}</td>
      <td style={cellRight}>{row.draws  ?? 0}</td>
      <td style={{ ...cellRight, color: losesColor, fontWeight: losesIsHigh ? 700 : 400 }}>
        {losesCount}
      </td>
      <td style={cellRight}>{formatGd(row.gd)}</td>
      <td style={cellLeft}>
        <FormStrip form={row.form} />
      </td>
      <td style={{ ...cellRight, fontWeight: 700 }}>{row.points ?? 0}</td>
    </tr>
  );
}

/**
 * Format the goal-difference value with an explicit `+` for positive
 * deltas.  `null`/`undefined` → "—" so pre-season rows don't claim 0.
 */
function formatGd(gd: number | null | undefined): string {
  if (gd === null || gd === undefined) return '—';
  if (gd === 0) return '0';
  return gd > 0 ? `+${gd}` : `${gd}`;
}

/**
 * Horizontal strip of FORM_PIP_COUNT bordered result tiles, most-recent
 * first.  Sparse arrays fill with em-dash placeholders so column width
 * is stable across all rows.
 */
function FormStrip({ form }: { form?: FormResult[] | undefined }) {
  const items = [];
  for (let i = 0; i < FORM_PIP_COUNT; i++) {
    const result = Array.isArray(form) ? form[i] : undefined;
    items.push(<FormPip key={i} result={result} />);
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {items}
    </span>
  );
}

/**
 * Single bordered form pip.  Style map:
 *   W → dust border + dust letter
 *   D → dust border + dust letter at 50% opacity (neutral)
 *   L → flare border + flare letter (recent defeat)
 *   undefined → faint dust border + em-dash placeholder
 */
function FormPip({ result }: { result?: FormResult | undefined }) {
  const isLoss  = result === 'L';
  const border  = isLoss ? COLORS.flare : (result ? COLORS.dust : 'rgba(227,224,213,0.20)');
  const text    = isLoss ? COLORS.flare : (result ? COLORS.dust : 'rgba(227,224,213,0.40)');
  // D is rendered at reduced opacity — neutral result, not great but not bad.
  const opacity = result === 'D' ? 0.5 : 1;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width:  FORM_PIP_SIZE,
      height: FORM_PIP_SIZE,
      border: `1px solid ${border}`,
      color:  text,
      opacity,
      fontSize: 11,
      fontWeight: 700,
      lineHeight: 1,
    }}>
      {result ?? '—'}
    </span>
  );
}
