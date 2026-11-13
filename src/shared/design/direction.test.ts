import { describe, expect, it } from 'vitest';
import { DIRECTIONS, resolveDirection } from './direction';

describe('resolveDirection', () => {
  it('shows nothing for a fan who never followed a preview link', () => {
    expect(resolveDirection('', null)).toEqual({ direction: null, store: undefined });
  });

  it('turns a preview on from the URL and remembers it', () => {
    expect(resolveDirection('?direction=broadcast', null)).toEqual({ direction: 'broadcast', store: 'broadcast' });
  });

  it('accepts any case and surrounding spaces', () => {
    expect(resolveDirection('?direction=%20Almanac%20', null).direction).toBe('almanac');
  });

  it('keeps a remembered preview on later pages without the parameter', () => {
    expect(resolveDirection('?tab=squad', 'terminal')).toEqual({ direction: 'terminal', store: undefined });
  });

  it('switches off and forgets with off, current or none', () => {
    for (const v of ['off', 'current', 'none']) {
      expect(resolveDirection(`?direction=${v}`, 'broadcast')).toEqual({ direction: null, store: null });
    }
  });

  it('ignores an unknown value in the URL and in storage', () => {
    expect(resolveDirection('?direction=vaporwave', 'terminal')).toEqual({ direction: 'terminal', store: undefined });
    expect(resolveDirection('', 'vaporwave')).toEqual({ direction: null, store: undefined });
  });

  it('lists the three directions tokens.css styles', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(process.cwd(), 'src', 'shared', 'design', 'tokens.css'), 'utf8');
    for (const d of DIRECTIONS) expect(css, `tokens.css has no block for ${d}`).toContain(`html[data-direction="${d}"]`);
  });
});
