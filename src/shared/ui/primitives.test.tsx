// ── shared/ui/primitives.test.tsx ─────────────────────────────────────────
// Smoke tests for the Kicker / Pip / StatPair / KeyValue primitives
// landed in slice 3a of #378.  Locks down the public surface so
// subsequent migrations can consume a stable API.

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Kicker, Pip, StatPair, KeyValue } from './index';

describe('Kicker', () => {
  it('renders children inside an uppercase mono span', () => {
    const { getByText, container } = render(<Kicker>Live</Kicker>);
    expect(getByText('Live')).toBeTruthy();
    const root = container.firstChild as HTMLElement;
    expect(root.tagName).toBe('SPAN');
    expect(root.style.textTransform).toBe('uppercase');
    expect(root.style.fontSize).toBe('11px');
    expect(root.style.letterSpacing).toBe('0.14em');
  });

  it('applies a custom colour token via the color prop', () => {
    const { container } = render(<Kicker color="#9A5CF4">Now</Kicker>);
    const root = container.firstChild as HTMLElement;
    expect(root.style.color.toLowerCase()).toMatch(/#9a5cf4|rgb\(154, 92, 244\)/);
  });
});

describe('Pip', () => {
  it('renders a circular inline span with the requested fill', () => {
    const { container } = render(<Pip color="#9A5CF4" />);
    const root = container.firstChild as HTMLElement;
    expect(root.tagName).toBe('SPAN');
    expect(root.style.display).toBe('inline-block');
    expect(root.style.borderRadius).toBe('50%');
    expect(root.style.width).toBe('8px');
    expect(root.style.height).toBe('8px');
    expect(root.style.background.toLowerCase()).toMatch(/#9a5cf4|rgb\(154, 92, 244\)/);
  });

  it('respects custom size + border tokens', () => {
    const { container } = render(<Pip color="#FF4F5E" size={12} border="#2E2A24" />);
    const root = container.firstChild as HTMLElement;
    expect(root.style.width).toBe('12px');
    expect(root.style.height).toBe('12px');
    expect(root.style.border.toLowerCase()).toMatch(/1px solid/);
  });
});

describe('StatPair', () => {
  it('renders the label above the value', () => {
    const { getByText } = render(<StatPair label="GOALS" value={42} />);
    expect(getByText('GOALS')).toBeTruthy();
    expect(getByText('42')).toBeTruthy();
  });

  it('applies a value colour override for status emphasis', () => {
    const { getByText } = render(
      <StatPair label="STATUS" value="LIVE" valueColor="#9A5CF4" />,
    );
    const value = getByText('LIVE') as HTMLElement;
    expect(value.style.color.toLowerCase()).toMatch(/#9a5cf4|rgb\(154, 92, 244\)/);
  });
});

describe('KeyValue', () => {
  it('renders label + value in a horizontal flex row', () => {
    const { getByText, container } = render(
      <KeyValue label="Stadium" value="Memorial Arena" />,
    );
    expect(getByText('Stadium')).toBeTruthy();
    expect(getByText('Memorial Arena')).toBeTruthy();
    const root = container.firstChild as HTMLElement;
    expect(root.style.display).toBe('flex');
    expect(root.style.alignItems).toBe('baseline');
  });

  it('accepts a ReactNode value (chip / pip / etc.)', () => {
    const { getByTestId } = render(
      <KeyValue label="Status" value={<span data-testid="value-node">Live</span>} />,
    );
    expect(getByTestId('value-node').textContent).toBe('Live');
  });
});
