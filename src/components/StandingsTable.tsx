// ── StandingsTable.tsx ──────────────────────────────────────────────────────
// League standings table, shared by Home (the featured league) and the
// league detail page. On the design tokens since the design-language
// migration (docs/design-language.md, sections 6 and 7: "DataTable styles").
//
// The component owns:
//   - the columns (# / Club / P W D L GD Form Pts), sortable by header (#400)
//   - rank labels, with ties shown as "=N" (shared/utils/rankLabels)
//   - the qualification cue: the top three ranks in the success colour
//     (they qualify for the Celestial Cup)
//   - the crest beside each club and the five-tile Form strip
//
// Colour by meaning: red is live or error only, so losses, the bottom of the
// table and the L column are no longer red; a loss tile is tertiary, a win
// tile is the success colour.

import { memo, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { TEAMS_BY_LEAGUE } from '../data/leagueData';
import { color, hairline, numeric, space, tone, type } from '../shared/design';
import { Crest } from '../shared/ui';
import { rankLabels, standingsTieKey } from '../shared/utils/rankLabels';

// ── Sortable columns (#400) ────────────────────────────────────────────────
// Click a header to sort the table by that column; click again to flip
// direction. The default sort is `pos asc`, the league-table order produced
// by the standings read (pts DESC, GD DESC, scored DESC). Club and Form are
// not sortable: an alphabetical club sort breaks the table's framing, and
// Form has no canonical ordering value.
type SortKey   = 'pos' | 'played' | 'wins' | 'draws' | 'loses' | 'gd' | 'pts';
type SortDir   = 'asc' | 'desc';
interface SortState { key: SortKey; dir: SortDir }

const DEFAULT_SORT: SortState = { key: 'pos', dir: 'asc' };

/** Top N ranks qualify for the Celestial Cup and carry the success colour. */
const QUALIFICATION_COUNT = 3;

/** Recent-result tiles per row (the standings read caps form at five). */
const FORM_PIP_COUNT = 5;
/** Form tile edge in px. */
const FORM_PIP_SIZE = 24;

type FormResult = 'W' | 'D' | 'L';

/** Club colour by team id, for the crest (club colour is data). */
const TEAM_COLOR: ReadonlyMap<string, string> = new Map(
  Object.values(TEAMS_BY_LEAGUE).flat().map((t) => [t.id, t.color]),
);

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
  gf?: number;
  gd?: number | null;
  points?: number;
  form?: FormResult[];
}

const HEADER: CSSProperties = {
  ...type.label,
  paddingTop: space[12],
  paddingBottom: space[12],
  paddingLeft: space[12],
  paddingRight: space[12],
  borderBottom: `1px solid ${color.line}`,
};

const cell: CSSProperties = {
  paddingTop: space[12],
  paddingBottom: space[12],
  paddingLeft: space[12],
  paddingRight: space[12],
  borderBottom: `1px solid ${color.lineFaint}`,
};
const cellLeft:  CSSProperties = { ...cell, textAlign: 'left' };
const cellRight: CSSProperties = { ...cell, textAlign: 'right' };

/**
 * League standings table.
 *
 * Columns: # | CLUB | P | W | D | L | GD | FORM | PTS
 *
 * @param rows  Standings rows in table order, each stamped with `position`.
 * @returns     A horizontally scrollable table (it scrolls inside its own
 *              box on a phone; the page itself never overflows).
 */
