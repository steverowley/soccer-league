// ── components/DirectionSwitcher.tsx ────────────────────────────────────────
// The floating control shown only while a design-direction preview is on
// (src/shared/design/direction.ts). Lets the owner flip the whole live site
// between the proposed directions, or back to the current look, from any
// page. main.tsx lazy-loads it only when a preview is active, so fans never
// download it.

import { useState } from 'react';
import { color, hairline, space, tone, type } from '../shared/design';
import {
  DIRECTIONS,
  DIRECTION_LABEL,
  applyDirection,
  type Direction,
} from '../shared/design/direction';
import { Tag } from '../shared/ui';

export default function DirectionSwitcher({ initial }: { initial: Direction }) {
  const [active, setActive] = useState<Direction | null>(initial);
  // Starts collapsed to one row so it never covers a phone screen's content.
  const [open, setOpen] = useState(false);

  const choose = (next: Direction | null) => {
    applyDirection(next);
    setActive(next);
  };

  return (
    <div
      role="region"
      aria-label="Design direction preview"
      style={{
        position: 'fixed',
        left: space[12],
        bottom: space[12],
        zIndex: 1001,
        maxWidth: `calc(100vw - ${space[24]}px)`,
        background: color.surfaceRaised,
        ...hairline(color.architect),
        padding: space[8],
        display: 'flex',
        flexDirection: 'column',
        gap: space[8],
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[12] }}>
        <span style={{ ...type.label, ...tone.secondary }}>
          Preview: {active ? DIRECTION_LABEL[active] : 'current'}
        </span>
        <Tag onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Switch'}</Tag>
      </div>
      {open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space[4] }}>
          <Tag selected={active == null} onClick={() => choose(null)}>Current</Tag>
          {DIRECTIONS.map((d) => (
            <Tag key={d} selected={active === d} onClick={() => choose(d)}>
              {DIRECTION_LABEL[d]}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
}
