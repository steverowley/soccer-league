// ── shared/ui/Toast.test.tsx ──────────────────────────────────────────────
// Unit tests for the global toast surface (#383).
//
// Covers the contract that production code relies on:
//   • useToast() returns a stable api outside of provider → throws.
//   • toast.success / .error / .info append to the queue with the
//     correct kind.
//   • The viewport renders one role="status" per queued toast.
//   • Pushing past TOAST_MAX_VISIBLE evicts oldest entries FIFO.
//   • Auto-dismiss removes a toast at the configured duration.
//   • dismiss(id) removes the matching toast immediately.

import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { ToastProvider, ToastViewport, useToast } from './Toast';

// ── Test harness ─────────────────────────────────────────────────────────────

/**
 * Tiny consumer component used by every test to push toasts into the
 * provider from the React tree.  Click handlers do exactly one thing
 * each so individual assertions can be made on a clean slate.
 */
function TestConsumer() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.success('Saved')}>success</button>
      <button onClick={() => toast.error('Failed')}>error</button>
      <button onClick={() => toast.info('FYI')}>info</button>
      <button onClick={() => {
        // Fire 6 toasts so we exceed the visible cap (4).
        toast.info('1');
        toast.info('2');
        toast.info('3');
        toast.info('4');
        toast.info('5');
        toast.info('6');
      }}>flood</button>
    </>
  );
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when useToast is called outside a provider', () => {
    // Silence the expected React error log so test output stays clean.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(/inside <ToastProvider>/);
    errSpy.mockRestore();
  });

  it('renders success / error / info toasts with the correct kinds', () => {
    render(
      <ToastProvider>
        <TestConsumer />
        <ToastViewport />
      </ToastProvider>,
    );

    act(() => { screen.getByText('success').click(); });
    act(() => { screen.getByText('error').click();   });
    act(() => { screen.getByText('info').click();    });

    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(3);
    expect(statuses[0]?.textContent).toContain('Saved');
    expect(statuses[1]?.textContent).toContain('Failed');
    expect(statuses[2]?.textContent).toContain('FYI');
  });

  it('caps the visible queue and evicts oldest entries FIFO', () => {
    render(
      <ToastProvider>
        <TestConsumer />
        <ToastViewport />
      </ToastProvider>,
    );

    act(() => { screen.getByText('flood').click(); });

    const statuses = screen.getAllByRole('status');
    // TOAST_MAX_VISIBLE = 4.  We pushed 6, so '1' and '2' should have
    // been evicted; the remaining list is [3, 4, 5, 6] in push order.
    expect(statuses).toHaveLength(4);
    expect(statuses.map((s) => s.textContent)).toEqual(
      expect.arrayContaining(['3', '4', '5', '6'].map((s) => expect.stringContaining(s))),
    );
    expect(statuses.some((s) => s.textContent?.includes('1'))).toBe(false);
    expect(statuses.some((s) => s.textContent?.includes('2'))).toBe(false);
  });

  it('auto-dismisses a toast after the configured duration', () => {
    render(
      <ToastProvider>
        <TestConsumer />
        <ToastViewport />
      </ToastProvider>,
    );

    act(() => { screen.getByText('success').click(); });
    expect(screen.getAllByRole('status')).toHaveLength(1);

    // TOAST_DURATION_MS is 4000, sweeper ticks every 1000.  Advance
    // 5 s to be safely past both numbers.
    act(() => { vi.advanceTimersByTime(5000); });

    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  it('dismisses immediately via the × button', () => {
    render(
      <ToastProvider>
        <TestConsumer />
        <ToastViewport />
      </ToastProvider>,
    );

    act(() => { screen.getByText('success').click(); });
    expect(screen.getAllByRole('status')).toHaveLength(1);

    act(() => {
      screen.getByLabelText('Dismiss notification').click();
    });
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });
});
