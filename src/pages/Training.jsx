// ── Training.jsx ────────────────────────────────────────────────────────────
// Route wrapper for the training facility at /training.
//
// WHY a separate wrapper: keeps the route layer thin (.jsx) while the
// feature component (TrainingPage) stays a typed .tsx module with no
// knowledge of the router. The wrapper just provides the container layout.

import { TrainingPage } from '../features/training';

export default function Training() {
  return (
    <div>
      <div className="page-hero">
        <div className="container">
          <h1>Training Facility</h1>
          <hr className="divider" />
          <p className="subtitle">Put in the work between matches.</p>
        </div>
      </div>

      <div className="container page-content">
        <TrainingPage />
      </div>
    </div>
  );
}
