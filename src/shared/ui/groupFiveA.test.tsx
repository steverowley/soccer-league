// ── shared/ui/groupFiveA.test.tsx ─────────────────────────────────────────
// The shared pieces group 5a introduced (Field, CheckField, FormError,
// Prose, TextLink) and the token rules it applied to Toast: each renders
// the spec's look from tokens (docs/design-language.md) and keeps its
// accessibility contract (labels tied to controls, errors announced).

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CheckField, Field, FormError, inputStyle } from './Field';
import { Paragraph, Prose, ProseSection, TextLink } from './Prose';
import { ToastProvider, ToastViewport, useToast } from './Toast';

describe('Field', () => {
  it('ties the label to its control and shows hint and error', () => {
    render(
      <Field id="email" label="Email" hint="We never show it." error="Email is required.">
        <input id="email" style={inputStyle} />
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input.id).toBe('email');
    expect(screen.getByText('We never show it.').style.color).toBe('var(--isl-text-secondary)');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Email is required.');
    expect(alert.style.color).toBe('var(--isl-live)');
  });

  it('styles controls on the raised surface with a hairline and a 44 px floor', () => {
    expect(inputStyle.background).toBe('var(--isl-surface-raised)');
    expect(inputStyle.borderColor).toBe('var(--isl-line)');
    expect(inputStyle.minHeight).toBe(44);
    expect(inputStyle.fontSize).toBe('var(--isl-size-body)');
  });
});

describe('CheckField', () => {
  it('toggles from anywhere on its sentence', () => {
    let value = false;
    render(<CheckField id="age" checked={false} onChange={(v) => { value = v; }}>I am 18 or older.</CheckField>);
    fireEvent.click(screen.getByText('I am 18 or older.'));
    expect(value).toBe(true);
  });
});

describe('FormError', () => {
  it('is announced and red', () => {
    render(<FormError>Nope.</FormError>);
    expect(screen.getByRole('alert').style.color).toBe('var(--isl-live)');
  });
});

describe('Prose', () => {
  it('caps prose at the reading measure and numbers sections as h2s', () => {
    const { container } = render(
      <MemoryRouter>
        <Prose>
          <ProseSection index="I" title="The loop">
            <Paragraph>Sign up. <TextLink to="/terms">Terms</TextLink></Paragraph>
          </ProseSection>
          <ProseSection index="II" title="The cast">
            <Paragraph>Vox.</Paragraph>
          </ProseSection>
        </Prose>
      </MemoryRouter>,
    );
    const article = container.querySelector('article')!;
    expect(article.style.maxWidth).toBe('var(--isl-measure)');
    expect(article.style.fontSize).toBe('var(--isl-size-body)');
    const h2s = [...container.querySelectorAll('h2')].map((h) => h.textContent);
    expect(h2s).toEqual(['I \u00B7 The loop', 'II \u00B7 The cast']);
    const link = screen.getByRole('link', { name: 'Terms' });
    expect(link.getAttribute('href')).toBe('/terms');
    expect(link.style.color).toBe('var(--isl-text)');
  });
});

describe('Toast', () => {
  function Push({ kind }: { kind: 'success' | 'error' | 'info' }) {
    const toast = useToast();
    return <button onClick={() => toast[kind](`${kind} message`)}>push {kind}</button>;
  }

  it('shows the kind by border and label on the raised surface, never a fill', () => {
    render(
      <ToastProvider>
        <Push kind="success" />
        <Push kind="error" />
        <Push kind="info" />
        <ToastViewport />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('push success'));
    fireEvent.click(screen.getByText('push error'));
    fireEvent.click(screen.getByText('push info'));
    const byKind = Object.fromEntries(
      screen.getAllByRole('status').map((s) => [s.getAttribute('data-kind'), s as HTMLElement]),
    );
    expect(byKind.success!.style.borderColor).toBe('var(--isl-success)');
    expect(byKind.error!.style.borderColor).toBe('var(--isl-live)');
    expect(byKind.info!.style.borderColor).toBe('var(--isl-line)');
    for (const el of Object.values(byKind)) {
      expect(el.style.background).toBe('var(--isl-surface-raised)');
    }
    expect(byKind.error!.textContent).toContain('Error');
  });
});
