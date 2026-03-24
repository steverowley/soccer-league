// ── MatchComponents.jsx ───────────────────────────────────────────────────────
// Shared UI primitives for the ISL match simulator.
//
// Styling approach: inline styles throughout.  These components are rendered
// inside App.jsx (the MatchSimulator), which itself uses inline styles because
// many values are computed at runtime (team colours, chaos percentages, etc.).
// Using inline styles here keeps the styling approach consistent and avoids the
// CSS-cascade conflict where the ISL global reset (* { padding: 0; margin: 0 })
// sits in the unlayered cascade and overrides Tailwind @layer utilities.
//
// Constant shorthands imported from constants.js:
//   C      — ISL colour palette  (C.abyss, C.ash, C.dust, C.purple, C.red, C.green)
//   bdr    — helper that builds { backgroundColor, border, color } style objects
//   PERS   — personality key constants
//   PERS_ICON — maps personality key → emoji

import { useState, useEffect } from "react";
import { C, bdr, PERS, PERS_ICON } from "../constants.js";
import { COMMENTATOR_PROFILES } from "../agents.js";

// ── Stat ──────────────────────────────────────────────────────────────────────

/**
 * Horizontal stat bar comparing a home value against an away value.
 * Used in league/team detail pages to render attacking, defensive, etc. stats.
 *
 * @param {{ label: string, a: number, b: number, homeColor: string, awayColor: string }} props
 * @returns {JSX.Element}
 */
export const Stat = ({ label, a, b, homeColor, awayColor }) => (
  <div style={{ border: `1px solid rgba(227,224,213,0.2)` }}>
    <div style={{ fontSize: '11px', textAlign: 'center', padding: '4px', opacity: 0.6 }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '0 8px 8px' }}>
      <span style={{ fontSize: '14px', fontWeight: 700, color: homeColor }}>{a}</span>
      <div style={{ flex: 1, height: '6px', backgroundColor: C.abyss }}>
        <div style={{ height: '100%', width: `${typeof a === 'number' ? a : 50}%`, backgroundColor: homeColor }} />
      </div>
      <span style={{ fontSize: '14px', fontWeight: 700, color: awayColor }}>{b}</span>
    </div>
  </div>
);

// ── PlayerRow ─────────────────────────────────────────────────────────────────

/**
 * Single player row rendered inside the squad panel (On Pitch / Bench sections).
 *
 * Visual states:
 *   Active (on pitch)  — full opacity, name tinted in team colour, clickable to
 *                        open the PlayerCard detail modal.
 *   Inactive (bench)   — 50 % opacity, default cursor, not interactive.
 *
 * @param {Object}   props
 * @param {Object}   props.player     Player data object (name, position, stats)
 * @param {Object}   props.stats      Live match stats keyed by player name
 * @param {boolean}  props.isActive   True when the player is currently on pitch
 * @param {string}   props.teamColor  Hex team accent colour for name highlight
 * @param {Array}    props.agents     AI agent array for the team (may be null)
 * @param {boolean}  props.isHome     Whether this player belongs to the home team
 * @param {string}   props.teamName   Short team name shown in the PlayerCard modal
 * @param {Function} props.onSelect   Callback invoked with player data when clicked
 * @returns {JSX.Element}
 */
