// ── features/match/ui/viewer/PlayerThoughtsPanel.tsx ────────────────────────
// Side panel for the admin match viewer: when a player is clicked, show who they
// are, their engine stats, and their "thoughts" (persona voice + core quotes +
// recent snippets).
//
// ADMIN-ONLY: the game's design pillar hides raw stats from players.  This panel
// is only mounted behind the /admin gate, so showing the composite engine stats
// here is for the maintainer, never a player-facing surface.
//
// COST: all data is pre-stored and public-read (getPlayer + entity persona /
// snippets): no LLM call at click-time.
//
// LOOK (docs/design-language.md): a shared SectionPanel (hairline, no fill),
// type presets and text tones only. The stat bars fill in the default text
// tone on a hairline track (they were purple: purple is kept for the
// Architect and focus), square, as every bar in the system is.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

import { color, numeric, space, tone, type } from '../../../../shared/design';
import { SectionPanel } from '../../../../shared/ui';
import { usePublicReadClient } from '../../../../shared/supabase/SupabaseProvider';
import {
  getPersona,
  listSnippetsForEntity,
  type PersonaRow,
  type SnippetRow,
} from '@features/agents';
import { getPlayer } from '../../api/players';

/** Full-word labels for the two-letter position codes. */
const POSITION_LABEL: Record<string, string> = {
  GK: 'Goalkeeper',
  DF: 'Defender',
  MF: 'Midfielder',
  FW: 'Forward',
};

/** The composite engine stats we surface (admin view), with display labels. */
const STAT_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'attacking', label: 'Attacking' },
  { key: 'defending', label: 'Defending' },
  { key: 'mental', label: 'Mental' },
  { key: 'athletic', label: 'Athletic' },
  { key: 'technical', label: 'Technical' },
];

/**
 * Small uppercase heading inside the panel: the label type, secondary tone.
 * A function so the preset spread is not a top-level side effect (which
 * would keep this module in the entry bundle via the match barrel).
 */
function heading(): CSSProperties {
  return { ...type.label, ...tone.secondary, margin: 0, marginBottom: space[8] };
}

/** What we resolve for a selected player. */
interface PlayerInspect {
  name: string;
  position: string | null;
  age: number | null;
  nationality: string | null;
  personality: string | null;
  overall: number | null;
  stats: Record<string, number | null>;
  persona: PersonaRow | null;
  snippets: SnippetRow[];
}

/** Read a possibly-unknown row field as a number, else null. */
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

/** Read a possibly-unknown row field as a string, else null. */
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * Inspect panel for a clicked player.  Renders an empty hint when nothing is
 * selected, a loading state while fetching, then the player's identity, engine
 * stats, and pre-stored "thoughts".
 *
 * @param props.playerId  The selected player's id, or null when none is selected.
 */
