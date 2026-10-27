// ── shared/ui/primitives.test.tsx ─────────────────────────────────────────
// Smoke tests for the Kicker / Pip / StatPair / KeyValue primitives (#378),
// now on the design tokens: label type, secondary tone, caller colours.

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Kicker, Pip, StatPair, KeyValue } from './index';
import { color } from '../design';

describe('Kicker', () => {
  it('renders children in the label type and secondary tone', () => {
    const { getByText, container } = render(<Kicker>Live</Kicker>);
    expect(getByText('Live')).toBeTruthy();
    const root = container.firstChild as HTMLElement;
    expect(root.tagName).toBe('SPAN');
    expect(root.style.textTransform).toBe('uppercase');
    expect(root.style.fontSize).toBe('var(--isl-size-label)');
    expect(root.style.letterSpacing).toBe('var(--isl-tracking-label)');
    expect(root.style.color).toBe('var(--isl-text-secondary)');
  });

  it('applies a colour token via the color prop', () => {
    const { container } = render(<Kicker color={color.architect}>Now</Kicker>);
    expect((container.firstChild as HTMLElement).style.color).toBe('var(--isl-architect)');
  });
});

describe('Pip', () => {
  it('renders a circular inline span with the requested fill', () => {
    const { container } = render(<Pip color={color.success} />);
    const root = container.firstChild as HTMLElement;
    expect(root.tagName).toBe('SPAN');
    expect(root.style.display).toBe('inline-block');
    expect(root.style.borderRadius).toBe('50%');
    expect(root.style.width).toBe('8px');
    expect(root.style.height).toBe('8px');
    expect(root.style.background).toBe('var(--isl-success)');
  });

  it('respects custom size and border tokens', () => {
    const { container } = render(<Pip color={color.live} size={12} border={color.line} />);
    const root = container.firstChild as HTMLElement;
    expect(root.style.width).toBe('12px');
    expect(root.style.height).toBe('12px');
    expect(root.style.borderWidth).toBe('1px');
    expect(root.style.borderColor).toBe('var(--isl-line)');
  });
});

describe('StatPair', () => {
  it('renders the label above the value', () => {
    const { getByText } = render(<StatPair label="GOALS" value={42} />);
    expect(getByText('GOALS').style.fontSize).toBe('var(--isl-size-label)');
    expect(getByText('42').style.fontSize).toBe('var(--isl-size-small)');
  });

  it('applies a value colour token for status emphasis', () => {
    const { getByText } = render(
      <StatPair label="STATUS" value="WON" valueColor={color.success} />,
    );
    expect((getByText('WON') as HTMLElement).style.color).toBe('var(--isl-success)');
  });
});

describe('KeyValue', () => {
  it('renders label and value in a horizontal flex row', () => {
    const { getByText, container } = render(
      <KeyValue label="Stadium" value="Memorial Arena" />,
    );
    expect(getByText('Stadium')).toBeTruthy();
    expect(getByText('Memorial Arena')).toBeTruthy();
    const root = container.firstChild as HTMLElement;
    expect(root.style.display).toBe('flex');
    expect(root.style.alignItems).toBe('baseline');
  });

  it('accepts a ReactNode value', () => {
    const { getByTestId } = render(
      <KeyValue label="Status" value={<span data-testid="value-node">Live</span>} />,
    );
    expect(getByTestId('value-node').textContent).toBe('Live');
  });
});
