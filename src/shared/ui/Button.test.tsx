// ── shared/ui/Button.test.tsx ─────────────────────────────────────────────
// Behavioural coverage for the polymorphic Button primitive: it renders the
// right element per props (Link / anchor / button), carries variant colours,
// appends the tertiary arrow, lights its glow on hover, and respects disabled.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Button } from './Button';
import { COLORS } from '../../components/Layout';

/** Render inside a router so <Link> has the context it needs. */
function renderInRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('Button', () => {
  it('renders a router link when `to` is provided', () => {
    renderInRouter(<Button to="/login">Sign Up</Button>);
    const el = screen.getByRole('link', { name: 'Sign Up' });
    expect(el.getAttribute('href')).toBe('/login');
  });

  it('renders an external anchor when `href` is provided', () => {
    renderInRouter(
      <Button href="https://example.com" target="_blank">
        Docs
      </Button>,
    );
    const el = screen.getByRole('link', { name: 'Docs' });
    expect(el.getAttribute('href')).toBe('https://example.com');
    // External targets get the security rel.
    expect(el.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders a <button> and fires onClick when neither `to` nor `href` is set', () => {
    const onClick = vi.fn();
    renderInRouter(<Button onClick={onClick}>Save</Button>);
    const el = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('applies the Astro-orange fill for the active variant', () => {
    renderInRouter(
      <Button variant="active" onClick={() => {}}>
        Place Wager
      </Button>,
    );
    const el = screen.getByRole('button', { name: 'Place Wager' });
    // jsdom normalises the hex to rgb.
    expect(el.style.background).toContain('255, 102, 55');
    expect(el.style.color).toContain('17, 17, 17'); // abyss text
  });

  it('appends the ► glyph for the tertiary variant', () => {
    renderInRouter(
      <Button variant="tertiary" to="/matches">
        View all matches
      </Button>,
    );
    expect(screen.getByText('►')).toBeInTheDocument();
  });

  it('lights the hover glow on mouse enter and drops it on leave', () => {
    renderInRouter(
      <Button variant="active" onClick={() => {}}>
        Hover me
      </Button>,
    );
    const el = screen.getByRole('button', { name: 'Hover me' });
    expect(el.style.boxShadow).toBe('');
    fireEvent.mouseEnter(el);
    expect(el.style.boxShadow).toContain('255, 102, 55');
    fireEvent.mouseLeave(el);
    expect(el.style.boxShadow).toBe('');
  });

  it('dims and suppresses the glow when disabled', () => {
    renderInRouter(
      <Button onClick={() => {}} disabled>
        Nope
      </Button>,
    );
    const el = screen.getByRole('button', { name: 'Nope' }) as HTMLButtonElement;
    expect(el.disabled).toBe(true);
    expect(el.style.opacity).toBe('0.45');
    fireEvent.mouseEnter(el);
    expect(el.style.boxShadow).toBe('');
  });

  it('uses the dust fill + abyss text for the secondary variant', () => {
    renderInRouter(
      <Button variant="secondary" onClick={() => {}}>
        View league
      </Button>,
    );
    const el = screen.getByRole('button', { name: 'View league' });
    expect(el.style.background.toLowerCase()).toContain('227, 224, 213');
    // Sanity: the token still resolves to the documented dust hex.
    expect(COLORS.dust).toBe('#E3E0D5');
  });
});
