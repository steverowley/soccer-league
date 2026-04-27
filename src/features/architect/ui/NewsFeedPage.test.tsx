// ── architect/ui/NewsFeedPage.test.tsx ───────────────────────────────────────
// WHY: Smoke tests for the Galaxy Dispatch news feed UI.  We verify the core
// rendering, kind-filter toggle, "load more" pagination, and empty/error
// states without spinning up a real Supabase instance.  The DB layer is
// mocked at the module boundary (`getRecentNarratives`) so each test runs in
// isolation with deterministic data.
//
// SCOPE: smoke + interaction. Pure logic (entity selection, score redaction,
// prompt building) is already covered by buildNewsContext.test.ts.  These
// tests confirm the React layer wires the API + filter state + pagination
// correctly.
//
// MOCKING STRATEGY:
//   - `@shared/supabase/SupabaseProvider` → vi.mock so useSupabase() returns
//     a sentinel.  The actual DB shape is irrelevant because the API layer
//     is also mocked.
//   - `../../entities/api/entities` → vi.mock so getRecentNarratives() returns
//     fixture data.  Per-test mockResolvedValueOnce overrides cover empty,
//     error, and pagination branches.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NewsFeedPage } from './NewsFeedPage';
import type { Narrative } from '../../entities/types';

// ── Module mocks ─────────────────────────────────────────────────────────────

const fakeDb = {};
vi.mock('@shared/supabase/SupabaseProvider', () => ({
  useSupabase: () => fakeDb,
}));

// `getRecentNarratives` is the only DB call NewsFeedPage makes.  Mocking it as
// a vi.fn() lets each test override the resolved value (or reject for the
// error path).
const mockGetRecentNarratives = vi.fn();
vi.mock('../../entities/api/entities', () => ({
  getRecentNarratives: (...args: unknown[]) => mockGetRecentNarratives(...args),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Helper to build a Narrative row with sensible defaults. */
function makeNarrative(overrides: Partial<Narrative> = {}): Narrative {
  return {
    id:                'n-' + Math.random().toString(36).slice(2, 8),
    kind:              'news',
    summary:           'A quiet day in the inner belt.',
    entities_involved: [],
    source:            'architect',
    created_at:        '2600-04-27T19:00:00Z',
    acknowledged_by:   [],
    ...overrides,
  };
}

const NEWS_ROW    = makeNarrative({ id: 'n-news',    kind: 'news',              summary: 'Quiet news item.' });
const PUNDIT_ROW  = makeNarrative({ id: 'n-pundit',  kind: 'pundit_takes',      summary: 'A spicy take.' });
const WHISPER_ROW = makeNarrative({ id: 'n-wh',      kind: 'architect_whisper', summary: 'The cosmos stirs.' });

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  // Default: returns the three fixture rows.  Individual tests may override.
  mockGetRecentNarratives.mockResolvedValue([NEWS_ROW, PUNDIT_ROW, WHISPER_ROW]);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('NewsFeedPage', () => {
  it('renders the page hero with title, badge, and subtitle', async () => {
    render(<NewsFeedPage />);

    expect(screen.getByRole('heading', { name: /Galaxy Dispatch/i })).toBeInTheDocument();
    expect(screen.getByText(/Architect/i)).toBeInTheDocument();
    expect(screen.getByText(/Transmissions, disturbances/i)).toBeInTheDocument();
  });

  it('shows a loading state, then renders narrative cards from the API', async () => {
    render(<NewsFeedPage />);

    expect(screen.getByText(/Receiving transmissions/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Quiet news item.')).toBeInTheDocument();
    });
    expect(screen.getByText('A spicy take.')).toBeInTheDocument();
    expect(screen.getByText('The cosmos stirs.')).toBeInTheDocument();
  });

  it('shows the empty-state card when the API returns no rows', async () => {
    mockGetRecentNarratives.mockResolvedValue([]);

    render(<NewsFeedPage />);

    await waitFor(() => {
      expect(screen.getByText(/Architect has been unusually quiet/i)).toBeInTheDocument();
    });
  });

  it('shows the error message when the API rejects', async () => {
    mockGetRecentNarratives.mockRejectedValue(new Error('DB unreachable'));

    render(<NewsFeedPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Could not load transmissions — DB unreachable/i);
    });
  });

  it('filters cards client-side when a kind button is toggled', async () => {
    render(<NewsFeedPage />);

    // Wait for initial load.
    await waitFor(() =>
      expect(screen.getByText('Quiet news item.')).toBeInTheDocument(),
    );

    // Toggle the Pundit filter — only the pundit_takes row should remain.
    await userEvent.click(screen.getByRole('button', { name: 'Pundit' }));

    await waitFor(() => {
      expect(screen.queryByText('Quiet news item.')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('The cosmos stirs.')).not.toBeInTheDocument();
    expect(screen.getByText('A spicy take.')).toBeInTheDocument();
  });

  it('shows the kind-specific empty state when no rows match the filter', async () => {
    // Only news rows in the fixture; filtering by Pundit leaves nothing.
    mockGetRecentNarratives.mockResolvedValue([NEWS_ROW]);

    render(<NewsFeedPage />);

    await waitFor(() =>
      expect(screen.getByText('Quiet news item.')).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Pundit' }));

    await waitFor(() =>
      expect(screen.getByText(/No Pundit transmissions on record yet/i)).toBeInTheDocument(),
    );
  });

  it('renders a Clear button after a filter is applied and clears it on click', async () => {
    render(<NewsFeedPage />);

    await waitFor(() =>
      expect(screen.getByText('Quiet news item.')).toBeInTheDocument(),
    );

    // No Clear button before any filter is selected.
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Pundit' }));

    const clearBtn = await screen.findByRole('button', { name: 'Clear' });
    await userEvent.click(clearBtn);

    // After clearing, all three rows are visible again.
    await waitFor(() =>
      expect(screen.getByText('Quiet news item.')).toBeInTheDocument(),
    );
    expect(screen.getByText('The cosmos stirs.')).toBeInTheDocument();
  });

  it('renders the Load More button only when more rows are available', async () => {
    // Return PAGE_SIZE+1 rows (13) so the page knows another page exists.
    const many = Array.from({ length: 13 }, (_, i) =>
      makeNarrative({ id: `n-${i}`, summary: `Item ${i}` }),
    );
    mockGetRecentNarratives.mockResolvedValue(many);

    render(<NewsFeedPage />);

    await waitFor(() =>
      expect(screen.getByText('Item 0')).toBeInTheDocument(),
    );

    // Load More appears because hasMore = true.
    expect(screen.getByRole('button', { name: 'Load More' })).toBeInTheDocument();
  });
});