export const PlayerRow = ({ player, stats, isActive, teamColor, agents, isHome, teamName, onSelect }) => {
  const s = stats[player.name] || {};
  const agent = agents?.find(a => a.player.name === player.name);
  const emo = agent?.emotion;
  return (
    <div
      onClick={() => isActive && onSelect({ player, agent, stats: s, teamColor, teamName })}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        borderBottom: '1px solid rgba(227,224,213,0.08)',
        backgroundColor: C.abyss,
        opacity: isActive ? 1 : 0.5,
        cursor: isActive ? 'pointer' : 'default',
      }}
    >
      {/* ── Player name + personality icon ──────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 700, color: isActive ? teamColor : C.dust }}>
          {s.subbedOn ? '🔺 ' : ''}{player.name}
          {PERS_ICON[agent?.personality]
            ? <span style={{ opacity: 0.6 }}>{PERS_ICON[agent.personality]}</span>
            : null}
        </div>
        {/* ── Position + agent state (confidence, fatigue, emotion) ──────── */}
        <div style={{ display: 'flex', gap: '8px', fontSize: '11px', opacity: 0.6, marginTop: '2px' }}>
          <span>{player.position}</span>
          {agent && <span>😊{Math.round(agent.confidence)}% 💨{Math.round(agent.fatigue)}%</span>}
          {emo && emo !== 'neutral' && <span style={{ color: C.purple }}>{emo}</span>}
        </div>
      </div>
      {/* ── Match-event badges: goals, assists, cards, injury ───────────── */}
      <div style={{ display: 'flex', gap: '4px', fontSize: '14px', flexShrink: 0 }}>
        {s.goals   > 0 && <span>⚽{s.goals}</span>}
        {s.assists > 0 && <span>👟{s.assists}</span>}
        {s.saves   > 0 && <span>✋{s.saves}</span>}
        {s.yellowCard  && <span>🟨</span>}
        {s.redCard     && <span>🟥</span>}
        {s.injured     && <span>🏥</span>}
      </div>
    </div>
  );
};

// ── FeedCard ──────────────────────────────────────────────────────────────────

/**
 * Social-feed or player-thought card used in the team panels.
 *
 * @param {{ item: Object, isThought: boolean }} props
 *   item.emoji   — emoji avatar for thought entries
 *   item.user    — display name for social entries
 *   item.minute  — match minute
 *   item.player  — player name (thought entries only)
 *   item.text    — quote text
 *   item.likes   — like count (social entries)
 *   item.retweets — retweet count (social entries)
 * @returns {JSX.Element}
 */
export const FeedCard = ({ item, isThought }) => (
  <div style={{
    padding: '8px',
    borderLeft: `2px solid ${isThought ? C.red : C.purple}`,
    marginBottom: '8px',
    backgroundColor: C.abyss,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
      {isThought
        ? <span style={{ fontSize: '18px' }}>{item.emoji}</span>
        : <span style={{ fontSize: '11px', fontWeight: 700, color: C.purple }}>{item.user}</span>}
      <span style={{ fontSize: '11px', opacity: 0.5 }}>{item.minute}'</span>
    </div>
    {isThought && <span style={{ fontSize: '11px', fontWeight: 700 }}>{item.player}</span>}
    <div style={{ fontSize: '11px', fontStyle: 'italic', marginTop: '4px', opacity: 0.85 }}>"{item.text}"</div>
    {!isThought && (
      <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.5 }}>
        ♥️{item.likes} 🔁{item.retweets}
      </div>
    )}
  </div>
);

// ── AgentCard ─────────────────────────────────────────────────────────────────

/**
 * Compact commentary entry used in the match card feed (compact mode) and in
 * the full commentary panel.
 *
 * Accent colour reflects agent type:
 *   commentator / player_thought / manager → item.color (team colour)
 *   referee                               → gold (#FFD700)
 *   fallback                              → Quantum Purple
 *
 * @param {{ type: string, name: string, role?: string, emoji: string,
 *           color?: string, minute: number, text: string }} item
 * @returns {JSX.Element}
 */
export const AgentCard = ({ item }) => {
  // Derive the accent colour for the left border and name label.
  const borderColor =
    item.type === 'referee'      ? '#FFD700'
    : item.color                 ? item.color
    : C.purple;

  // Human-readable label shown beside the emoji icon.
  const label =
    item.type === 'commentator'    ? `${item.name} • ${item.role}`
    : item.type === 'player_thought' ? `${item.name} (inner thought)`
    : item.type === 'manager'      ? item.name
    : item.type === 'referee'      ? `${item.name} • Referee`
    : 'Agent';

  return (
    <div style={{
      padding: '8px',
      borderLeft: `2px solid ${borderColor}`,
      marginBottom: '8px',
      backgroundColor: C.abyss,
    }}>
      {/* ── Agent header: emoji + name label + timestamp ─────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <span style={{ fontSize: '14px' }}>{item.emoji}</span>
        <span style={{ fontSize: '11px', fontWeight: 700, color: borderColor }}>{label}</span>
        <span style={{ fontSize: '11px', marginLeft: 'auto', opacity: 0.4 }}>{item.minute}'</span>
      </div>
      {/* ── Quote text ───────────────────────────────────────────────────── */}
      {/* ▋ cursor mirrors the full feed view: visible while isStreaming:true,
          removed when the final play_by_play_update clears the flag. */}
      <div style={{ fontSize: '11px', fontStyle: 'italic', opacity: 0.9 }}>"{item.text}{item.isStreaming?'▋':''}"</div>
    </div>
  );
};

