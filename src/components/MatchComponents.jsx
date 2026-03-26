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

import { useState } from "react";
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

  // Each commentator gets a subtly tinted box so voices are visually
  // distinct at a glance rather than blurring into a single text stream.
  //
  // Tinting strategy uses 8-digit CSS hex (RRGGBBAA) which all modern
  // browsers support.  Two layers:
  //   • backgroundColor: borderColor + '12' → ~7 % opacity tint
  //     Gives each voice a faint colour cast without obscuring the text.
  //   • border: 1 px borderColor + '40' → ~25 % opacity outline
  //     Closes the box on all four sides so the card reads as a discrete unit.
  //   • borderLeft: 3 px solid borderColor → full-opacity accent stripe
  //     Keeps the strong visual anchor that identifies the speaker.
  return (
    <div style={{
      padding: '8px 10px',
      border: `1px solid ${borderColor}40`,
      borderLeft: `3px solid ${borderColor}`,
      borderRadius: '3px',
      marginBottom: '6px',
      backgroundColor: `${borderColor}12`,
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
      /* Resting state: barely-there ambient glow — present but not dominant. */
      0%, 100% { box-shadow: 0 0 5px 1px rgba(124,58,237,0.30), 0 0 0 1px rgba(124,58,237,0.10); }
      /* Peak: modest bloom — noticeable but not blinding. */
      50%       { box-shadow: 0 0 14px 4px rgba(124,58,237,0.55), 0 0 24px 8px rgba(124,58,237,0.18); }
    }
  `;
  document.head.appendChild(style);
}

// interferenceFlare keyframe removed — ArchitectInterferenceCard now uses
// the shared architectPulse animation for visual consistency across all
// Architect surfaces (proclamation card, interference card, post-match verdict).

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
  const ARCHITECT_COLOR = '#9D6FFB';  // brighter violet — legible on pure black

  return (
    <div style={{
      padding:         '12px',
      marginBottom:    '10px',
      // Pure black void — deeper than the surrounding card backgrounds so the
      // Architect's card feels like a window into a different plane of existence.
      backgroundColor: '#050308',
      // Subtle radial glow emanating from the left edge where the border is —
      // reinforces the sense that the light source is the Architect themselves.
      backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(124,58,237,0.10) 0%, transparent 65%)',
      border:          `1px solid ${ARCHITECT_COLOR}55`,
      animation:       'architectPulse 3s ease-in-out infinite',
      // 4px left accent (vs 2px on AgentCard) to signal cosmic authority.
      borderLeft:      `4px solid ${ARCHITECT_COLOR}`,
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
          textTransform: 'uppercase',
          color:         ARCHITECT_COLOR,
          // Layered text-shadow: tight inner glow for crispness + wider outer
          // bloom for the "emitting its own light" effect.
          textShadow:    `0 0 8px rgba(124,58,237,0.65), 0 0 16px rgba(124,58,237,0.25)`,
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
 *   interferenceType: string,  // snake_case key from CATEGORY_ACCENT (drives header text colour)
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

  // accent is used only for text labels (header type name, subtitle, target
  // line) so readers can still parse interference category at a glance.
  // The card border and glow are always fixed violet — see container styling.
  const accent = CATEGORY_ACCENT[item.interferenceType] || '#7C3AED';

  return (
    <div style={{
      padding: '13px',
      marginBottom: '10px',
      // Deep void black — same as ArchitectCard so all three Architect surfaces
      // (proclamation, interference, post-match verdict) share one visual identity.
      backgroundColor: '#050308',
      // Fixed violet radial bloom from the left edge — matches ArchitectCard's
      // background treatment exactly, independent of interference category.
      backgroundImage: `radial-gradient(ellipse at 20% 50%, rgba(124,58,237,0.10) 0%, transparent 65%)`,
      // Fixed violet border — same colour (#9D6FFB) as ArchitectCard regardless
      // of interference type.  Category information is conveyed through text
      // labels only, not through border colour.
      border: '1px solid rgba(157,111,251,0.35)',
      borderLeft: '4px solid #9D6FFB',
      // Shared pulse animation — identical to ArchitectCard so all Architect
      // surfaces glow in the same rhythm and colour.
      animation: 'architectPulse 3s ease-in-out infinite',
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

// ── FeedRow ────────────────────────────────────────────────────────────────────

/**
 * A single row in the unified match feed — the Blaseball-style one-liner that
 * makes each event instantly readable without commentator cards or chrome.
 *
 * VISUAL HIERARCHY
 * ────────────────
 * Events are visually ranked so the most important moments stand out:
 *
 *   goals       — highlighted row (team-colour background tint), bold text,
 *                 score badge pill on the right.  The biggest visual treatment.
 *   red_card    — red left-border accent, slightly larger text than routine events.
 *   yellow_card — yellow left-border accent, standard size.
 *   penalty     — orange accent, slightly elevated.
 *   var_review  — purple accent to echo the Architect's colour.
 *   injury      — amber accent.
 *   substitution— neutral grey, italic player names.
 *   commentary  — indented sub-row, italic, smaller — visually subordinate to
 *                 the event it describes.
 *   everything else (shot, foul, corner, etc.) — compact, low opacity.
 *
 * ANNULLED GOALS
 * ──────────────
 * When the Architect annuls a goal (architectAnnulled flag), the row keeps its
 * goal styling but adds a struck-through text decoration and an "ANNULLED"
 * badge — preserving the narrative of what was taken away.
 *
 * @param {{
 *   item: {
 *     minute:            number,
 *     type:              string,    // event type key
 *     isGoal?:           boolean,
 *     cardType?:         'yellow'|'red'|null,
 *     isInjury?:         boolean,
 *     commentary:        string,    // procedurally generated one-liner
 *     team?:             string,    // team shortName
 *     teamColor?:        string,    // hex colour for the scoring/involved team
 *     score?:            [number,number], // current score at the moment of event
 *     architectAnnulled?: boolean,
 *     isStreaming?:       boolean,  // true while LLM is still generating text
 *     text?:              string,   // commentary-type sub-row text
 *     color?:             string,   // commentary-type accent colour
 *     name?:              string,   // commentator name for sub-rows
 *   },
 *   homeTeam: object,  // ms.homeTeam — used to resolve team colour from shortName
 *   awayTeam: object,  // ms.awayTeam
 * }} props
 * @returns {JSX.Element}
 */
export const FeedRow = ({ item, homeTeam, awayTeam }) => {
  // ── Captain Vox commentary card ──────────────────────────────────────────
  // play_by_play items are Captain Vox's LLM-generated narration, one per
  // significant event.  They are rendered as small highlighted cards in the
  // same style as the Nexus-7 / Zara Bloom cards in the right panel — name
  // badge above, coloured left border, italic quote — so all three commentary
  // voices look visually consistent regardless of which panel they appear in.
  //
  // Gold (#FFD700) is used as the Vox accent rather than purple (Architect)
  // or team colours (manager shouts), giving Captain Vox a distinct visual
  // identity as the primary match narrator.
  if (item.type === 'play_by_play') {
    const VOX_COLOR = '#FFD700'; // gold — primary narrator accent
    return (
      <div style={{
        padding: '6px 12px',
        borderLeft: `2px solid ${VOX_COLOR}55`,  // 55 ≈ 33% opacity — present but not overpowering
        backgroundColor: `${VOX_COLOR}07`,        // very subtle gold wash behind the text
        borderBottom: '1px solid rgba(227,224,213,0.05)',
      }}>
        {/* ── Name row: commentator label + minute stamp ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
          <span style={{
            fontSize: '10px',
            fontWeight: 700,
            color: VOX_COLOR,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}>
            {item.name || 'Captain Vox'}
          </span>
          <span style={{ fontSize: '10px', opacity: 0.4 }}>{item.minute}'</span>
        </div>
        {/* ── Commentary text — italic to distinguish from event descriptions ── */}
        <div style={{ fontSize: '11px', fontStyle: 'italic', lineHeight: 1.5 }}>
          {item.text}{item.isStreaming ? '▋' : ''}
        </div>
      </div>
    );
  }

  // ── Resolve event styling from type + flags ───────────────────────────────
  // Each event type maps to:
  //   icon       – emoji shown before the minute stamp
  //   accent     – hex colour for the left-border and text highlights
  //   bgTint     – background tint string (hex + alpha suffix or rgba)
  //   bold       – whether the description text is bold
  //   larger     – whether to use a slightly larger font (12px vs 10px)
  //
  // Goals receive the scoring team's colour so home and away goals are
  // distinguishable at a glance even without reading the text.
  const isHome     = item.team === homeTeam?.shortName;
  const teamColor  = item.teamColor || (isHome ? homeTeam?.color : awayTeam?.color) || C.purple;
  const annulled   = item.architectAnnulled;

  let icon   = '·';
  // Default accent: visible but subdued so routine events don't compete with
  // goals.  Higher alpha (0.45) than the old value (0.2) for legible contrast.
  let accent = 'rgba(227,224,213,0.45)';
  let bgTint = 'transparent';
  let bold   = false;
  let larger = false;

  if (item.isGoal) {
    icon   = '⚽';
    accent = annulled ? 'rgba(185,28,28,0.6)' : teamColor;
    bgTint = annulled ? 'rgba(185,28,28,0.07)' : `${teamColor}18`; // 18 ≈ 9% opacity
    bold   = true;
    larger = true;
  } else if (item.cardType === 'red' || item.type === 'red_card') {
    icon   = '🟥';
    accent = '#E05252';
    bgTint = 'rgba(224,82,82,0.06)';
    larger = true;
  } else if (item.cardType === 'yellow' || item.type === 'yellow_card') {
    icon   = '🟨';
    accent = '#FFD700';
  } else if (item.type === 'penalty' || item.type === 'penalty_awarded') {
    icon   = '⚠️';
    accent = '#F97316';  // orange — distinguishes it from yellows
    larger = true;
  } else if (item.type === 'var' || item.type === 'var_review') {
    icon   = '📺';
    accent = C.purple;   // #9A5CF4 — echoes the Architect's cosmic purple
  } else if (item.isInjury || item.type === 'injury') {
    icon   = '🩹';
    accent = '#F59E0B';  // amber
  } else if (item.type === 'substitution' || item.type === 'sub') {
    icon   = '↕';
    accent = 'rgba(227,224,213,0.35)';
  } else if (item.type === 'shot') {
    // Differentiate shot outcomes: saved vs missed vs post.
    // Accent inherits the default (0.45 alpha) — shots are frequent enough that
    // giving them a stronger colour would overwhelm the feed.
    icon   = item.outcome === 'saved' ? '🧤' : item.outcome === 'post' ? '🏃' : '→';
  } else if (item.type === 'freekick' || item.type === 'corner') {
    icon   = '⚑';
  } else if (item.type === 'team_talk') {
    icon   = '📢';
    accent = teamColor;
  }

  const fontSize = larger ? '12px' : '10px';

  // ── Cosmic event override ─────────────────────────────────────────────────
  // Events flagged architectForced or architectConjured were produced by The
  // Architect's interference rather than normal play.  The in-universe characters
  // don't know the source; to them these are simply inexplicable occurrences.
  //
  // We signal cosmic origin to the viewer via a subtle violet tint and a ✦
  // marker — but we do NOT surface "The Architect" text here.  The commentary
  // strings on these events are already written as mysterious (e.g. "A goal —
  // but from where?"), so the ✦ is the only hint of something beyond the game.
  //
  // We deliberately preserve the normal accent/icon (⚽, 🟥, etc.) so the
  // event reads as a real match event first and a cosmic anomaly second.
  const isCosmicEvent = !!(item.architectForced || item.architectConjured);
  if (isCosmicEvent) {
    // Override the background tint to a faint violet wash regardless of event
    // type — keeps the cosmic card visually distinct from a normal goal/card.
    bgTint = 'rgba(124,58,237,0.07)';
  }

  // ── Score badge (goals only) ──────────────────────────────────────────────
  // When a goal event carries a live `score` array we render a compact badge
  // on the right edge: "2-1" — so the scoreline is visible inline without
  // having to look up at the scoreboard header.
  const scoreBadge = item.isGoal && Array.isArray(item.score) && (
    <span style={{
      marginLeft: 'auto',
      flexShrink: 0,
      fontSize: '10px',
      fontWeight: 700,
      padding: '1px 6px',
      backgroundColor: `${accent}22`,       // 22 ≈ 13% opacity pill
      border: `1px solid ${accent}55`,       // 55 ≈ 33% opacity border
      color: accent,
      letterSpacing: '0.05em',
      textDecoration: annulled ? 'line-through' : 'none',
    }}>
      {item.score[0]}–{item.score[1]}
    </span>
  );

  return (
    <div style={{
      display: 'flex',
      alignItems: 'baseline',
      gap: '6px',
      // Goals: 10px top/bottom to give them visual breathing room.
      // Regular events: 6px — enough to separate rows clearly without
      // making the feed feel sparse when many events arrive in a burst.
      padding: `${larger ? '10px' : '6px'} 12px`,
      borderLeft: `${larger ? '3px' : '2px'} solid ${accent}`,
      // Separator between events — barely visible but prevents rows from
      // merging into a solid block at high event density.
      borderBottom: '1px solid rgba(227,224,213,0.05)',
      backgroundColor: bgTint,
    }}>
      {/* Minute stamp — fixed width so all event texts left-align */}
      <span style={{
        fontSize: '10px',
        fontWeight: 700,
        color: annulled ? '#B91C1C' : accent,
        flexShrink: 0,
        minWidth: '26px',
        // Non-goal minute stamps were at 0.65 opacity — too faint to scan quickly.
      // 0.9 keeps them clearly secondary to goal rows (1.0) while staying readable.
      opacity: item.isGoal ? 1 : 0.9,
      }}>
        {item.minute}'
      </span>

      {/* Event type icon */}
      <span style={{ fontSize: '12px', flexShrink: 0 }}>{icon}</span>

      {/* ✦ Cosmic marker — shown only for architect-forced/conjured events.
          Placed between the icon and description text so it reads as a prefix
          to the event copy rather than a standalone symbol.  Violet glow
          matches the ArchitectCard identity without naming the source. */}
      {isCosmicEvent && (
        <span style={{
          fontSize: '10px',
          flexShrink: 0,
          color: '#9D6FFB',
          textShadow: '0 0 5px rgba(124,58,237,0.5)',
          marginRight: '2px',
        }}>✦</span>
      )}

      {/* Event description text */}
      <span style={{
        fontSize,
        fontWeight: bold ? 700 : 400,
        lineHeight: 1.45,
        flex: 1,
        // Full opacity for all events — previous 0.85 on non-goals was too faint
        // against the dark background.  Visual hierarchy is carried by font size
        // and border weight instead.
        opacity: 1,
        textDecoration: annulled ? 'line-through' : 'none',
        color: item.isGoal ? accent : 'inherit',
      }}>
        {item.commentary || item.text || ''}
        {annulled && (
          <span style={{
            marginLeft: '6px',
            fontSize: '8px',
            padding: '1px 4px',
            border: '1px solid rgba(185,28,28,0.5)',
            color: '#FCA5A5',
            letterSpacing: '0.08em',
            textDecoration: 'none',
            display: 'inline-block',
            verticalAlign: 'middle',
          }}>
            ANNULLED
          </span>
        )}
        {/* ── Secondary context line ───────────────────────────────────────
            Shown only for card events that carry a fouledPlayer field.
            Addresses the viewer's natural question "what was it FOR?" without
            requiring them to parse the commentary string.
            Uses display:block inside the flex span so it sits on its own line
            beneath the main commentary text rather than flowing inline. */}
        {item.fouledPlayer && (item.cardType === 'red' || item.cardType === 'yellow') && (
          <span style={{
            display: 'block',
            marginTop: '3px',
            fontSize: '9px',
            opacity: 0.55,
            letterSpacing: '0.04em',
            textDecoration: 'none',
            color: 'inherit',
          }}>
            Foul on {item.fouledPlayer}
          </span>
        )}
      </span>

      {scoreBadge}
    </div>
  );
};

// ── UnifiedFeed ────────────────────────────────────────────────────────────────

/**
 * The primary match-viewing panel — a single chronological stream of every
 * event and Vox commentary reaction, newest at the top.
 *
 * The primary match-viewing panel — supercedes the removed three-column
 * Nexus / Vox / Zara broadcast booth as the default mode.  The "Pitch Side"
 * view (toggled in App.jsx) shows only player/manager/referee content without
 * this commentary layer.
 *
 * DESIGN INTENT (Blaseball model)
 * ─────────────────────────────────
 * Blaseball's feed was powerful because everything lived in one place.  You
 * never had to decide which column to watch.  Goals, fouls, cards, and
 * commentary all scrolled through the same stream at the same pace.  This
 * component replicates that approach:
 *
 *   • All events from matchState.events[] rendered as FeedRow instances.
 *   • Captain Vox commentary items interleaved as subordinate sub-rows.
 *   • Newest events at the top (newest-first) so the user sees the latest
 *     action without scrolling down.
 *   • Auto-scroll to top whenever new events arrive (via scrollTop = 0).
 *   • A pulsing "● LIVE" indicator while the simulation is running.
 *
 * MERGING EVENTS AND COMMENTARY
 * ──────────────────────────────
 * matchState.events[] is the canonical event log (all raw play events).
 * voxItems is a filtered subset of commentaryFeed (Captain Vox reactions).
 * We interleave them by matching Vox items to the event with the same minute,
 * inserting each Vox item immediately after its corresponding event row so
 * the feed reads: event → reaction, event → reaction.
 *
 * @param {{
 *   events:      object[],   // matchState.events — raw play-by-play events
 *   voxItems:    object[],   // commentaryFeed filtered to captain_vox
 *   homeTeam:    object,     // ms.homeTeam
 *   awayTeam:    object,     // ms.awayTeam
 *   isPlaying:   boolean,    // true while the clock is running
 *   scrollRef:   React.Ref,  // forwarded ref so App.jsx can control scroll
 * }} props
 * @returns {JSX.Element}
 */
export const UnifiedFeed = ({ events, voxItems, homeTeam, awayTeam, isPlaying, scrollRef }) => {
  // ── Build interleaved display list (newest first) ─────────────────────────
  //
  // The key challenge: matchState.events[] and commentaryFeed[] are separate
  // streams.  Multiple events can share the same minute (a foul followed by a
  // free-kick at minute 34), and each Vox item is keyed only by minute — not
  // by event index.  A naïve "attach Vox items to every event at that minute"
  // approach causes each Vox item to repeat once per event at that minute.
  //
  // Correct strategy:
  //   1. Group events by minute (preserving chronological order within each
  //      minute group).
  //   2. For each minute group, emit all event rows first, then emit Vox
  //      sub-rows for that minute exactly once — so commentary always appears
  //      after the last action it describes, never duplicated.
  //   3. Reverse the minute groups so the newest minute is at the top.

  // Step 1: group events by minute, preserving order within each group.
  const byMinute = new Map();
  (events || []).forEach((evt, i) => {
    const m = evt.minute ?? 0;
    if (!byMinute.has(m)) byMinute.set(m, []);
    byMinute.get(m).push({ ...evt, _origIdx: i });
  });

  // Group Vox items by minute for O(1) lookup.
  const voxByMinute = {};
  (voxItems || []).forEach((v, vi) => {
    const m = v.minute ?? 0;
    if (!voxByMinute[m]) voxByMinute[m] = [];
    voxByMinute[m].push({ ...v, _vi: vi });
  });

  // Step 2 + 3: build the flat row list, newest minute first.
  // Sort minute keys descending so the top of the feed is always current.
  const minuteKeys = [...byMinute.keys()].sort((a, b) => b - a);
  const rows = [];
  minuteKeys.forEach(m => {
    const evtsAtMinute = byMinute.get(m);
    // All events at this minute — rendered in chronological sub-order
    // (original index ascending) so within a minute the sequence is preserved.
    evtsAtMinute.forEach((evt, i) => {
      rows.push({ ...evt, _rowType: 'event', _key: `evt-${m}-${evt._origIdx}` });
    });
    // Vox commentary for this minute — emitted exactly once after all events
    // at this minute, preventing the duplication bug where the same Vox line
    // would repeat for every event sharing the minute stamp.
    (voxByMinute[m] || []).forEach((v, vi) => {
      rows.push({ ...v, _rowType: 'vox', _key: `vox-${m}-${vi}` });
    });
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Feed header ──────────────────────────────────────────────────── */}
      <div style={{
        padding: '8px 12px',
        flexShrink: 0,
        borderBottom: '1px solid rgba(227,224,213,0.08)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      }}>
        {/* Live indicator — pulses while simulation is running */}
        {isPlaying && (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '10px',
            fontWeight: 700,
            color: '#E05252',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            animation: 'livePulse 1.4s ease-in-out infinite',
          }}>
            ● LIVE
          </span>
        )}
        {!isPlaying && events?.length > 0 && (
          <span style={{ fontSize: '10px', opacity: 0.4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Match Feed
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '10px', opacity: 0.3 }}>
          {events?.length ?? 0} events
        </span>
      </div>

      {/* ── Scrollable feed ──────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          scrollbarWidth: 'thin',
          scrollbarColor: `${homeTeam?.color || C.purple} #111`,
        }}
      >
        {rows.length === 0 ? (
          <div style={{
            textAlign: 'center',
            opacity: 0.25,
            fontSize: '11px',
            paddingTop: '60px',
            fontStyle: 'italic',
          }}>
            Kick-off…
          </div>
        ) : (
          rows.map(row => (
            <FeedRow
              key={row._key}
              item={row}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
            />
          ))
        )}
      </div>
    </div>
  );
};

