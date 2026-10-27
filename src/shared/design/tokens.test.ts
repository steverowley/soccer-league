// ── shared/design/tokens.test.ts ────────────────────────────────────────────
// tokens.ts must agree with tokens.css, the one file that documents every
// value. Two halves are checked:
//   - every `var(--isl-...)` the typed presets reference is declared in
//     tokens.css (a typo would render as the browser default, silently);
//   - every literal in `canvasColor` (the match viewer's canvas palette,
//     which cannot use CSS variables) equals the value of the custom
//     property `canvasColorVar` names, parsed from tokens.css. A colour
//     changed in one file and not the other fails here.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canvasColor, canvasColorVar, color, glow, layout, size, tracking } from './tokens';

const css = readFileSync(join(process.cwd(), 'src', 'shared', 'design', 'tokens.css'), 'utf8');

/**
 * Custom properties declared in the first `:root` block (the desktop and
 * canvas values; the phone block only overrides sizes and rhythm).
 *
 * @returns Map of property name to its raw value text.
 */
function rootProperties(source: string): Map<string, string> {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const block = /:root\s*\{([^}]*)\}/.exec(withoutComments)?.[1] ?? '';
  const out = new Map<string, string>();
  for (const m of block.matchAll(/(--isl-[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim());
  return out;
}

/** Compare colour text the way a browser would: case and spaces ignored. */
const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase();

const props = rootProperties(css);

describe('tokens.ts mirrors tokens.css', () => {
  it('parses the root block', () => {
    expect(props.get('--isl-text')).toBe('#E3E0D5');
    expect(props.size).toBeGreaterThan(30);
  });

  it('every var() the presets reference is declared', () => {
    const refs = [color, glow, layout, size, tracking]
      .flatMap((group) => Object.values(group))
      .map((v) => /^var\((--isl-[a-z0-9-]+)\)$/.exec(v)?.[1])
      .filter((v): v is string => v != null);
    expect(refs.length).toBeGreaterThan(20);
    for (const name of refs) expect(props.has(name), `${name} is not declared in tokens.css`).toBe(true);
  });

  it('every canvas colour equals its CSS custom property', () => {
    for (const [key, value] of Object.entries(canvasColor)) {
      const name = canvasColorVar[key as keyof typeof canvasColor];
      const declared = props.get(name);
      expect(declared, `${name} (canvasColor.${key}) is not declared in tokens.css`).toBeDefined();
      expect(norm(value), `canvasColor.${key} drifted from ${name}`).toBe(norm(declared!));
    }
  });

  it('the canvas figures share the page tokens for text, background and the Architect', () => {
    expect(canvasColorVar.text).toBe(/var\((.*)\)/.exec(color.text)?.[1]);
    expect(canvasColorVar.bg).toBe(/var\((.*)\)/.exec(color.bg)?.[1]);
    expect(canvasColorVar.architect).toBe(/var\((.*)\)/.exec(color.architect)?.[1]);
  });

  it('fails on a drifted value (the check is not vacuous)', () => {
    const drifted = rootProperties(css.replace('--isl-pitch-grass-a: #131613', '--isl-pitch-grass-a: #141614'));
    expect(norm(drifted.get('--isl-pitch-grass-a')!)).not.toBe(norm(canvasColor.grassA));
  });
});