// ── ArchitectCard ─────────────────────────────────────────────────────────────
//
// Renders a Proclamation from THE ARCHITECT — the cosmic entity that shapes
// the fate of every player, match, and season in the ISL.  This card has a
// deliberately distinct visual identity from all other feed entries:
//
//   • Near-black (#0D0A14) background to evoke cosmic void
//   • Deep violet animated pulsing border (#7C3AED) — the Architect's colour
//   • Header: 🌌 THE ARCHITECT in small-caps violet
//   • Proclamation text in italic with slightly elevated opacity (readable but
//     ethereal — the Architect speaks in prophecy, not headlines)
//   • Optional sub-line showing featured mortals and the cosmic thread
//
// The keyframe animation (border opacity pulse) is injected once into the
// document head so it can be referenced by the inline borderColor style.
// This is consistent with the rest of the codebase's inline-style approach.

// Inject the pulse keyframe animation once into the document head.
// Guard against duplicate injection in hot-reload environments.
if (typeof document !== 'undefined' && !document.getElementById('architect-pulse-style')) {
  const style = document.createElement('style');
  style.id = 'architect-pulse-style';
  style.textContent = `
    @keyframes architectPulse {
      0%, 100% { box-shadow: 0 0 6px 1px rgba(124,58,237,0.35); }
      50%       { box-shadow: 0 0 14px 3px rgba(124,58,237,0.65); }
    }
  `;
  document.head.appendChild(style);
}