// ── PostMatchSummary ───────────────────────────────────────────────────────────

/**
 * Full-screen overlay displayed when the match reaches full time (ms.mvp set).
 *
 * INTENT
 * ──────
 * Blaseball always had a moment of reflection after a game — the results page
 * let you absorb what happened before moving on.  This overlay serves that
 * role: it is the first thing the user sees when the final whistle blows,
 * giving them the scoreline, scorers, MVP, cards, and the Architect's closing
 * verdict before they decide what to do next.
 *
 * SECTIONS
 * ────────
 *   1. Scoreline — large, team-coloured, immediate visual impact.
 *   2. Scorers   — grouped by team with minute stamps.
 *   3. MVP       — single line callout.
 *   4. Cards     — yellow/red cards with player names.
 *   5. Architect's Verdict — the most recent architect proclamation text
 *      (if available) rendered with the cosmic purple treatment.
 *   6. Action buttons — "View Standings" navigates to the league page;
 *      "Play Again" calls onPlayAgain to reset the simulator.
 *
 * @param {{
 *   matchState:       object,     // final ms (ms.mvp must be set)
 *   onPlayAgain:      () => void, // callback: reset the simulator
 *   onViewStandings:  () => void, // callback: navigate to league standings
 *   architectVerdict: string|null, // last Architect proclamation text (or null)
 *   homeLeagueId:     string|null, // for the "View Standings" link label
 * }} props
 * @returns {JSX.Element}
 */