export function PlayerThoughtsPanel({ playerId }: { playerId: string | null }) {
  const publicDb = usePublicReadClient();
  const [data, setData] = useState<PlayerInspect | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!playerId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear panel state when nothing is selected
      setData(null);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const player = await getPlayer(publicDb, playerId);
        const entityId = strOrNull((player as Record<string, unknown>).entity_id);
        // Persona + snippets are optional: a player may have no entity yet.
        const [persona, snippets] = entityId
          ? await Promise.all([
              getPersona(publicDb, entityId).catch(() => null),
              listSnippetsForEntity(publicDb, entityId).catch(() => [] as SnippetRow[]),
            ])
          : [null, [] as SnippetRow[]];
        if (cancelled) return;
        const row = player as Record<string, unknown>;
        setData({
          name: strOrNull(row.name) ?? 'Unknown player',
          position: strOrNull(row.position),
          age: numOrNull(row.age),
          nationality: strOrNull(row.nationality),
          personality: strOrNull(row.personality),
          overall: numOrNull(row.overall_rating),
          stats: Object.fromEntries(STAT_FIELDS.map((s) => [s.key, numOrNull(row[s.key])])),
          persona,
          snippets,
        });
        setLoading(false);
      } catch {
        if (cancelled) return;
        setData(null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicDb, playerId]);

  // ── Empty / loading states ────────────────────────────────────────────────
  if (!playerId) {
    return (
      <Shell>
        <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>
          Click a player on the pitch to inspect their stats and thoughts.
        </p>
      </Shell>
    );
  }
  if (loading || !data) {
    return (
      <Shell>
        <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>
          {loading ? 'Loading…' : 'No data.'}
        </p>
      </Shell>
    );
  }

  const positionLabel = data.position ? (POSITION_LABEL[data.position] ?? data.position) : null;
  const coreQuotes = (data.persona?.core_quotes ?? []).slice(0, 2);
  const recentSnippets = [...data.snippets]
    .sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1))
    .slice(0, 6);

  return (
    <Shell>
      {/* Identity */}
      <div style={{ marginBottom: space[16] }}>
        <div style={{ ...type.subheading, overflowWrap: 'anywhere' }}>{data.name}</div>
        <div style={{ ...type.small, ...tone.secondary, marginTop: space[4] }}>
          {[positionLabel, data.age != null ? `age ${data.age}` : null, data.nationality]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {data.personality && (
          <div style={{ ...type.small, ...tone.primary, marginTop: space[4] }}>{data.personality}</div>
        )}
      </div>

      {/* Engine stats (admin) */}
      <h3 style={heading()}>Engine stats <span style={tone.tertiary}>· admin view</span></h3>
      <div style={{ marginBottom: space[16] }}>
        {STAT_FIELDS.map((s) => (
          <StatBar key={s.key} label={s.label} value={data.stats[s.key] ?? null} />
        ))}
        {data.overall != null && (
          <div style={{ ...type.small, ...tone.secondary, marginTop: space[8] }}>
            Overall rating {data.overall}
          </div>
        )}
      </div>

      {/* Thoughts */}
      <h3 style={heading()}>Thoughts</h3>
      {data.persona?.voice_paragraph ? (
        <p style={{ ...type.small, ...tone.secondary, fontStyle: 'italic', margin: 0, marginBottom: space[12] }}>
          {data.persona.voice_paragraph}
        </p>
      ) : null}
      {coreQuotes.map((q, i) => (
        <p
          key={`q${i}`}
          style={{
            ...type.small,
            ...tone.primary,
            margin: 0,
            marginBottom: space[8],
            paddingLeft: space[12],
            borderLeft: `1px solid ${color.line}`,
          }}
        >
          “{q}”
        </p>
      ))}
      {recentSnippets.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, marginTop: space[8] }}>
          {recentSnippets.map((s) => (
            <li key={s.id} style={{ marginBottom: space[8] }}>
              <div style={{ ...type.label, ...tone.tertiary }}>
                {s.kind}{s.mood ? ` · ${s.mood}` : ''}
              </div>
              <div style={{ ...type.small, ...tone.secondary }}>{s.text}</div>
            </li>
          ))}
        </ul>
      ) : (
        !data.persona?.voice_paragraph &&
        coreQuotes.length === 0 && (
          <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>No recorded thoughts yet.</p>
        )
      )}
    </Shell>
  );
}

/** The panel frame: the shared hairline SectionPanel, filling its column. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <SectionPanel title="Player" padding={space[16]} style={{ height: '100%', boxSizing: 'border-box', overflowY: 'auto' }}>
      {children}
    </SectionPanel>
  );
}

/** A labelled 0–99 stat bar. */
function StatBar({ label, value }: { label: string; value: number | null }) {
  const pct = value != null ? Math.max(0, Math.min(100, (value / 99) * 100)) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: space[8], marginBottom: space[4] }}>
      <div style={{ ...type.small, ...tone.secondary, width: 88, flex: 'none' }}>{label}</div>
      <div style={{ flex: 1, height: 6, background: color.line, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color.text }} />
      </div>
      <div style={{ ...type.small, ...numeric, ...tone.primary, width: 24, textAlign: 'right', flex: 'none' }}>
        {value ?? '—'}
      </div>
    </div>
  );
}
