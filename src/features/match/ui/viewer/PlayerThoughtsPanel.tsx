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
// snippets) — no LLM call at click-time.

import { useEffect, useState, type ReactNode } from 'react';

import { COLORS } from '../../../../components/Layout';
import { useSupabase } from '../../../../shared/supabase/SupabaseProvider';
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
  const db = useSupabase();
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
        const player = await getPlayer(db, playerId);
        const entityId = strOrNull((player as Record<string, unknown>).entity_id);
        // Persona + snippets are optional — a player may have no entity yet.
        const [persona, snippets] = entityId
          ? await Promise.all([
              getPersona(db, entityId).catch(() => null),
              listSnippetsForEntity(db, entityId).catch(() => [] as SnippetRow[]),
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
  }, [db, playerId]);

  // ── Empty / loading states ────────────────────────────────────────────────
  if (!playerId) {
    return (
      <Shell>
        <p style={{ color: COLORS.dust50, fontSize: 13, margin: 0, lineHeight: 1.6 }}>
          Click a player on the pitch to inspect their stats and thoughts.
        </p>
      </Shell>
    );
  }
  if (loading || !data) {
    return (
      <Shell>
        <p style={{ color: COLORS.dust50, fontSize: 13, margin: 0 }}>
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
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.dust }}>{data.name}</div>
        <div style={{ fontSize: 12, color: COLORS.dust50, marginTop: 2 }}>
          {[positionLabel, data.age != null ? `age ${data.age}` : null, data.nationality]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {data.personality && (
          <div style={{ fontSize: 12, color: COLORS.quantum, marginTop: 4 }}>{data.personality}</div>
        )}
      </div>

      {/* Engine stats (admin) */}
      <SectionLabel>Engine stats <span style={{ color: COLORS.dust50 }}>· admin view</span></SectionLabel>
      <div style={{ marginBottom: 14 }}>
        {STAT_FIELDS.map((s) => (
          <StatBar key={s.key} label={s.label} value={data.stats[s.key] ?? null} />
        ))}
        {data.overall != null && (
          <div style={{ fontSize: 11, color: COLORS.dust50, marginTop: 6 }}>
            Overall rating {data.overall}
          </div>
        )}
      </div>

      {/* Thoughts */}
      <SectionLabel>Thoughts</SectionLabel>
      {data.persona?.voice_paragraph ? (
        <p style={{ fontSize: 13, color: COLORS.dust70, fontStyle: 'italic', lineHeight: 1.6, margin: '0 0 10px' }}>
          {data.persona.voice_paragraph}
        </p>
      ) : null}
      {coreQuotes.map((q, i) => (
        <p key={`q${i}`} style={{ fontSize: 13, color: COLORS.dust, margin: '0 0 8px', paddingLeft: 10, borderLeft: `2px solid ${COLORS.hairline}` }}>
          “{q}”
        </p>
      ))}
      {recentSnippets.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0' }}>
          {recentSnippets.map((s) => (
            <li key={s.id} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: COLORS.dust50 }}>
                {s.kind}{s.mood ? ` · ${s.mood}` : ''}
              </div>
              <div style={{ fontSize: 13, color: COLORS.dust70, lineHeight: 1.5 }}>{s.text}</div>
            </li>
          ))}
        </ul>
      ) : (
        !data.persona?.voice_paragraph &&
        coreQuotes.length === 0 && (
          <p style={{ fontSize: 13, color: COLORS.dust50, margin: 0 }}>No recorded thoughts yet.</p>
        )
      )}
    </Shell>
  );
}

/** Bordered container matching the viewer's chrome. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        border: `1px solid ${COLORS.hairline}`,
        background: COLORS.phobosAsh,
        padding: 14,
        boxSizing: 'border-box',
        height: '100%',
        overflowY: 'auto',
      }}
    >
      {children}
    </div>
  );
}

/** Small uppercase section heading. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: COLORS.dust50,
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

/** A labelled 0–99 stat bar. */
function StatBar({ label, value }: { label: string; value: number | null }) {
  const pct = value != null ? Math.max(0, Math.min(100, (value / 99) * 100)) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
      <div style={{ width: 70, fontSize: 11, color: COLORS.dust70 }}>{label}</div>
      <div style={{ flex: 1, height: 6, background: COLORS.hairline, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: COLORS.quantum }} />
      </div>
      <div style={{ width: 22, fontSize: 11, color: COLORS.dust, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {value ?? '—'}
      </div>
    </div>
  );
}
