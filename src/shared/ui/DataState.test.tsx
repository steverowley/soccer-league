// ── DataState.test.tsx ──────────────────────────────────────────────────────
// The shared loading / error / pre-season states and the AsyncView switch.

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  AsyncView,
  ErrorState,
  LoadingState,
  PreSeasonState,
  formatKickoffDate,
} from './DataState';
import { TimeoutError, type AsyncData } from '../hooks/useAsyncData';

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

function state<T>(partial: Partial<AsyncData<T>>): AsyncData<T> {
  return { status: 'loading', data: undefined, error: null, retry: vi.fn(), ...partial };
}

describe('LoadingState', () => {
  it('is a polite status region with its label', () => {
    wrap(<LoadingState label="Loading fixtures" />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toContain('Loading fixtures');
  });
});

describe('ErrorState', () => {
  it('says the feed is unreachable for an error and offers a retry', () => {
    const onRetry = vi.fn();
    wrap(<ErrorState what="the fixtures" onRetry={onRetry} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Signal lost');
    expect(alert.textContent).toContain('Could not load the fixtures');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says the feed is slow for a timeout', () => {
    wrap(<ErrorState what="the table" timedOut />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('No answer');
    expect(alert.textContent).toContain('Still waiting for the table');
    expect(alert.getAttribute('data-state')).toBe('timeout');
  });

  it('has no retry button without a handler', () => {
    wrap(<ErrorState />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('PreSeasonState', () => {
  it('says "soon" when no start date is known (never invents one)', () => {
    wrap(<PreSeasonState />);
    expect(screen.getByText('Season 1 is coming')).toBeTruthy();
    expect(document.body.textContent).toContain('Kick-off soon.');
  });

  it('shows the database start date when there is one', () => {
    wrap(<PreSeasonState seasonName="Season 2" startsAt="2026-12-01T18:00:00Z" />);
    expect(screen.getByText('Season 2 is coming')).toBeTruthy();
    expect(document.body.textContent).toContain(`Kick-off on ${formatKickoffDate('2026-12-01T18:00:00Z')}.`);
  });
});

describe('formatKickoffDate', () => {
  it('returns null for missing or invalid input', () => {
    expect(formatKickoffDate(null)).toBeNull();
    expect(formatKickoffDate('not a date')).toBeNull();
  });
});

describe('AsyncView', () => {
  const child = (rows: number[]) => <p>rows:{rows.length}</p>;

  it('renders the loading state while loading', () => {
    wrap(<AsyncView state={state<number[]>({})} loading="Loading things">{child}</AsyncView>);
    expect(screen.getByRole('status').textContent).toContain('Loading things');
  });

  it('renders the error state with the hook retry', () => {
    const retry = vi.fn();
    wrap(<AsyncView state={state<number[]>({ status: 'error', error: new Error('x'), retry })} what="the board">{child}</AsyncView>);
    expect(screen.getByRole('alert').textContent).toContain('Could not load the board');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });

  it('renders the timeout state for a timeout', () => {
    wrap(<AsyncView state={state<number[]>({ status: 'timeout', error: new TimeoutError(10_000) })}>{child}</AsyncView>);
    expect(screen.getByRole('alert').getAttribute('data-state')).toBe('timeout');
  });

  it('renders the empty slot when isEmpty says so', () => {
    wrap(
      <AsyncView state={state<number[]>({ status: 'success', data: [] })} isEmpty={(r) => r.length === 0} empty={<p>none yet</p>}>
        {child}
      </AsyncView>,
    );
    expect(screen.getByText('none yet')).toBeTruthy();
  });

  it('renders children with the data on success', () => {
    wrap(<AsyncView state={state<number[]>({ status: 'success', data: [1, 2, 3] })}>{child}</AsyncView>);
    expect(screen.getByText('rows:3')).toBeTruthy();
  });
});
