// ── MatchCard.jsx ─────────────────────────────────────────────────────────────
// Shared match card component used on Home, Matches, TeamDetail, and Profile.
//
// Handles three status variants:
//   'in_progress' — live scoreline + momentum bar + tag badges + optional commentary
//   'scheduled'   — time/date display + optional bet slider (showBet prop)
//   'completed'   — final scoreline
//
// Layout: metadata header (location/ground/referee), divider, horizontal
// scoreline (TEAM 1 [badge] score · time · score [badge] TEAM 2), then
// variant-specific content below.

import { useState } from 'react';

// ── TeamBadge ─────────────────────────────────────────────────────────────────
function TeamBadge({ color, size = 44 }) {
  return (
    <div style={{
      width: size, height: size,
      borderRadius: '50%',
      background: color ? `${color}33` : 'rgba(227,224,213,0.12)',
      border: `2px solid ${color || 'rgba(227,224,213,0.25)'}`,
      flexShrink: 0,
    }} />
  );
}

// ── MomentumBar ───────────────────────────────────────────────────────────────
function MomentumBar({ value = 50 }) {
  const color = value > 75 ? 'var(--color-red)' : value > 45 ? 'var(--color-purple)' : 'var(--color-green)';
  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em',
        opacity: 0.6, marginBottom: '4px',
      }}>
        <span>Calm</span>
        <span>Tense</span>
        <span>Mayhem 🔥</span>
      </div>
      <div style={{
        width: '100%', height: '4px',
        background: 'rgba(227,224,213,0.12)',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute', left: 0, top: 0,
          width: `${Math.min(100, Math.max(0, value))}%`,
          height: '100%',
          background: color,
          transition: 'width 0.4s ease, background 0.4s ease',
        }} />
      </div>
    </div>
  );
}

// ── TagBadge ──────────────────────────────────────────────────────────────────
function TagBadge({ label, color = 'rgba(227,224,213,0.2)', textColor = 'var(--color-dust)' }) {
  return (
    <span style={{
      fontSize: '9px', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.08em',
      background: color, color: textColor,
      padding: '2px 6px',
      fontFamily: 'var(--font-mono)',
    }}>
      {label}
    </span>
  );
}

// ── CommentaryEntry ───────────────────────────────────────────────────────────
const PERSONA_COLOR = {
  'Zara Bloom':  '#c8a84b',
  'Nexus-7':     'var(--color-sky)',
  'Captain Vox': 'var(--color-green)',
  'Architect':   'var(--color-purple)',
};

function CommentaryEntry({ entry }) {
  const { persona, role, minute, text } = entry;
  const color = PERSONA_COLOR[persona] ?? 'var(--color-dust)';
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: '2px',
      }}>
        <span style={{ fontSize: '10px', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {persona}
          {role && <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: '6px', textTransform: 'none', letterSpacing: 0 }}>{role}</span>}
        </span>
        {minute != null && (
          <span style={{ fontSize: '10px', opacity: 0.45 }}>{minute}'</span>
        )}
      </div>
      <p style={{ fontSize: '11px', lineHeight: 1.5, opacity: 0.85, margin: 0 }}>
        "{text}"
      </p>
    </div>
  );
}

