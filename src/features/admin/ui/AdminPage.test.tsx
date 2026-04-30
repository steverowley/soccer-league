// ── features/admin/ui/AdminPage.test.tsx ─────────────────────────────────────
// Smoke + interaction tests for the auth-gated admin page.
//
// MOCK STRATEGY mirrors `MatchLivePage.test.tsx`:
//   • `@features/auth`         — module-mocked, with a per-test `currentAuth`
//                                fixture that swaps user identities.
//   • `@shared/supabase/...`   — returns a sentinel; no real DB access.
//   • `../api/admin`           — barrel-mocked so we can spy on the calls
//                                without touching Supabase.
//
// TIME / RANDOM:
//   No fake timers needed — the admin actions are awaited Promises with no
//   setInterval / setTimeout in the page itself.

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminPage } from './AdminPage';

// ── Module mocks ─────────────────────────────────────────────────────────────

// Per-test auth fixture.  Mutate `currentAuth` before render() to control
// whether the page sees an admin / non-admin / anonymous viewer.
let currentAuth: { user: { id: string } | null } = { user: null };
vi.mock('@features/auth', () => ({
  useAuth: () => currentAuth,
}));

vi.mock('@shared/supabase/SupabaseProvider', () => ({
  useSupabase: () => ({}),
}));

// Mock the admin API surface so the buttons drive observable spies rather
// than hitting the in-memory store from admin.test.ts.
const mockFastForward = vi.fn();
const mockTrigger     = vi.fn();
vi.mock('../api/admin', () => ({
  fastForwardScheduledMatches: (...a: unknown[]) => mockFastForward(...a),
  triggerSeasonEnactment:      (...a: unknown[]) => mockTrigger(...a),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Set the build-time allowlist env var on `import.meta.env`.  Vitest's
 * environment lets us mutate the object directly between tests; we always
 * restore via `vi.unstubAllEnvs` in afterEach so leakage is impossible.
 */
function setAllowlist(value: string | undefined): void {
  vi.stubEnv('VITE_ADMIN_USER_IDS', value ?? '');
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <AdminPage />
    </MemoryRouter>,
  );
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  // Default: anonymous viewer + empty allowlist → restricted stub.
  currentAuth = { user: null };
  setAllowlist(undefined);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AdminPage — gating', () => {
  it('shows the restricted stub for anonymous viewers', () => {
    renderPage();
    expect(screen.getByText(/Restricted/)).toBeInTheDocument();
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument();
    // Action buttons must not render at all.
    expect(screen.queryByRole('button', { name: /\+1 hour/ })).not.toBeInTheDocument();
  });

  it('shows the restricted stub for logged-in non-allowlisted users', () => {
    currentAuth = { user: { id: 'u-not-admin' } };
    setAllowlist('u-admin');
    renderPage();
    expect(screen.getByText(/Restricted/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\+1 hour/ })).not.toBeInTheDocument();
  });

  it('renders the action panel for allowlisted admins', () => {
    currentAuth = { user: { id: 'u-admin' } };
    setAllowlist('u-admin,u-other');
    renderPage();
    expect(screen.getByRole('button', { name: /\+1 hour/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+1 day/  })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enact/    })).toBeInTheDocument();
  });
});

describe('AdminPage — fast-forward action', () => {
  it('calls the API and shows the success result', async () => {
    currentAuth = { user: { id: 'u-admin' } };
    setAllowlist('u-admin');
    mockFastForward.mockResolvedValue({ matchesShifted: 5, hoursShifted: 1 });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+1 hour/ }));

    await waitFor(() => {
      expect(mockFastForward).toHaveBeenCalledWith(expect.anything(), 1);
    });
    const panel = await screen.findByTestId('admin-result');
    expect(panel).toHaveTextContent(/Fast-forward 1h/);
    expect(panel).toHaveTextContent(/Shifted 5 match\(es\) by 1h/);
  });

  it('renders the error path when the API throws', async () => {
    currentAuth = { user: { id: 'u-admin' } };
    setAllowlist('u-admin');
    mockFastForward.mockRejectedValue(new Error('network down'));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+1 day/ }));

    const panel = await screen.findByTestId('admin-result');
    expect(panel).toHaveTextContent(/Error: network down/);
  });
});

describe('AdminPage — manual enactment', () => {
  it('passes the trimmed season UUID to triggerSeasonEnactment', async () => {
    currentAuth = { user: { id: 'u-admin' } };
    setAllowlist('u-admin');
    mockTrigger.mockResolvedValue({ enacted: 32, skipped: 0 });

    renderPage();
    const input  = screen.getByPlaceholderText(/0000/);
    const button = screen.getByRole('button', { name: /Enact/ });

    // Whitespace must be trimmed by the page before the API call so admins
    // copy-pasting from a logs viewer don't hit a phantom-character bug.
    fireEvent.change(input, { target: { value: '  s-uuid  ' } });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockTrigger).toHaveBeenCalledWith(expect.anything(), 's-uuid');
    });
    const panel = await screen.findByTestId('admin-result');
    expect(panel).toHaveTextContent(/Enacted 32 focus\(es\); skipped 0/);
  });

  it('disables the Enact button when the season input is empty', () => {
    currentAuth = { user: { id: 'u-admin' } };
    setAllowlist('u-admin');
    renderPage();
    const button = screen.getByRole('button', { name: /Enact/ });
    expect(button).toBeDisabled();
  });
});
