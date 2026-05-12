// ── ElectionNight.jsx ─────────────────────────────────────────────────────────
// Election Night — the marquee social event of every 2-week season cycle.
// Route: /election
//
// DESIGN INTENT (Phase 3 — locked decisions)
// ────────────────────────────────────────────
// Election Night is when the cosmos pronounces on what the fans have willed.
// Voting results are announced first (relief/excitement), then blessings,
// then transformations, then — always last — incinerations.
//
// The page has four states keyed to season.status:
//
//   in_play         — Matches still running. Show a cosmic "not yet" message
//                     and the current season's focus voting tallies.
//
//   election_open   — Voting window is live. Show a CTA to the /voting page
//                     and a live tally of who's winning per team.
//
//   election_closed — Voting closed; Decrees are being written.
//                     Show a "The Architect deliberates" waiting screen.
//
//   completed       — Decrees announced. Show the full ticker in sequence:
//                     focus results → blessings → transformations → incinerations.
//
// DEV MODE
// ─────────
// In import.meta.env.DEV a "Advance Phase" button is shown that lets a developer
// manually step through season phases without waiting for the scheduler.
// This is gated strictly to development — it must never appear in production.
//
// DATA SOURCES
// ─────────────
// getActiveSeasonWithPhase() — current season + status
// getSeasonFocusTally()      — who voted for what
// getSeasonDecrees()         — Architect pronouncements (empty until completed)
// sortDecreesForElectionNight() — from electionLogic.ts

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useSupabase }        from '../shared/supabase/SupabaseProvider';
import { useAuth }            from '../features/auth';
import {
  getActiveSeasonWithPhase,
  getSeasonDecrees,
  getSeasonFocusTally,
  advanceSeasonPhase,
} from '../features/voting/api/election';
import { runElectionNight } from '../features/voting/api/orchestrator';
import { resolveFocusWinners, sortDecreesForElectionNight } from '../features/voting/logic/electionLogic';

// ── Decree type display config ────────────────────────────────────────────────
// Controls how each decree_type renders in the Election Night ticker.
// Color is a left-border accent (same pattern as CosmicVoiceCard) — never a
// background fill.
//
// Ordering reflects emotional escalation:
//   proclamation  — dark grey: the Architect speaks
//   focus_enacted — quantum purple: the fans' will is enacted
//   blessing      — gold: unexpected gifts
//   transformation — cyan: the world changes
//   incineration  — red: the final blow
const DECREE_DISPLAY = {
  proclamation:   { label: 'Proclamation',  color: '#6b7280', pulse: false },
  focus_enacted:  { label: 'Decree Enacted', color: '#7C3AED', pulse: false },
  blessing:       { label: 'Blessing',       color: '#d4a853', pulse: false },
  transformation: { label: 'Transformation', color: '#06b6d4', pulse: false },
  incineration:   { label: 'Incineration',   color: '#ef4444', pulse: true  },
};

// ── Phase copy ────────────────────────────────────────────────────────────────
// Atmospheric flavour text for each non-completed season phase.
// These are the only moments where the game speaks directly about real-time
// state; the language must stay cosmic and ambiguous.
const PHASE_COPY = {
  in_play:         'The season is not yet complete. The cosmos watches. When the last whistle falls, the void will open.',
  election_open:   'The window is open. Fan devotion — credits — pour into the void. Declare your will before the cosmos closes the gate.',
  election_closed: 'The gate is closed. No further declarations reach the Architect. The void deliberates.',
};

/**
 * Election Night page.
 *
 * Displays the current election phase, the season's voting tallies, and —
 * when the season is completed — the Architect's full Decree sequence.
 *
 * Phase transitions (DEV only) are wired to advanceSeasonPhase() so developers
 * can test the full flow without waiting for a scheduler.
 *
 * @returns {JSX.Element}
 */
