// ── components/chrome.test.tsx ────────────────────────────────────────────
// The site chrome and the error screens after group 5a
// (docs/design-language.md):
//   - signed out, the header's Sign up is a SECONDARY button, so the page's
//     own call to action is the view's only orange (primary) button;
//   - the active nav item is marked with aria-current and the full text
//     tone, inactive items the secondary tone, never purple;
//   - the per-route error screen and Not found each render exactly one h1
//     (the shared PageHeader) and exactly one action.

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ user: null as null | { id: string; email: string }, profile: null as null | Record<string, unknown> }));
vi.mock('../features/auth', () => ({
  useAuth: () => ({ ...auth, signOut: vi.fn() }),
}));
vi.mock('../shared/observability/sentry', () => ({ captureException: vi.fn() }));

import Header from './Header';
import RouteErrorBoundary from './RouteErrorBoundary';
import ErrorBoundary from './ErrorBoundary';
import NotFound from '../pages/NotFound';

describe('Header', () => {
  it('signed out: Sign up is a secondary (hairline) button, not the orange primary', () => {
    auth.user = null;
    render(<MemoryRouter initialEntries={['/matches']}><Header /></MemoryRouter>);
    const signUp = screen.getByRole('link', { name: 'Sign up' });
    expect(signUp.style.background).toBe('transparent');
    expect(signUp.style.background).not.toContain('--isl-action');
  });

  it('marks the active page with aria-current and the full text tone', () => {
    auth.user = null;
    render(<MemoryRouter initialEntries={['/matches']}><Header /></MemoryRouter>);
    const active = screen.getByRole('link', { name: 'Matches' });
    expect(active.getAttribute('aria-current')).toBe('page');
    expect(active.style.color).toBe('var(--isl-text)');
    expect(active.style.textDecorationLine).toBe('underline');
    const idle = screen.getByRole('link', { name: 'News' });
    expect(idle.getAttribute('aria-current')).toBeNull();
    expect(idle.style.color).toBe('var(--isl-text-secondary)');
    expect(idle.style.fontSize).toBe('var(--isl-size-label)');
  });

  it('signed in: the credit balance is in the default tone (no orange)', () => {
    auth.user = { id: 'u', email: 'fan@example.com' };
    auth.profile = { credits: 1240, username: 'Stargazer' };
    render(<MemoryRouter><Header /></MemoryRouter>);
    const trigger = screen.getByRole('button', { name: /Stargazer/ });
    expect(trigger.innerHTML).not.toContain('--isl-action');
    auth.user = null;
    auth.profile = null;
  });
});

function Boom(): never {
  throw new Error('kaboom');
}

/** Silence the expected render error (React logs it and jsdom reports it). */
function quiet(): () => void {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const swallow = (e: ErrorEvent) => e.preventDefault();
  window.addEventListener('error', swallow);
  return () => { spy.mockRestore(); window.removeEventListener('error', swallow); };
}

describe('error screens', () => {
  it('a page that throws gets one h1 and one Reload action, inside the site chrome', () => {
    const restore = quiet();
    const { container } = render(
      <MemoryRouter>
        <RouteErrorBoundary><Boom /></RouteErrorBoundary>
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Reload' })).toHaveLength(1);
    expect(container.querySelector('footer')).not.toBeNull();
    restore();
  });

  it('the app-level boundary renders one h1 and one Reload action without a router', () => {
    const restore = quiet();
    const { container } = render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Reload' })).toHaveLength(1);
    expect(screen.getByText('kaboom')).toBeTruthy();
    restore();
  });

  it('Not found renders one h1 and one tertiary way home', () => {
    auth.user = null;
    const { container } = render(<MemoryRouter><NotFound /></MemoryRouter>);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    const home = screen.getByRole('link', { name: /Back to the league/ });
    expect(home.getAttribute('href')).toBe('/');
    expect(home.style.background).toBe('transparent');
  });
});
