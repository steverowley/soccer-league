// ── shared/ui/Stack.test.tsx ──────────────────────────────────────────────
// The flex layout primitive: column by default, on-scale gaps, the section
// gap, alignment and wrap, the `as` element and passthrough attributes.

import { createRef } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Stack } from './Stack';

const root = (c: HTMLElement) => c.firstChild as HTMLElement;

describe('Stack', () => {
  it('is a flex column with no gap by default', () => {
    const { container } = render(<Stack><span>a</span></Stack>);
    const el = root(container);
    expect(el.tagName).toBe('DIV');
    expect(el.style.display).toBe('flex');
    expect(el.style.flexDirection).toBe('column');
    expect(el.style.gap).toBe('');
    expect(el.style.flexWrap).toBe('');
  });

  it('takes the gap from the spacing scale, and the section gap by name', () => {
    expect(root(render(<Stack gap={12} />).container).style.gap).toBe('12px');
    expect(root(render(<Stack gap="section" />).container).style.gap).toBe('var(--isl-gap-section)');
  });

  it('lays a row out with alignment, distribution and wrap', () => {
    const el = root(render(<Stack direction="row" align="center" justify="space-between" wrap />).container);
    expect(el.style.flexDirection).toBe('row');
    expect(el.style.alignItems).toBe('center');
    expect(el.style.justifyContent).toBe('space-between');
    expect(el.style.flexWrap).toBe('wrap');
  });

  it('renders the semantic element asked for and passes attributes through', () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    const { container, getByRole } = render(
      <Stack as="form" aria-label="Sign in" onSubmit={onSubmit} noValidate gap={16}>
        <button type="submit">Go</button>
      </Stack>,
    );
    const form = root(container);
    expect(form.tagName).toBe('FORM');
    expect(form.getAttribute('aria-label')).toBe('Sign in');
    expect(form.hasAttribute('novalidate')).toBe(true);
    fireEvent.click(getByRole('button'));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('merges layout extras from style and forwards a ref', () => {
    const ref = createRef<HTMLElement>();
    const { container } = render(<Stack ref={ref} gap={8} style={{ marginTop: 24, minWidth: 0 }} />);
    const el = root(container);
    expect(el.style.marginTop).toBe('24px');
    expect(el.style.minWidth).toBe('0px');
    expect(el.style.gap).toBe('8px');
    expect(ref.current).toBe(el);
  });
});