export default function ElectionNight() {
  const db   = useSupabase();
  const { user } = useAuth();

  // ── Data state ────────────────────────────────────────────────────────────
  const [season,   setSeason]   = useState(null);
  const [decrees,  setDecrees]  = useState([]);
  const [tallies,  setTallies]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(false);

  // ── Dev phase-advance state ───────────────────────────────────────────────
  const [advancing, setAdvancing] = useState(false);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const s = await getActiveSeasonWithPhase(db);
      setSeason(s);
      if (s) {
        const [d, t] = await Promise.all([
          getSeasonDecrees(db, s.id),
          getSeasonFocusTally(db, s.id),
        ]);
        setDecrees(sortDecreesForElectionNight(d));
        setTallies(t);
      }
      setLoading(false);
    } catch {
      setError(true);
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  // ── Dev phase-advance handler ─────────────────────────────────────────────
  // Only available in development.  Advances the season to the next valid
  // phase so the full Election Night flow can be tested without a scheduler.
  const NEXT_PHASE = {
    in_play:         'election_open',
    election_open:   'election_closed',
    election_closed: 'completed',
    completed:       null,
  };

  // The election_closed → completed transition is the ceremonial moment:
  // we run the orchestrator (resolve focus winners, pick incinerations,
  // write decrees, fire `season.ended` so focus enactment runs) BEFORE
  // flipping `seasons.status`.  Doing the orchestration first means a
  // status row only flips to `completed` when the decrees + incinerations
  // actually landed — any failure leaves the season in `election_closed`
  // and the dev button can be retried.
  const advancePhase = useCallback(async () => {
    if (!season) return;
    const next = NEXT_PHASE[season.status];
    if (!next) return;
    setAdvancing(true);
    try {
      if (season.status === 'election_closed' && next === 'completed') {
        const result = await runElectionNight(db, season.id, season.name);
        // eslint-disable-next-line no-console
        console.log(
          `[ElectionNight] ceremony complete — ${result.decreesWritten} decrees, ${result.incinerationsCount} incinerations, ${result.replacementsGenerated} replacements, ${result.teamFocusesResolved} team focuses`,
        );
      }
      await advanceSeasonPhase(db, season.id, next);
      await load(); // re-fetch to reflect the new status
    } catch (e) {
      console.error('[ElectionNight] phase advance failed:', e);
    }
    setAdvancing(false);
  }, [season, db, load]);

  // ── Resolved focus winners per team (for pre-decree tally display) ────────
  const focusWinners = resolveFocusWinners(tallies);

  // ── Loading / error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="page-hero">
        <div className="container">
          <p style={{ opacity: 0.5, fontSize: '14px' }}>The cosmos prepares…</p>
        </div>
      </div>
    );
  }

  if (error || !season) {
    return (
      <div className="page-hero">
        <div className="container">
          <h2>Election Night</h2>
          <p style={{ marginTop: '16px', opacity: 0.6 }}>
            {!season ? 'No active season found.' : 'Could not load election data.'}
          </p>
        </div>
      </div>
    );
  }

  const isCompleted = season.status === 'completed';
  const isOpen      = season.status === 'election_open';

  return (
    <div>
      {/* ── Page hero ──────────────────────────────────────────────────────── */}
      <div className="page-hero">
        <div className="container">
          <h1>Election Night</h1>
          <hr className="divider" />
          <p className="subtitle">
            {season.name} · {isCompleted ? 'Decrees Enacted' : 'The cosmos listens'}
          </p>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: '60px' }}>

        {/* ── Phase status banner ─────────────────────────────────────────── */}
        {!isCompleted && (
          <section className="section">
            <div style={{
              border: '1px solid rgba(227,224,213,0.15)',
              borderLeft: `3px solid ${isOpen ? '#7C3AED' : 'rgba(227,224,213,0.2)'}`,
              borderRadius: '0 3px 3px 0',
              padding: '16px 20px',
              fontSize: '14px',
              lineHeight: 1.7,
              fontStyle: 'italic',
              opacity: 0.8,
            }}>
              {PHASE_COPY[season.status]}
            </div>

            {/* Voting CTA when election is open */}
            {isOpen && (
              <div style={{ marginTop: '16px' }}>
                <Link to="/voting">
                  <button style={{
                    background: '#7C3AED',
                    color: '#fff',
                    border: 'none',
                    padding: '10px 20px',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 'bold',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}>
                    Cast Your Vote →
                  </button>
                </Link>
              </div>
            )}
          </section>
        )}

        {/* ── DEV: Phase advance button ───────────────────────────────────── */}
        {/* Strictly gated to development builds — Vite strips this block from
            production bundles via the import.meta.env.DEV constant. */}
        {import.meta.env.DEV && season.status !== 'completed' && user && (
          <section className="section">
            <div style={{
              border: '1px dashed rgba(227,224,213,0.2)',
              borderRadius: '3px',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}>
              <span style={{ fontSize: '11px', opacity: 0.4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                DEV
              </span>
              <button
                onClick={advancePhase}
                disabled={advancing}
                style={{
                  background: 'none',
                  border: '1px solid rgba(227,224,213,0.3)',
                  color: 'var(--color-dust)',
                  padding: '6px 14px',
                  borderRadius: '3px',
                  cursor: advancing ? 'not-allowed' : 'pointer',
                  fontSize: '12px',
                  opacity: advancing ? 0.4 : 1,
                }}
              >
                {advancing ? 'Advancing…' : `Advance phase → ${NEXT_PHASE[season.status]}`}
              </button>
              <span style={{ fontSize: '11px', opacity: 0.3 }}>
                Current: {season.status}
              </span>
            </div>
          </section>
        )}

        {/* ── Vote tally (all phases) ──────────────────────────────────────── */}
        {/* Always shown so fans can see live vote counts even while voting is
            open.  This is the "market as content" principle — the tally itself
            is engaging content regardless of phase. */}
        {focusWinners.size > 0 && (
          <section className="section">
            <h2 style={{ fontSize: '13px', letterSpacing: '0.12em', opacity: 0.5, marginBottom: '16px', textTransform: 'uppercase' }}>
              {isCompleted ? 'Enacted Focuses' : 'Current Vote Tallies'}
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[...focusWinners.entries()].map(([teamId, enacted]) => (
                <div key={teamId} style={{
                  padding: '12px 16px',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: '3px',
                  border: '1px solid rgba(227,224,213,0.08)',
                }}>
                  <Link
                    to={`/teams/${teamId}`}
                    style={{ fontSize: '13px', fontWeight: 'bold', color: 'inherit', textDecoration: 'none', opacity: 0.9 }}
                  >
                    {enacted.major?.team_id ?? teamId}
                  </Link>
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {enacted.major && (
                      <div style={{ fontSize: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ opacity: 0.4, minWidth: '40px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Major</span>
                        <span>{enacted.major.label}</span>
                        <span style={{ opacity: 0.4, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{enacted.major.total_credits} IC</span>
                      </div>
                    )}
                    {enacted.minor && (
                      <div style={{ fontSize: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ opacity: 0.4, minWidth: '40px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Minor</span>
                        <span>{enacted.minor.label}</span>
                        <span style={{ opacity: 0.4, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{enacted.minor.total_credits} IC</span>
                      </div>
                    )}
                    {!enacted.major && !enacted.minor && (
                      <p style={{ fontSize: '12px', opacity: 0.35, fontStyle: 'italic' }}>
                        No votes cast. The cosmos acts without direction.
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Decree ticker (completed only) ──────────────────────────────── */}
        {isCompleted && decrees.length > 0 && (
          <section className="section">
            <h2 style={{ fontSize: '13px', letterSpacing: '0.12em', opacity: 0.5, marginBottom: '16px', textTransform: 'uppercase' }}>
              The Decrees
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {decrees.map((decree, i) => {
                const display = DECREE_DISPLAY[decree.decree_type] ?? DECREE_DISPLAY.proclamation;
                return (
                  <div
                    key={decree.id ?? i}
                    style={{
                      borderLeft: `3px solid ${display.color}`,
                      padding: '12px 16px',
                      background: decree.decree_type === 'incineration'
                        ? 'rgba(239,68,68,0.04)'  // faint red tint for incinerations
                        : 'rgba(255,255,255,0.02)',
                      borderRadius: '0 3px 3px 0',
                    }}
                  >
                    {/* Decree type label */}
                    <span style={{
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      opacity: 0.5,
                      color: display.color,
                      display: 'block',
                      marginBottom: '4px',
                    }}>
                      {display.label}
                    </span>

                    {/* The Architect's text */}
                    <p style={{ fontSize: '13px', lineHeight: 1.7, fontStyle: 'italic' }}>
                      {decree.text}
                    </p>

                    {/* Player / team link when applicable */}
                    {decree.player_id && (
                      <Link
                        to={`/players/${decree.player_id}`}
                        style={{ fontSize: '11px', opacity: 0.5, color: 'inherit', display: 'block', marginTop: '6px' }}
                      >
                        View player profile →
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Completed but no decrees yet ────────────────────────────────── */}
        {isCompleted && decrees.length === 0 && (
          <section className="section">
            <div style={{ textAlign: 'center', opacity: 0.3, fontStyle: 'italic', fontSize: '13px', padding: '32px' }}>
              The Architect has spoken — but the words have not yet reached this place.
            </div>
          </section>
        )}

        {/* ── Memorial link ────────────────────────────────────────────────── */}
        <div style={{ marginTop: '40px', textAlign: 'center' }}>
          <Link to="/lost" style={{ fontSize: '12px', opacity: 0.35, color: 'inherit', textDecoration: 'underline', textDecorationColor: 'rgba(227,224,213,0.2)' }}>
            Remember those who were taken →
          </Link>
        </div>

      </div>
    </div>
  );
}