export const PostMatchSummary = ({
  matchState: ms,
  onPlayAgain,
  onViewStandings,
  architectVerdict,
  homeLeagueId,
}) => {
  const homeWon  = ms.score[0] > ms.score[1];
  const awayWon  = ms.score[1] > ms.score[0];
  const isDraw   = ms.score[0] === ms.score[1];
  const stats    = ms.playerStats || {};

  // ── Derive scorer, card, and assist lists from playerStats ───────────────
  // playerStats is keyed by player name; we separate by team using shortName.
  const homeScorers = [];
  const awayScorers = [];
  const allCards    = [];

  Object.entries(stats).forEach(([name, s]) => {
    const isHome = s.team === ms.homeTeam.shortName;
    if ((s.goals || 0) > 0) {
      (isHome ? homeScorers : awayScorers).push({ name, goals: s.goals });
    }
    if ((s.yellows || 0) > 0 || (s.reds || s.redCards || 0) > 0) {
      allCards.push({
        name,
        team: isHome ? ms.homeTeam.shortName : ms.awayTeam.shortName,
        color: isHome ? ms.homeTeam.color : ms.awayTeam.color,
        yellows: s.yellows || 0,
        reds: s.reds || s.redCards || 0,
      });
    }
  });

  // ── Result label ─────────────────────────────────────────────────────────
  const resultLabel = isDraw
    ? 'DRAW'
    : homeWon
    ? `${ms.homeTeam.shortName} WIN`
    : `${ms.awayTeam.shortName} WIN`;
  const resultColor = isDraw
    ? 'rgba(227,224,213,0.5)'
    : homeWon ? ms.homeTeam.color : ms.awayTeam.color;

  return (
    // ── Backdrop overlay ──────────────────────────────────────────────────
    // Fixed full-screen overlay with a semi-transparent dark backdrop so the
    // match state underneath is still visible (adds context without distraction).
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.82)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '16px',
    }}>
      <div style={{
        backgroundColor: '#0D0D0D',
        border: '1px solid rgba(227,224,213,0.15)',
        maxWidth: '520px',
        width: '100%',
        maxHeight: '90vh',
        overflowY: 'auto',
        padding: '32px 28px 24px',
      }}>

        {/* ── FULL TIME header ────────────────────────────────────────────── */}
        <div style={{
          textAlign: 'center',
          fontSize: '10px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.18em',
          color: C.purple,
          marginBottom: '8px',
        }}>
          Full Time
        </div>

        {/* ── Result label (WIN / DRAW) ────────────────────────────────────── */}
        <div style={{
          textAlign: 'center',
          fontSize: '11px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          color: resultColor,
          marginBottom: '16px',
        }}>
          {resultLabel}
        </div>

        {/* ── Scoreline ────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          marginBottom: '24px',
        }}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: ms.homeTeam.color, textAlign: 'right', flex: 1 }}>
            {ms.homeTeam.shortName}
          </span>
          <span style={{
            fontSize: '36px',
            fontWeight: 700,
            letterSpacing: '0.05em',
            color: 'rgba(227,224,213,0.9)',
            minWidth: '100px',
            textAlign: 'center',
          }}>
            {ms.score[0]}–{ms.score[1]}
          </span>
          <span style={{ fontSize: '14px', fontWeight: 700, color: ms.awayTeam.color, textAlign: 'left', flex: 1 }}>
            {ms.awayTeam.shortName}
          </span>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid rgba(227,224,213,0.08)', marginBottom: '20px' }} />

        {/* ── Scorers ──────────────────────────────────────────────────────── */}
        {(homeScorers.length > 0 || awayScorers.length > 0) && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{
              fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.1em', opacity: 0.4, marginBottom: '8px',
            }}>
              ⚽ Scorers
            </div>
            <div style={{ display: 'flex', gap: '16px' }}>
              {/* Home scorers — left column */}
              <div style={{ flex: 1 }}>
                {homeScorers.map((s, i) => (
                  <div key={i} style={{ fontSize: '12px', color: ms.homeTeam.color, marginBottom: '3px' }}>
                    {s.name}
                    {s.goals > 1 && (
                      <span style={{ opacity: 0.6, fontSize: '10px', marginLeft: '4px' }}>
                        ×{s.goals}{s.goals >= 3 ? ' ★' : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {/* Away scorers — right column */}
              <div style={{ flex: 1, textAlign: 'right' }}>
                {awayScorers.map((s, i) => (
                  <div key={i} style={{ fontSize: '12px', color: ms.awayTeam.color, marginBottom: '3px' }}>
                    {s.name}
                    {s.goals > 1 && (
                      <span style={{ opacity: 0.6, fontSize: '10px', marginLeft: '4px' }}>
                        ×{s.goals}{s.goals >= 3 ? ' ★' : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── MVP ──────────────────────────────────────────────────────────── */}
        {ms.mvp && (
          <div style={{
            marginBottom: '16px',
            padding: '10px 14px',
            backgroundColor: `${ms.mvp.teamColor}0D`,  // 0D ≈ 5% opacity tint
            border: `1px solid ${ms.mvp.teamColor}33`,  // 33 ≈ 20% opacity border
          }}>
            <span style={{ fontSize: '10px', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              🏆 Player of the Match
            </span>
            <div style={{ fontSize: '14px', fontWeight: 700, color: ms.mvp.teamColor, marginTop: '2px' }}>
              {ms.mvp.name}
            </div>
            <div style={{ fontSize: '10px', opacity: 0.5 }}>{ms.mvp.team}</div>
          </div>
        )}

        {/* ── Cards summary ─────────────────────────────────────────────────── */}
        {allCards.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{
              fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.1em', opacity: 0.4, marginBottom: '6px',
            }}>
              Cards
            </div>
            {allCards.map((c, i) => (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                marginRight: '8px', marginBottom: '4px',
                fontSize: '11px', color: c.color, opacity: 0.85,
              }}>
                {c.reds > 0 ? '🟥' : '🟨'} {c.name}
              </span>
            ))}
          </div>
        )}

        {/* ── Architect's Verdict ───────────────────────────────────────────── */}
        {/* Uses the same void-black + fixed-violet-border + architectPulse
            treatment as ArchitectCard and ArchitectInterferenceCard so all
            three Architect surfaces share one visual identity. */}
        {architectVerdict && (
          <div style={{
            marginBottom: '20px',
            padding: '12px 14px',
            backgroundColor: '#050308',
            border: '1px solid rgba(157,111,251,0.35)',
            borderLeft: '4px solid #9D6FFB',
            animation: 'architectPulse 3s ease-in-out infinite',
          }}>
            <div style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: '#9D6FFB', marginBottom: '6px',
              textShadow: '0 0 10px rgba(124,58,237,0.9), 0 0 22px rgba(124,58,237,0.45)',
            }}>
              ✦ The Architect's Verdict
            </div>
            <div style={{
              fontSize: '11px', fontStyle: 'italic', lineHeight: 1.6,
              color: '#E2D9F3', opacity: 0.9,
            }}>
              "{architectVerdict}"
            </div>
          </div>
        )}

        <hr style={{ border: 'none', borderTop: '1px solid rgba(227,224,213,0.08)', marginBottom: '20px' }} />

        {/* ── Action buttons ────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          {onViewStandings && (
            <button
              onClick={onViewStandings}
              style={{
                padding: '8px 18px',
                border: '1px solid rgba(227,224,213,0.3)',
                backgroundColor: 'transparent',
                color: 'rgba(227,224,213,0.85)',
                cursor: 'pointer',
                fontSize: '11px',
                fontFamily: "'Space Mono', monospace",
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              View Standings
            </button>
          )}
          {onPlayAgain && (
            <button
              onClick={onPlayAgain}
              style={{
                padding: '8px 18px',
                border: `1px solid ${C.purple}`,
                backgroundColor: `${C.purple}22`,
                color: C.purple,
                cursor: 'pointer',
                fontSize: '11px',
                fontFamily: "'Space Mono', monospace",
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              Play Again
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
