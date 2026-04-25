// ── Training.jsx ────────────────────────────────────────────────────────────
// Route wrapper for the training facility at /training.
//
// WHY a separate wrapper: keeps the route layer thin (.jsx) while the
// feature component (TrainingPage) stays a typed .tsx module with no
// knowledge of the router. The wrapper just provides the container layout.

import { TrainingPage } from '../features/training';

/**
 * /training route wrapper. Renders the training facility inside the
 * standard page container with consistent top/bottom padding.
 *
 * No data fetching here — TrainingPage is self-fetching and reads
 * the user's favourite team directly from auth context.
 *
 * @returns {JSX.Element}
 */
/**
 * /training route wrapper.
 *
 * Renders the ISL page hero (consistent with every other top-level route)
 * then delegates to {@link TrainingPage}, which is self-fetching and reads
 * the user's favourite team directly from auth context.
 *
 * WHY split hero from feature component: TrainingPage has multiple render
 * branches (anon, no-team, loading, error, ready) and each branch shows a
 * heading. Keeping the hero here means the page chrome is always visible even
 * before the feature component resolves its auth/fetch state — no layout jump.
 *
 * @returns {JSX.Element}
 */
export default function Training() {
  return (
    <div>
      {/* ── Page hero ─────────────────────────────────────────────────────── */}
      {/* Consistent with Leagues, Teams, Players, Voting — 100px top padding
          on desktop (accounts for the logo overhang), centred uppercase H1,
          Lunar Dust divider, muted subtitle. */}
      <div className="page-hero">
        <div className="container">
          <h1>Training Facility</h1>
          <hr className="divider" />
          <p className="subtitle">Put in the work between matches.</p>
        </div>
      </div>

      {/* ── Feature content ───────────────────────────────────────────────── */}
      <div className="container" style={{ paddingBottom: '80px' }}>
        <TrainingPage />
      </div>
    </div>
  );
}
