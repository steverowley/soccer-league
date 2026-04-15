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
export default function Training() {
  return (
    <div className="container" style={{ paddingTop: '40px', paddingBottom: '80px' }}>
      <TrainingPage />
    </div>
  );
}
