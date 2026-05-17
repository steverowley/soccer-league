// ── StandingsTable.jsx ──────────────────────────────────────────────────────
// League standings table — extracted from Home.jsx in PR 3 when LeagueDetail
// became a second consumer, per the "extract on 2nd use" rule in Home.jsx's
// file header.
//
// The component owns:
//   - the column definitions (# / Club / P W D L GD Form Pts)
//   - the 3-tier position-pipe logic (top-N qualification dust pipe; bottom-N
//     relegation flare pipe; middle rows: no pipe)
//   - the "losses bleeding" flare flag on the L column (loose proxy for
//     "this club is in trouble" without exposing simulation internals)
//   - the 5-cell bordered-letter Form strip and its em-dash placeholders
//
// The Home page renders the top-N rows of one featured league; LeagueDetail
// renders every row of one specific league.  Both use the same table — the
// difference is only the row count passed in.

import { Link } from 'react-router-dom';
import { COLORS } from './Layout';

// ── Standings tier counts ────────────────────────────────────────────────────
// QUALIFICATION_COUNT — top N rows get the dust qualification pipe (Celestial
// Cup cue).  Matches the ISL competition structure: top 3 per league
// qualify for the Celestial Cup each season.
const QUALIFICATION_COUNT = 3;
// RELEGATION_COUNT — bottom N rows get the flare relegation pipe.  Loose
// editorial cue; doesn't actually relegate the team (the league structure
// is currently closed — no promotion/relegation between leagues).
const RELEGATION_COUNT = 2;

// ── Form pip rendering ───────────────────────────────────────────────────────
// FORM_PIP_COUNT — number of recent-result tiles drawn per row.  5 mirrors
// the array cap returned by computeStandings.  Bumping both together is
// the only safe way to widen the visualisation.
const FORM_PIP_COUNT = 5;
// FORM_PIP_SIZE — edge length in px.  24 px lines up with the standings
// row height (~28 px including the row hairline) so the tiles read inset
// within the row rather than floating.
const FORM_PIP_SIZE = 24;

/**
 * League standings table.
 *
 * Columns: # | CLUB | P | W | D | L | GD | FORM | PTS
 *
 * - Position renders the 3-tier pipe (top-3 dust / middle none / bottom-2
 *   flare) when the league has more rows than QUALIFICATION + RELEGATION
 *   combined (so a 4-team league doesn't paint every row).
 * - Form renders bordered W/D/L letter tiles, most-recent-first.
 * - Loses column flips to flare when losses ≥ half the matches played
 *   (rough "this club is bleeding" cue without exposing simulation stats).
 *
 * Row objects must include `position` (1-indexed), `team`, `played`,
 * `wins`, `draws`, `loses`, `gd`, `points`, and `form` (array of W/D/L).
 * `team_link` is optional — when present, the club cell renders as a
 * <Link>.  Anything missing falls back to a safe default (0 or "—").
 *
 * @param {{ rows: Array<object> }} props  Standings rows with `position`.
 * @returns {JSX.Element}
 */
export default function StandingsTable({ rows }) {
  // Column meta drives both the <thead> and the per-cell renderers.  Widths
  // are hints for the browser; the table still flows responsively under
  // overflowX: auto when the content forces it wider than the container.
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
                  textAlign: c.align,
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
            <StandingsRow
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

const cellLeft  = { textAlign: 'left',  padding: '14px 16px' };
const cellRight = { textAlign: 'right', padding: '14px 16px' };

/**
 * Single standings row.
 *
 * - The position cell paints the 3-tier pipe (or leaves it invisible for
 *   the middle band) so the column rhythm stays stable.
 * - The form cell renders 5 bordered letter tiles; pre-season sparse arrays
 *   fall back to em-dash placeholders.
 * - The L cell flips to flare-on-dust when losses ≥ half the matches played
 *   (e.g. 5 losses across 9 matches qualifies; 4/9 doesn't).  The threshold
 *   uses Math.ceil so it activates at exactly half, not strictly more than.
 *
 * @param {{ row: object, total: number }} props
 *   `total` is the league row count — required so the qualification +
 *   relegation pipes don't paint when the table is too small to support
 *   a meaningful middle band.
 */
function StandingsRow({ row, total }) {
  const pos = row.position ?? 0;

  // Only paint the position pipes when there's a genuine middle band.
  // For a 4-team league with QUAL=3 + REL=2, every row would otherwise
  // get a pipe — that breaks the visual cue of "qualification vs
  // relegation are exceptional".
  const hasRoom    = total > QUALIFICATION_COUNT + RELEGATION_COUNT;
  const isQualify  = hasRoom && pos <= QUALIFICATION_COUNT;
  const isRelegate = hasRoom && pos > total - RELEGATION_COUNT;

  const pipeColor = isRelegate ? COLORS.flare : COLORS.dust;
  const numColor  = isRelegate ? COLORS.flare : COLORS.dust;
  const showPipe  = isQualify || isRelegate;

  // Loses-cell editorial cue.  Half-matches-as-losses is the rough
  // threshold; the cell paints flare-on-dust without any number tweak so
  // the column rhythm stays stable.  Math.ceil ensures the threshold
  // activates at exactly half, not strictly above.
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
 * deltas (matches the Figma's "+18 / -25" treatment).
 *
 * Edge cases:
 *  - `null`/`undefined` → "—" so pre-season rows don't claim a real 0
 *  - `0` → "0" (genuine neutral, not "no matches played")
 *
 * @param {number | null | undefined} gd
 * @returns {string}
 */
function formatGd(gd) {
  if (gd === null || gd === undefined) return '—';
  if (gd === 0) return '0';
  return gd > 0 ? `+${gd}` : `${gd}`;
}

/**
 * Horizontal strip of FORM_PIP_COUNT bordered result tiles, most-recent
 * first.  Sparse arrays (a freshly-promoted team with 1 match played)
 * fill the remainder with em-dash placeholders so the column width is
 * stable across rows.
 *
 * @param {{ form?: Array<'W'|'D'|'L'> }} props
 */
function FormStrip({ form }) {
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
 *   W → dust border + dust letter (positive cue without shouting)
 *   D → dust border + dust letter at 50 % opacity (neutral)
 *   L → flare border + flare letter (recent defeat)
 *   undefined → faint dust border + em-dash placeholder
 *
 * @param {{ result?: 'W'|'D'|'L' }} props
 */
function FormPip({ result }) {
  const isLoss  = result === 'L';
  const border  = isLoss ? COLORS.flare : (result ? COLORS.dust : 'rgba(227,224,213,0.20)');
  const text    = isLoss ? COLORS.flare : (result ? COLORS.dust : 'rgba(227,224,213,0.40)');
  // D is the only result rendered at reduced opacity — it sits between W
  // and L semantically, so a faded dust letter reads as "neutral, not great".
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
