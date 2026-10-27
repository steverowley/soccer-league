// ── shared/ui/EmptyState.tsx ──────────────────────────────────────────────
// The "nothing here" surface (#378), now on the design tokens.
//
// WHY: every page has an empty placeholder ("No match in progress", "No
// wagers yet") and they drifted: italic 13 px in a faded dust that failed
// contrast. Here the body is the `small` type, italic, in the secondary
// tone (7.7:1), with an optional label above and an optional hint below.
//
// Copy rule (docs/design-language.md, section 6): say what will appear and
// when, never "(no snippets yet)". Containment is the caller's call: wrap
// it in a <Card> for a bordered empty state.

import type { CSSProperties, ReactNode } from 'react';
import { space, tone, type } from '../design';

interface EmptyStateProps {
  /** The main "nothing here" sentence. Always present. */
  children: ReactNode;
  /** Optional label above the body, e.g. "Voting closed". */
  kicker?: string;
  /** Optional next step below the body (may be a <Link>). */
  hint?: ReactNode;
  /** Centre the content. Defaults to true. */
  centred?: boolean;
  /** Optional layout overrides. */
  style?: CSSProperties;
}

/**
 * Canonical "nothing here" surface.
 *
 * Examples:
 *   <EmptyState>No match in progress. The cosmos rests.</EmptyState>
 *   <EmptyState kicker="No bets" hint={<Link to="/matches">Browse fixtures</Link>}>
 *     You have not placed any wagers yet.
 *   </EmptyState>
 *
 * @returns A flex-column div of paragraphs.
 */
export function EmptyState({
  children,
  kicker,
  hint,
  centred = true,
  style,
}: EmptyStateProps) {
  return (
    <div
      style={{
        display:        'flex',
        flexDirection:  'column',
        alignItems:     centred ? 'center' : 'flex-start',
        justifyContent: 'center',
        textAlign:      centred ? 'center' : 'left',
        gap:            space[8],
        padding:        `${space[32]}px ${space[24]}px`,
        ...style,
      }}
    >
      {kicker && (
        <p style={{ ...type.label, ...tone.secondary, margin: 0 }}>
          {kicker}
        </p>
      )}
      <p style={{ ...type.small, ...tone.secondary, fontStyle: 'italic', margin: 0 }}>
        {children}
      </p>
      {hint && (
        <p style={{ ...type.small, ...tone.primary, margin: 0, marginTop: space[4] }}>
          {hint}
        </p>
      )}
    </div>
  );
}