if (typeof document !== 'undefined' && !document.getElementById('architect-interference-style')) {
  const style = document.createElement('style');
  style.id = 'architect-interference-style';
  style.textContent = `
    @keyframes interferenceFlare {
      0%   { opacity: 1; }
      50%  { opacity: 0.85; }
      100% { opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

/**
 * ArchitectCard — feed entry for a Proclamation from THE ARCHITECT.
 *
 * Displayed in the commentary feed whenever CosmicArchitect.maybeUpdate()
 * returns a new proclamation.  Visually distinct from all other cards to
 * signal that this is not a commentator or manager reaction, but a cosmic
 * decree that contextualises the entire match.
 *
 * @param {{ type: string, name: string, emoji: string, color: string,
 *           minute: number, text: string,
 *           narrativeArc?: string, featuredMortals?: string[],
 *           cosmicThread?: string }} item
 * @returns {JSX.Element}
 */
export const ArchitectCard = ({ item }) => {
  // The Architect's fixed accent colour.  Defined as a constant here rather
  // than reading item.color so the visual identity is enforced even if the
  // feed item is constructed with a different value.
  const ARCHITECT_COLOR = '#7C3AED';

  return (
    <div style={{
      padding:         '12px',
      marginBottom:    '10px',
      backgroundColor: '#0D0A14',  // near-black cosmic void
      border:          `1px solid ${ARCHITECT_COLOR}`,
      animation:       'architectPulse 3s ease-in-out infinite',
      // Slightly wider left accent than AgentCard to reinforce authority.
      borderLeft:      `3px solid ${ARCHITECT_COLOR}`,
    }}>

      {/* ── Header: entity identity + minute ──────────────────────────────── */}
      <div style={{
        display:       'flex',
        alignItems:    'center',
        gap:           '8px',
        marginBottom:  '8px',
      }}>
        <span style={{ fontSize: '16px' }}>{item.emoji}</span>
        <span style={{
          fontSize:      '10px',
          fontWeight:    700,
          letterSpacing: '0.12em',
          // Small-caps via text-transform — matches the "cosmically ancient"
          // aesthetic without requiring a special font.
          textTransform: 'uppercase',
          color:         ARCHITECT_COLOR,
        }}>
          The Architect
        </span>
        <span style={{ fontSize: '10px', marginLeft: 'auto', opacity: 0.4 }}>
          {item.minute}'
        </span>
      </div>

      {/* ── Proclamation text ─────────────────────────────────────────────── */}
      {/* Italic to signal prophecy / cosmic speech; slightly brighter than
          AgentCard text (opacity 0.95 vs 0.9) because the Architect's words
          must be readable even in the darkest background. */}
      <div style={{
        fontSize:    '12px',
        fontStyle:   'italic',
        lineHeight:  '1.5',
        color:       '#E2D9F3',  // muted lavender — readable on void background
        marginBottom: item.featuredMortals?.length || item.cosmicThread ? '8px' : 0,
      }}>
        "{item.text}"
      </div>

      {/* ── Supplementary lore line ───────────────────────────────────────── */}
      {/* Shows featured mortals and the cosmic thread so the reader can see
          whose fate is being shaped and why this match matters cosmically.
          Hidden when neither field is populated (e.g. early first proclamation). */}
      {(item.featuredMortals?.length > 0 || item.cosmicThread) && (
        <div style={{
          fontSize:  '10px',
          opacity:   0.55,
          borderTop: `1px solid rgba(124,58,237,0.25)`,
          paddingTop: '6px',
          display:   'flex',
          flexDirection: 'column',
          gap:       '2px',
        }}>
          {item.featuredMortals?.length > 0 && (
            <span>
              ✦ Mortals in focus:{' '}
              <span style={{ color: ARCHITECT_COLOR }}>
                {item.featuredMortals.join(' · ')}
              </span>
            </span>
          )}
          {item.cosmicThread && (
            <span>✦ Thread: {item.cosmicThread}</span>
          )}
        </div>
      )}
    </div>
  );
};

// ── ArchitectInterferenceCard ─────────────────────────────────────────────────

/**
 * ArchitectInterferenceCard — feed entry for a direct Interference action by
 * THE ARCHITECT (as opposed to a Proclamation, which is narrative commentary).
 *
 * Interference actions have mechanical effects on the match state (e.g. annulling
 * a goal, cursing a player, forcing a red card).  This card surfaces those events
 * in the commentary feed with:
 *   • A per-category accent colour that signals the nature of the interference
 *     (red = destructive/annul, purple = conjured/grant, amber = curse, etc.)
 *   • A border style that further encodes category (dashed = annulment/removal,
 *     dotted = time/momentum manipulation, solid = all others)
 *   • A brief entry flare — the box-shadow blooms then fades over 2.5 s so the
 *     card catches the reader's eye without persistent distraction
 *   • An optional annulment notice rendered when interferenceType === 'annul_goal'
 *     and an annulMinute is present, surfacing exactly which goal was struck out
 *
 * The component is intentionally self-contained: accent and border lookups live
 * inside the component so it can be dropped into any feed without external context.
 *
 * @param {{ item: {
 *   interferenceType: string,  // snake_case key from CATEGORY_ACCENT / BORDER_STYLE
 *   emoji: string,             // visual icon for the interference type
 *   subtitle?: string,         // optional human-readable subtitle; falls back to interferenceType
 *   minute: number,            // match minute at which the interference occurred
 *   text: string,              // The Architect's proclamation / flavour text
 *   targetPlayer?: string,     // name of the mortal targeted by this interference
 *   targetTeam?: string,       // team of the targeted player (optional clarifier)
 *   annulMinute?: number,       // minute of the goal being annulled (annul_goal only)
 *   annulPlayer?: string,      // scorer of the annulled goal (annul_goal only)
 * }}} props
 * @returns {JSX.Element}
 */
export const ArchitectInterferenceCard = ({ item }) => {
  // flared starts true so the card opens with a vivid box-shadow bloom,
  // then the effect is cut off after 2 500 ms via the transition (2.5 s ease-out).
  const [flared, setFlared] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setFlared(false), 2500);
    return () => clearTimeout(t);
  }, []);

  // Per-category accent colours — each colour group encodes the nature of the
  // interference so readers can parse the feed at a glance:
  //   Red (#B91C1C)    — destructive / annulment / removal actions
  //   Purple (#9333EA) — conjured / granted / forced actions
  //   Amber (#F59E0B)  — curses and possession manipulation
  //   Green (#10B981)  — blessings and beneficial effects
  //   Cyan (#06B6D4)   — resurrection / revival effects
  //   Pink (#EC4899)   — reality-warping / dimensional effects
  //   Sky (#0EA5E9)    — time and momentum manipulation
  //   Orange (#F97316) — score amplification and reversal effects
  //   Violet (#7C3AED) — eldritch / cosmic / void effects (default)
  //   Slate (#64748B)  — architect-boredom (neutral / passive)
  //   Crimson (#DC2626)— architect-tantrum (heightened destruction)
  const CATEGORY_ACCENT = {
    annul_goal: '#B91C1C', annul_red_card: '#B91C1C', annul_yellow_card: '#B91C1C',
    steal_goal: '#B91C1C', score_reset: '#B91C1C', score_mirror: '#B91C1C',
    grant_goal: '#9333EA', force_red_card: '#9333EA', force_injury: '#9333EA',
    lucky_penalty: '#9333EA',
    curse_player: '#F59E0B', mass_curse: '#F59E0B', possession: '#F59E0B',
    bless_player: '#10B981',
    resurrect_player: '#06B6D4',
    dimension_shift: '#EC4899', identity_swap: '#EC4899', player_swap: '#EC4899',
    keeper_paralysis: '#EC4899', phantom_foul: '#EC4899', cosmic_own_goal: '#EC4899',
    goalkeeper_swap: '#EC4899',
    add_stoppage: '#0EA5E9', momentum_vacuum: '#0EA5E9', time_rewind: '#0EA5E9',
    goal_drought: '#0EA5E9', commentary_void: '#0EA5E9',
    echo_goal: '#F97316', double_goals: '#F97316', reversal_of_fortune: '#F97316',
    score_amplifier: '#F97316', equalizer_decree: '#F97316', talent_drain: '#F97316',
    prophecy_reset: '#F97316',
    eldritch_portal: '#7C3AED', void_creature: '#7C3AED', gravity_flip: '#7C3AED',
    cosmic_weather: '#7C3AED', pitch_collapse: '#7C3AED', formation_override: '#7C3AED',
    architect_boredom: '#64748B', architect_tantrum: '#DC2626',
    architect_amusement: '#10B981', architect_sabotage: '#F59E0B',
  };

  // Border style encodes the mechanical category:
  //   dashed — annulment / removal (something is being struck out)
  //   dotted — time / momentum manipulation (flow of the match is disrupted)
  //   solid  — all other interference types (default)
  const BORDER_STYLE = {
    annul_goal: 'dashed', annul_red_card: 'dashed', annul_yellow_card: 'dashed',
    steal_goal: 'dashed', score_reset: 'dashed', score_mirror: 'dashed',
    add_stoppage: 'dotted', momentum_vacuum: 'dotted', time_rewind: 'dotted',
    goal_drought: 'dotted', commentary_void: 'dotted',
  };

  const accent = CATEGORY_ACCENT[item.interferenceType] || '#7C3AED';
  const borderStyle = BORDER_STYLE[item.interferenceType] || 'solid';

  return (
    <div style={{
      padding: '13px',
      marginBottom: '10px',
      backgroundColor: `rgba(0,0,0,0.6)`,
      border: `1px ${borderStyle} ${accent}`,
      borderLeft: `4px ${borderStyle} ${accent}`,
      // Box-shadow fades from a vivid bloom (entry flare) to a subtle ambient
      // glow over 2.5 s.  The transition provides the ease-out; the flared flag
      // switches the target value once the timeout fires.
      boxShadow: flared ? `0 0 20px 5px ${accent}55` : `0 0 6px 1px ${accent}33`,
      transition: 'box-shadow 2.5s ease-out',
    }}>
      {/* Header row: emoji icon, label stack (type + subtitle), and match minute */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' }}>
        <span style={{ fontSize: '16px' }}>{item.emoji}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <span style={{
            fontSize: '9px', fontWeight: 700, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: accent,
          }}>
            THE ARCHITECT — INTERFERENCE
          </span>
          <span style={{
            fontSize: '9px', letterSpacing: '0.10em', textTransform: 'uppercase',
            color: accent, opacity: 0.7,
          }}>
            {item.subtitle || (item.interferenceType || '').replace(/_/g, ' ').toUpperCase()}
          </span>
        </div>
        <span style={{ fontSize: '10px', marginLeft: 'auto', opacity: 0.4 }}>{item.minute}'</span>
      </div>

      {/* Target line — only rendered when a specific mortal is singled out */}
      {item.targetPlayer && (
        <div style={{
          fontSize: '10px', marginBottom: '6px', color: accent,
          opacity: 0.85, letterSpacing: '0.04em',
        }}>
          ✦ Mortal: {item.targetPlayer}
          {item.targetTeam && ` (${item.targetTeam})`}
        </div>
      )}

      {/* Proclamation / flavour text delivered by The Architect */}
      <div style={{
        fontSize: '12px', fontStyle: 'italic', lineHeight: '1.55',
        color: '#E2D9F3', marginBottom: 0,
      }}>
        "{item.text}"
      </div>

      {/* Annulment notice — only shown for annul_goal with a known annulMinute,
          clearly surfacing which goal has been struck from the record */}
      {item.interferenceType === 'annul_goal' && item.annulMinute && (
        <div style={{
          fontSize: '10px', padding: '4px 8px', marginTop: '6px',
          backgroundColor: `rgba(185,28,28,0.12)`, border: `1px solid rgba(185,28,28,0.3)`,
          color: '#FCA5A5', letterSpacing: '0.06em',
        }}>
          ✕ ANNULLED — goal at min {item.annulMinute}{item.annulPlayer ? ` (${item.annulPlayer})` : ''}
        </div>
      )}
    </div>
  );
};

// ── ApiKeyModal ───────────────────────────────────────────────────────────────

/**
 * Full-screen modal for entering and testing an Anthropic API key.
 * The key is persisted to localStorage and never sent to any server.
 *
 * @param {{ apiKey: string, setApiKey: Function, setShowApiKeyModal: Function }} props
 * @returns {JSX.Element}
 */
export const ApiKeyModal = ({ apiKey, setApiKey, setShowApiKeyModal }) => {
  const [draft, setDraft] = useState(apiKey);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const save = () => {
    localStorage.setItem('isi_api_key', draft);
    setApiKey(draft);
    setShowApiKeyModal(false);
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: draft, dangerouslyAllowBrowser: true });
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      });
      setTestResult('✅ Connected!');
    } catch (e) {
      const msg = e?.message || String(e);
      console.error('API test error:', e);
      if (msg.includes('401') || msg.toLowerCase().includes('authentication') || msg.toLowerCase().includes('api key'))
        setTestResult('❌ Invalid key — check console.anthropic.com');
      else if (msg.includes('403'))
        setTestResult('❌ Permission denied — check key permissions');
      else
        setTestResult('❌ ' + msg);
    }
    setTesting(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px', backgroundColor: 'rgba(0,0,0,0.92)',
    }}>
      <div style={{ width: '100%', maxWidth: '448px', border: `1px solid ${C.purple}`, backgroundColor: C.ash, padding: '24px' }}>

        <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '4px', color: C.purple }}>⚙️ AGENT CONFIGURATION</h2>
        <p style={{ fontSize: '11px', opacity: 0.6, marginBottom: '16px' }}>
          Paste your Anthropic API key to enable LLM-powered agents.
          Your key is stored in <code>localStorage</code> and never leaves your browser.
        </p>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px', color: C.purple }}>
            ANTHROPIC API KEY
          </label>
          <input
            type="password"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="sk-ant-..."
            style={{
              width: '100%', padding: '12px', border: `1px solid ${C.dust}`,
              fontSize: '13px', fontFamily: "'Space Mono', monospace",
              backgroundColor: C.abyss, color: C.dust,
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
          <button
            onClick={test}
            disabled={testing || !draft}
            style={{
              padding: '8px 16px', border: `1px solid ${C.dust}`, fontSize: '13px',
              fontFamily: "'Space Mono', monospace", backgroundColor: C.abyss,
              color: C.dust, cursor: testing || !draft ? 'not-allowed' : 'pointer',
              opacity: testing || !draft ? 0.5 : 1,
            }}
          >
            {testing ? 'Testing...' : 'Test Key'}
          </button>
        </div>

        {testResult && (
          <div style={{
            marginBottom: '12px', padding: '8px', border: `1px solid ${testResult.startsWith('✅') ? '#00cc66' : C.red}`,
            fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all',
            color: testResult.startsWith('✅') ? '#00cc66' : C.red,
            backgroundColor: C.abyss,
          }}>
            {testResult}
          </div>
        )}

        {/* ── Active agent list ────────────────────────────────────────────── */}
        <div style={{ marginBottom: '16px', padding: '12px', border: `1px solid rgba(227,224,213,0.2)`, backgroundColor: C.abyss }}>
          <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '8px', color: C.purple }}>ACTIVE AGENTS</div>
          {COMMENTATOR_PROFILES.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', fontSize: '11px' }}>
              <span>{p.emoji}</span>
              <span style={{ color: p.color }}>{p.name}</span>
              <span style={{ opacity: 0.5 }}>— {p.role}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', fontSize: '11px' }}>
            <span>🧑‍💼</span><span>Managers</span><span style={{ opacity: 0.5 }}>— Touchline reactions</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', fontSize: '11px' }}>
            <span>⚖️</span><span>Referee</span><span style={{ opacity: 0.5 }}>— Decision explanations</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
            <span>💭</span><span>Players</span><span style={{ opacity: 0.5 }}>— Inner monologue</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={save}
            disabled={!draft}
            style={{
              flex: 1, padding: '8px', fontWeight: 700, border: `1px solid ${C.purple}`,
              fontFamily: "'Space Mono', monospace", fontSize: '13px',
              backgroundColor: C.purple, color: C.abyss,
              cursor: !draft ? 'not-allowed' : 'pointer', opacity: !draft ? 0.5 : 1,
            }}
          >
            SAVE &amp; ENABLE AGENTS
          </button>
          <button
            onClick={() => setShowApiKeyModal(false)}
            style={{
              padding: '8px 16px', border: `1px solid rgba(227,224,213,0.3)`,
              fontFamily: "'Space Mono', monospace", fontSize: '13px',
              backgroundColor: C.abyss, color: C.dust, cursor: 'pointer',
            }}
          >
            CANCEL
          </button>
        </div>

        {apiKey && (
          <button
            onClick={() => { localStorage.removeItem('isi_api_key'); setApiKey(''); setShowApiKeyModal(false); }}
            style={{
              marginTop: '8px', width: '100%', padding: '4px', fontSize: '11px',
              border: `1px solid ${C.red}`, color: C.red,
              fontFamily: "'Space Mono', monospace", backgroundColor: C.abyss, cursor: 'pointer',
            }}
          >
            CLEAR KEY &amp; DISABLE AGENTS
          </button>
        )}
      </div>
    </div>
  );
};

// ── PlayerCard ────────────────────────────────────────────────────────────────

/**
 * Slide-up player detail modal.  Shown when a player row is clicked in the
 * squad panel.  Displays attributes, current match stats, and match events
 * involving the player.  Clicking the backdrop or the × button closes it.
 *
 * @param {{ sp: Object|null, events: Array, onClose: Function }} props
 *   sp.player    — player data object
 *   sp.agent     — AI agent object (may be null)
 *   sp.stats     — live match stats for this player
 *   sp.teamColor — hex accent colour
 *   sp.teamName  — short team name
 * @returns {JSX.Element|null}
 */
export const PlayerCard = ({ sp, events, onClose }) => {
  if (!sp) return null;
  const { player, agent, stats, teamColor, teamName } = sp;
  const s = stats || {};
  const evts = events.filter(e => e.player === player.name || e.assister === player.name);

  // Personality trait descriptions shown in the card header quote.
  const DESC = {
    [PERS.SEL]:  "Glory hunter. Shoots from everywhere, passes to nobody.",
    [PERS.TEAM]: "The glue. Always finds the open man.",
    [PERS.AGG]:  "Leaves a mark — on opponents and the ref.",
    [PERS.CAU]:  "Reads the game. Never panics, rarely impresses.",
    [PERS.CRE]:  "Unpredictable genius or costly showboat.",
    [PERS.LAZ]:  "Tremendous talent. Questionable work rate.",
    [PERS.WRK]:  "Will run through a wall. Then run through it again.",
    [PERS.BAL]:  "Solid. Dependable. Forgettable in the best way.",
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: '16px', backgroundColor: 'rgba(0,0,0,0.85)',
      }}
      onClick={onClose}
    >
      <div
        style={{ width: '100%', maxWidth: '384px', border: `1px solid ${teamColor}`, backgroundColor: C.ash }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header: name + position + close button ───────────────────────── */}
        <div style={{
          padding: '12px', borderBottom: `1px solid ${teamColor}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: teamColor }}>{player.name}</div>
            <div style={{ fontSize: '11px', opacity: 0.6 }}>
              {player.position} &bull; {teamName} {PERS_ICON[agent?.personality] || ''}
            </div>
          </div>
          <button onClick={onClose} style={{ opacity: 0.5, fontSize: '18px', background: 'none', border: 'none', color: C.dust, cursor: 'pointer' }}>&#x2715;</button>
        </div>

        <div style={{ padding: '12px' }}>
          {/* ── Personality quote ─────────────────────────────────────────── */}
          {agent && (
            <div style={{
              marginBottom: '12px', padding: '8px',
              borderLeft: `4px solid ${teamColor}`, backgroundColor: teamColor + '22',
              fontSize: '11px', fontStyle: 'italic',
            }}>
              "{DESC[agent.personality] || 'Plays the game.'}"
            </div>
          )}

          {/* ── Attributes + match stats side by side ─────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            {/* Attributes */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '8px', opacity: 0.6 }}>ATTRIBUTES</div>
              {[['ATK', player.attacking], ['DEF', player.defending], ['TEC', player.technical], ['ATH', player.athletic], ['MEN', player.mental]].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px', fontSize: '11px' }}>
                  <span style={{ width: '28px', opacity: 0.6 }}>{k}</span>
                  <div style={{ flex: 1, height: '6px', backgroundColor: C.abyss }}>
                    <div style={{ height: '100%', width: v + '%', backgroundColor: v > 80 ? teamColor : v > 65 ? C.purple : C.dust }} />
                  </div>
                  <span style={{ width: '20px', textAlign: 'right' }}>{v}</span>
                </div>
              ))}
            </div>

            {/* This match */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '8px', opacity: 0.6 }}>THIS MATCH</div>
              <div style={{ fontSize: '11px' }}>
                {s.goals   > 0 && <div>&#x26BD; {s.goals} goal{s.goals > 1 ? 's' : ''}</div>}
                {s.assists > 0 && <div>&#x1F45F; {s.assists} assist{s.assists > 1 ? 's' : ''}</div>}
                {s.saves   > 0 && <div>&#x270B; {s.saves} save{s.saves > 1 ? 's' : ''}</div>}
                {s.tackles > 0 && <div>&#x1F4AA; {s.tackles} tackle{s.tackles > 1 ? 's' : ''}</div>}
                {s.yellowCard && <div>&#x1F7E8; Booked</div>}
                {s.redCard    && <div>&#x1F7E5; Sent off</div>}
                {s.injured    && <div>&#x1F3E5; Injured</div>}
                {!s.goals && !s.assists && !s.saves && !s.tackles && !s.yellowCard && (
                  <div style={{ opacity: 0.4 }}>Quiet so far</div>
                )}
              </div>
              {agent && (
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid rgba(227,224,213,0.2)`, fontSize: '11px' }}>
                  <div style={{ opacity: 0.6 }}>Conf {Math.round(agent.confidence)}% &bull; Fatigue {Math.round(agent.fatigue)}%</div>
                  {agent.emotion !== 'neutral' && <div style={{ color: teamColor }}>{agent.emotion}</div>}
                </div>
              )}
            </div>
          </div>

          {/* ── Recent match events involving this player ─────────────────── */}
          {evts.length > 0 && (
            <div style={{ borderTop: `1px solid rgba(227,224,213,0.2)`, paddingTop: '8px' }}>
              {evts.slice(-4).map((e, i) => (
                <div key={i} style={{ fontSize: '11px', padding: '2px 0', opacity: 0.7 }}>
                  <span style={{ color: C.purple }}>{e.minute}'</span>{' '}
                  {(e.commentary || '').slice(0, 55)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