function StandingsTable({ rows }: { rows: StandingsRowData[] }) {
  const cols: Array<{ key: string; label: string; align: 'left' | 'right'; width?: number; sortable?: boolean }> = [
    { key: 'pos',    label: '#',    align: 'left',  width: 48,  sortable: true },
    { key: 'club',   label: 'Club', align: 'left' },
    { key: 'played', label: 'P',    align: 'right', width: 48,  sortable: true },
    { key: 'wins',   label: 'W',    align: 'right', width: 48,  sortable: true },
    { key: 'draws',  label: 'D',    align: 'right', width: 48,  sortable: true },
    { key: 'loses',  label: 'L',    align: 'right', width: 48,  sortable: true },
    { key: 'gd',     label: 'GD',   align: 'right', width: 64,  sortable: true },
    { key: 'form',   label: 'Form', align: 'left',  width: 160 },
    { key: 'pts',    label: 'Pts',  align: 'right', width: 48,  sortable: true },
  ];

  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  // Sorted view of the incoming rows. Memoised so unrelated re-renders do
  // not re-sort.
  const sortedRows = useMemo(() => sortRows(rows, sort), [rows, sort]);

  // Rank labels come from the table order (by position), whatever column
  // the reader has sorted by, so a club keeps its "=2" when sorted by wins.
  const rankByRow = useMemo(() => {
    const ordered = [...rows].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const labels = rankLabels(ordered, standingsTieKey);
    return new Map(ordered.map((row, i) => [row, labels[i] ?? '']));
  }, [rows]);

  // Header click: flip direction on the active column; otherwise pick the
  // column with its natural direction (descending where bigger is better).
  const onHeaderClick = (key: SortKey): void => {
    setSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      const defaultDir: SortDir = key === 'wins' || key === 'gd' || key === 'pts' ? 'desc' : 'asc';
      return { key, dir: defaultDir };
    });
  };

  const total = sortedRows.length;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          ...type.small,
          ...numeric,
          width: '100%',
          borderCollapse: 'collapse',
          color: color.text,
        }}
      >
        <thead>
          <tr>
            {cols.map((c) => {
              const isActive = c.sortable && sort.key === c.key;
              // aria-sort: the active sortable header says its direction,
              // other sortables say 'none', non-sortables omit it.
              const ariaSort = !c.sortable
                ? undefined
                : isActive
                  ? (sort.dir === 'asc' ? 'ascending' : 'descending')
                  : 'none';
              return (
                <th
                  key={c.key}
                  aria-sort={ariaSort}
                  onClick={c.sortable ? () => onHeaderClick(c.key as SortKey) : undefined}
                  style={{
                    ...HEADER,
                    textAlign: c.align,
                    color: isActive ? color.text : color.textSecondary,
                    width: c.width,
                    cursor: c.sortable ? 'pointer' : 'default',
                    userSelect: c.sortable ? 'none' : undefined,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.label}
                  {isActive && (
                    <span aria-hidden="true" style={{ marginLeft: space[4] }}>
                      {sort.dir === 'asc' ? '\u25B4' : '\u25BE'}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <StandingsRowComponent
              key={row.id ?? row.team ?? row.position}
              row={row}
              rank={rankByRow.get(row) ?? String(row.position ?? '')}
              qualifies={total > QUALIFICATION_COUNT && (row.position ?? 0) <= QUALIFICATION_COUNT}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Sort a copy of the rows by the active sort state. Never mutates the input
 * (callers keep the rows in state and memoise on them). The 'pos' sort uses
 * the stamped `position`, so ascending is the league order. Missing values
 * sort last in either direction; equal values fall back to position.
 *
 * @param rows  Rows in table order; not mutated.
 * @param sort  Active column and direction.
 * @returns     A new, sorted array.
 */
function sortRows(rows: StandingsRowData[], sort: SortState): StandingsRowData[] {
  const out = [...rows];
  const dir = sort.dir === 'asc' ? 1 : -1;

  const valueOf = (row: StandingsRowData): number | null => {
    switch (sort.key) {
      case 'pos':    return row.position ?? null;
      case 'played': return row.played   ?? null;
      case 'wins':   return row.wins     ?? null;
      case 'draws':  return row.draws    ?? null;
      case 'loses':  return row.loses    ?? null;
      case 'gd':     return row.gd       ?? null;
      case 'pts':    return row.points   ?? null;
    }
  };

  out.sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    if (av === null && bv === null) return (a.position ?? 0) - (b.position ?? 0);
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av === bv)   return (a.position ?? 0) - (b.position ?? 0);
    return (av - bv) * dir;
  });
  return out;
}

/**
 * One standings row: rank (success colour when it qualifies), crest and
 * club, the numbers, the form strip and points.
 */
function StandingsRowComponent({ row, rank, qualifies }: { row: StandingsRowData; rank: string; qualifies: boolean }) {
  const name = row.team ?? row.club ?? '\u2014';
  const crest = <Crest color={row.id ? TEAM_COLOR.get(row.id) ?? null : null} size={16} />;
  return (
    <tr>
      <td style={{ ...cellLeft, fontWeight: 700, color: qualifies ? color.success : color.textSecondary }}>
        {rank}
      </td>
      <td style={{ ...cellLeft, fontWeight: 700 }}>
        {row.team_link ? (
          <Link
            to={row.team_link}
            style={{ display: 'inline-flex', alignItems: 'center', gap: space[8], color: color.text, textDecoration: 'none' }}
          >
            {crest}
            <span>{name}</span>
          </Link>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[8] }}>
            {crest}
            {name}
          </span>
        )}
      </td>
      <td style={cellRight}>{row.played ?? 0}</td>
      <td style={cellRight}>{row.wins   ?? 0}</td>
      <td style={cellRight}>{row.draws  ?? 0}</td>
      <td style={cellRight}>{row.loses  ?? 0}</td>
      <td style={cellRight}>{formatGd(row.gd)}</td>
      <td style={cellLeft}>
        <FormStrip form={row.form} />
      </td>
      <td style={{ ...cellRight, fontWeight: 700 }}>{row.points ?? 0}</td>
    </tr>
  );
}

/**
 * Goal difference with an explicit `+` for positive values; a missing value
 * is "—" so pre-season rows do not claim 0.
 */
function formatGd(gd: number | null | undefined): string {
  if (gd === null || gd === undefined) return '\u2014';
  if (gd === 0) return '0';
  return gd > 0 ? `+${gd}` : `${gd}`;
}

/**
 * FORM_PIP_COUNT result tiles, most recent first; missing results are a
 * faint "—" so the column width is the same on every row.
 */
function FormStrip({ form }: { form?: FormResult[] | undefined }) {
  const items = [];
  for (let i = 0; i < FORM_PIP_COUNT; i++) {
    const result = Array.isArray(form) ? form[i] : undefined;
    items.push(<FormPip key={i} result={result} />);
  }
  return <span style={{ display: 'inline-flex', gap: space[4] }}>{items}</span>;
}

/**
 * One form tile:
 *   W → success border and letter (a good outcome)
 *   D → line border, secondary letter
 *   L → line border, tertiary letter (never red: red means live or error)
 *   none → faint border, tertiary "—"
 */
function FormPip({ result }: { result?: FormResult | undefined }) {
  const look: CSSProperties =
    result === 'W' ? { ...hairline(color.success), color: color.success } :
    result === 'D' ? { ...hairline(color.line), ...tone.secondary } :
    result === 'L' ? { ...hairline(color.line), ...tone.tertiary } :
                     { ...hairline(color.lineFaint), ...tone.tertiary };
  return (
    <span
      style={{
        ...type.label,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width:  FORM_PIP_SIZE,
        height: FORM_PIP_SIZE,
        lineHeight: 1,
        ...look,
      }}
    >
      {result ?? '\u2014'}
    </span>
  );
}

// Memoised: a standings fetch for one league does not re-render tables
// whose rows have not changed.
export default memo(StandingsTable);
