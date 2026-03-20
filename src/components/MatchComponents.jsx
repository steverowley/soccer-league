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
      <div style={{ fontSize: '11px', fontStyle: 'italic', opacity: 0.9 }}>"{item.text}"</div>
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

// ── BetBtn ────────────────────────────────────────────────────────────────────

/**
 * Betting button used in the halftime and pre-match betting panels.
 *
 * Displays the bet label, an optional sub-label, the odds multiplier, and the
 * projected payout for the current stake amount.  Disabled when betAmount ≤ 0.
 *
 * @param {{ type: string, odds: string|number, label: string, sub?: string,
 *           color?: string, placeBet: Function, betAmount: number }} props
 * @returns {JSX.Element}
 */
export const BetBtn = ({ type, odds, label, sub, color = C.purple, placeBet, betAmount }) => (
  <button
    onClick={() => placeBet(type, betAmount, odds)}
    disabled={betAmount <= 0}
    style={{
      padding: '12px', border: `1px solid ${color}`, width: '100%',
      backgroundColor: C.abyss, fontFamily: "'Space Mono', monospace",
      cursor: betAmount <= 0 ? 'not-allowed' : 'pointer',
      opacity: betAmount <= 0 ? 0.5 : 1,
    }}
  >
    <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>{label}</div>
    {sub && <div style={{ fontSize: '11px', opacity: 0.5, marginBottom: '4px' }}>{sub}</div>}
    <div style={{ fontSize: '24px', fontWeight: 700, color }}>{odds}x</div>
    <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.6 }}>
      Win: {Math.floor(betAmount * parseFloat(odds))} coins
    </div>
  </button>
);

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
