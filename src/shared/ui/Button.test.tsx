// ── shared/ui/Button.test.tsx ─────────────────────────────────────────────
// Behavioural coverage for the polymorphic Button: it renders the right
// element per props (Link / anchor / button), carries the design-language
// variant tokens, appends the tertiary marker, lights its glow on hover, and
// respects disabled.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Button } from './Button';

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

  it('fills the primary variant with the action colour and abyss text', () => {
    renderInRouter(
      <Button variant="primary" onClick={() => {}}>
        Place Wager
      </Button>,
    );
    const el = screen.getByRole('button', { name: 'Place Wager' });
    expect(el.style.background).toBe('var(--isl-action)');
    expect(el.style.color).toBe('var(--isl-bg)');
  });

  it('defaults to the secondary hairline outline', () => {
    renderInRouter(<Button onClick={() => {}}>View league</Button>);
    const el = screen.getByRole('button', { name: 'View league' });
    expect(el.style.background).toBe('transparent');
    expect(el.style.borderColor).toBe('var(--isl-text)');
    expect(el.style.borderWidth).toBe('1px');
  });

  it('uses the label type and a 44 px touch target', () => {
    renderInRouter(<Button onClick={() => {}}>Tap</Button>);
    const el = screen.getByRole('button', { name: 'Tap' });
    expect(el.style.fontSize).toBe('var(--isl-size-label)');
    expect(el.style.letterSpacing).toBe('var(--isl-tracking-label)');
    expect(el.style.minHeight).toBe('44px');
  });

  it('appends the ▸ marker for the tertiary variant', () => {
    renderInRouter(
      <Button variant="tertiary" to="/matches">
        All matches
      </Button>,
    );
    expect(screen.getByText('\u25B8')).toBeInTheDocument();
  });

  it('lights the hover glow on mouse enter and drops it on leave', () => {
    renderInRouter(
      <Button variant="primary" onClick={() => {}}>
        Hover me
      </Button>,
    );
    const el = screen.getByRole('button', { name: 'Hover me' });
    expect(el.style.boxShadow).toBe('');
    fireEvent.mouseEnter(el);
    expect(el.style.boxShadow).toBe('var(--isl-glow-action)');
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
});