// ── formatTime / formatDate ────────────────────────────────────────────────────
function formatTime(iso) {
  if (!iso) return '00:00';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso) {
  if (!iso) return 'DD|MM|YY';
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}|${mm}|${yy}`;
}

// ── MatchCard (main export) ───────────────────────────────────────────────────
/**
 * @param {object}   props
 * @param {object}   props.match          — match row with home_team / away_team joined
 * @param {Function} [props.onSimulate]   — callback(homeId, awayId) for scheduled cards
 * @param {boolean}  [props.showBet]      — show bet slider on scheduled cards (Matches page)
 * @param {boolean}  [props.fetchingTeams]— disable simulate while loading
 * @param {Array}    [props.commentary]   — live commentary entries [{persona,role,minute,text}]
 * @param {number}   [props.momentum]     — 0–100 momentum value for live cards
 * @param {Array}    [props.tags]         — tag strings e.g. ['LATE GAME','TIED']
 */
export default function MatchCard({
  match,
  onSimulate,
  showBet = false,
  fetchingTeams = false,
  commentary = [],
  momentum,
  tags = [],
}) {
  const { home_team, away_team, home_score, away_score, status, scheduled_at } = match;
  const isLive      = status === 'in_progress';
  const isCompleted = status === 'completed';
  const isUpcoming  = status === 'scheduled';

  const [betAmount, setBetAmount] = useState(100);

  const cardStyle = isLive ? {
    border: '1px solid rgba(154,92,244,0.5)',
    animation: 'architectPulse 3s ease-in-out infinite',
  } : {};

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', ...cardStyle }}>

      {/* ── Meta header ───────────────────────────────────────────────────── */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(227,224,213,0.1)' }}>
        {home_team?.location    && <MetaLine label="LOCATION" value={home_team.location} />}
        {home_team?.home_ground && <MetaLine label="GROUND"   value={home_team.home_ground} />}
        <MetaLine label="REFEREE" value="—" />
      </div>

      {/* ── Scoreline ─────────────────────────────────────────────────────── */}
      <div style={{
        padding: '16px',
        background: 'rgba(17,17,17,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
      }}>
        {/* Home team */}
        <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1, textAlign: 'right' }}>
          {home_team?.name ?? '—'}
        </span>

        <TeamBadge color={home_team?.color} />

        {/* Score / time center */}
        <div style={{ textAlign: 'center', flexShrink: 0, minWidth: '80px' }}>
          {isLive && (
            <div style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '0.05em' }}>
              {home_score ?? 0} <span style={{ opacity: 0.4, fontSize: '14px' }}>·</span> {away_score ?? 0}
            </div>
          )}
          {isCompleted && (
            <div style={{ fontSize: '20px', fontWeight: 700 }}>
              {home_score ?? 0} <span style={{ opacity: 0.4, fontSize: '14px' }}>·</span> {away_score ?? 0}
            </div>
          )}
          {isUpcoming && (
            <>
              <div style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '0.05em' }}>
                {formatTime(scheduled_at)}
              </div>
              <div style={{ fontSize: '10px', opacity: 0.5, letterSpacing: '0.06em', marginTop: '2px' }}>
                {formatDate(scheduled_at)}
              </div>
            </>
          )}
          {isLive && (
            <div style={{ fontSize: '10px', opacity: 0.5, marginTop: '2px', letterSpacing: '0.06em' }}>
              LIVE
            </div>
          )}
          {isCompleted && (
            <div style={{ fontSize: '10px', opacity: 0.5, marginTop: '2px', letterSpacing: '0.06em' }}>
              FT
            </div>
          )}
        </div>

        <TeamBadge color={away_team?.color} />

        {/* Away team */}
        <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1, textAlign: 'left' }}>
          {away_team?.name ?? '—'}
        </span>
      </div>

      {/* ── Live: momentum + tags + commentary ───────────────────────────── */}
      {isLive && (
        <div style={{ padding: '12px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <MomentumBar value={momentum ?? 50} />

          {tags.length > 0 && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {tags.map(t => (
                <TagBadge
                  key={t}
                  label={t}
                  color={t === 'RED CARDS' ? 'rgba(224,82,82,0.25)' : 'rgba(227,224,213,0.12)'}
                  textColor={t === 'RED CARDS' ? 'var(--color-red)' : 'var(--color-dust)'}
                />
              ))}
            </div>
          )}

          {commentary.length > 0 && (
            <div style={{
              borderTop: '1px solid rgba(227,224,213,0.08)',
              paddingTop: '8px',
              maxHeight: '160px', overflowY: 'auto',
              display: 'flex', flexDirection: 'column', gap: '4px',
            }}>
              {commentary.slice(-3).map((entry, i) => (
                <CommentaryEntry key={i} entry={entry} />
              ))}
            </div>
          )}

          {commentary.length === 0 && (
            <div style={{ borderTop: '1px solid rgba(227,224,213,0.08)', paddingTop: '8px', textAlign: 'center' }}>
              <span style={{ fontSize: '10px', opacity: 0.4, letterSpacing: '0.1em' }}>⚡ LIVE IN PROGRESS ⚡</span>
            </div>
          )}
        </div>
      )}

      {/* ── Completed: no extra content ──────────────────────────────────── */}
      {isCompleted && (
        <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(227,224,213,0.08)' }}>
          <span style={{ fontSize: '10px', opacity: 0.4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Full Time</span>
        </div>
      )}

      {/* ── Upcoming: bet slider + actions ───────────────────────────────── */}
      {isUpcoming && showBet && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(227,224,213,0.1)' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em',
            marginBottom: '4px', opacity: 0.5,
          }}>
            <span>Min</span>
            <span style={{ flex: 1, textAlign: 'center' }}>Bet {betAmount} Credits</span>
            <span>Max</span>
          </div>
          <input
            type="range" min="10" max="1000" step="10"
            value={betAmount} onChange={e => setBetAmount(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--color-green)', marginBottom: '10px' }}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-primary"
              disabled
              style={{ flex: 1, fontSize: '11px', height: '36px', padding: '0 12px', opacity: 0.35, cursor: 'not-allowed' }}
              title="Betting opens in Phase 2"
            >
              Place Bet
            </button>
            {onSimulate && (
              <button
                className="btn btn-tertiary"
                disabled={fetchingTeams || !home_team?.id || !away_team?.id}
                onClick={() => onSimulate(home_team.id, away_team.id)}
                style={{ flex: 1, fontSize: '11px', height: '36px', padding: '0 12px', opacity: fetchingTeams ? 0.5 : 1 }}
              >
                {fetchingTeams ? 'Loading…' : 'Simulate ►'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Upcoming: simulate only (no bet, e.g. Home page) ─────────────── */}
      {isUpcoming && !showBet && onSimulate && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(227,224,213,0.1)' }}>
          <button
            className="btn btn-tertiary"
            disabled={fetchingTeams || !home_team?.id || !away_team?.id}
            onClick={() => onSimulate(home_team.id, away_team.id)}
            style={{ width: '100%', fontSize: '11px', height: '36px', padding: '0 12px', opacity: fetchingTeams ? 0.5 : 1 }}
          >
            {fetchingTeams ? 'Loading…' : 'Simulate ►'}
          </button>
        </div>
      )}

    </div>
  );
}

// ── MetaLine ──────────────────────────────────────────────────────────────────
function MetaLine({ label, value }) {
  return (
    <div style={{ fontSize: '10px', lineHeight: 1.6 }}>
      <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}: </span>
      <span style={{ opacity: 0.7 }}>{value}</span>
    </div>
  );
}
