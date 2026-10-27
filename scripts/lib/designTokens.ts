// ── scripts/lib/designTokens.ts ──────────────────────────────────────────────
// Find raw style values in src/: the things the design tokens replace.
//
// The design language (docs/design-language.md, section 8) says a page never
// writes a raw font size, colour, Lunar Dust opacity or letter spacing; it
// uses the tokens in src/shared/design. This scanner is the enforcement. Like
// scripts/lib/fanCopy.ts it parses every source file with the TypeScript
// compiler, so comments are never matched, and it inspects:
//
//   fontSize       a `fontSize` property or JSX attribute whose value holds a
//                  number or string literal other than a `var(--isl-...)`
//                  reference, plus `font-size:` declarations inside strings
//                  and template text (the <style> blocks pages embed);
//   letterSpacing  the same for `letterSpacing` / `letter-spacing:`;
//   colour         hex colours and rgb()/rgba()/hsl()/hsla() inside strings
//                  and template text;
//   dust           Lunar Dust opacities, rgba(227, 224, 213, x): counted on
//                  their own (and not again as a colour) because they are the
//                  contrast failures the text tones replace.
//
// Not scanned: test files, type declarations, the token files themselves
// (src/shared/design/), the generated database types and the club colours
// in src/data/leagueData.ts (club colour is data, not chrome).
//
// Known blind spot: a literal hidden behind a constant (`const SIZE = 13;
// ... fontSize: SIZE`) is not counted. The ratchet still catches the common
// case, and review catches the rest.

import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** The four kinds of raw value the guard counts. */
export type RawKind = 'fontSize' | 'letterSpacing' | 'colour' | 'dust';
export const RAW_KINDS: readonly RawKind[] = ['fontSize', 'letterSpacing', 'colour', 'dust'];

/** Raw-value counts for one file (kinds with zero hits are omitted). */
export type RawCounts = Partial<Record<RawKind, number>>;

/** One raw value, for reporting. */
export interface RawHit {
  file: string;
  line: number;
  kind: RawKind;
  text: string;
}

const SKIP_FILE = /(\.test|\.spec)\.tsx?$|\.d\.ts$/;
/** Repo-relative paths (forward slashes) excluded from the scan. */
export const SKIP_PATHS = ['src/types/database.ts', 'src/data/leagueData.ts'];
/** Repo-relative directory prefixes excluded from the scan. */
export const SKIP_DIRS = ['src/shared/design/'];

const TOKEN_REF = /^\s*var\(--isl-[a-z0-9-]+\)\s*$/;
/** Keywords that are not a size or spacing choice. */
const NEUTRAL = /^\s*(inherit|initial|unset|normal|0)\s*$/;
const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g;
const FUNC_COLOUR = /\b(?:rgba?|hsla?)\(/gi;
/** A colour function whose first argument is the substitution that follows. */
const COMPUTED_COLOUR = /\b(?:rgba?|hsla?)\(\s*$/i;
const DUST = /rgba?\(\s*227\s*,\s*224\s*,\s*213/gi;
const CSS_FONT_SIZE = /font-size\s*:\s*([^;}"'`]+)/gi;
const CSS_LETTER_SPACING = /letter-spacing\s*:\s*([^;}"'`]+)/gi;

const PROP_KIND: Record<string, RawKind> = {
  fontSize: 'fontSize',
  'font-size': 'fontSize',
  letterSpacing: 'letterSpacing',
  'letter-spacing': 'letterSpacing',
};

function listSources(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listSources(p, out);
    else if (/\.tsx?$/.test(name) && !SKIP_FILE.test(name)) out.push(p);
  }
}

/** True when a value literal is a raw choice rather than a token or keyword. */
function isRawLiteral(node: ts.Node): boolean {
  if (ts.isNumericLiteral(node)) return Number(node.text) !== 0;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return !TOKEN_REF.test(node.text) && !NEUTRAL.test(node.text) && node.text.trim() !== '';
  }
  if (ts.isTemplateExpression(node)) return true;
  return false;
}

/** Does this property value hold a raw literal (through ?:, ||, ??, parens)? */
function valueHasRawLiteral(node: ts.Node): boolean {
  if (isRawLiteral(node)) return true;
  if (ts.isParenthesizedExpression(node)) return valueHasRawLiteral(node.expression);
  if (ts.isConditionalExpression(node)) {
    return valueHasRawLiteral(node.whenTrue) || valueHasRawLiteral(node.whenFalse);
  }
  if (ts.isBinaryExpression(node)) {
    return valueHasRawLiteral(node.left) || valueHasRawLiteral(node.right);
  }
  if (ts.isJsxExpression(node) && node.expression) return valueHasRawLiteral(node.expression);
  return false;
}

function propName(name: ts.PropertyName | ts.JsxAttributeName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

/** Count CSS declarations in text whose value is not a token. */
function countCss(text: string, re: RegExp): number {
  let n = 0;
  for (const m of text.matchAll(re)) {
    const value = (m[1] ?? '').replace(/!important/g, '').trim();
    if (value && !TOKEN_REF.test(value) && !NEUTRAL.test(value)) n++;
  }
  return n;
}

/** Raw values in one file's source text. */
export function scanSource(fileName: string, source: string): Omit<RawHit, 'file'>[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits: Omit<RawHit, 'file'>[] = [];
  const at = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const push = (node: ts.Node, kind: RawKind, count: number) => {
    const text = node.getText(sf).replace(/\s+/g, ' ').slice(0, 120);
    for (let i = 0; i < count; i++) hits.push({ line: at(node), kind, text });
  };

  const visit = (node: ts.Node): void => {
    // fontSize: 13 / letterSpacing: '0.14em' (object literal properties).
    if (ts.isPropertyAssignment(node)) {
      const name = propName(node.name);
      const kind = name ? PROP_KIND[name] : undefined;
      if (kind && valueHasRawLiteral(node.initializer)) push(node, kind, 1);
    }
    // <text fontSize={12} letterSpacing="2"> (SVG / JSX attributes).
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = propName(node.name);
      const kind = name ? PROP_KIND[name] : undefined;
      if (kind && valueHasRawLiteral(node.initializer)) push(node, kind, 1);
    }
    // Colours and CSS declarations inside any text.
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text;
    if (text !== null && !ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent)) {
      const dust = (text.match(DUST) ?? []).length;
      // A colour function opened at the end of a template chunk, so its first
      // argument is an interpolation (`rgb(${r},${g},${b})`), builds a colour
      // from computed channels (the match viewer's cel shading). That is
      // arithmetic on a token, not a raw value choice, so it is not counted.
      // A literal channel anywhere in the chunk (`rgba(227, ${a})`) still is.
      const computed = (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) && COMPUTED_COLOUR.test(text) ? 1 : 0;
      const funcs = (text.match(FUNC_COLOUR) ?? []).length - dust - computed;
      const hex = (text.match(HEX) ?? []).length;
      if (dust > 0) push(node, 'dust', dust);
      if (funcs + hex > 0) push(node, 'colour', funcs + hex);
      const fs = countCss(text, CSS_FONT_SIZE);
      if (fs > 0) push(node, 'fontSize', fs);
      const ls = countCss(text, CSS_LETTER_SPACING);
      if (ls > 0) push(node, 'letterSpacing', ls);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** Repo-relative, forward-slash path of a file under `repoRoot`. */
function rel(repoRoot: string, file: string): string {
  return relative(repoRoot, file).split(sep).join('/');
}

/** Every raw value under `<repoRoot>/src`, minus the exclusions. */
export function findRawValues(repoRoot: string): RawHit[] {
  const files: string[] = [];
  listSources(join(repoRoot, 'src'), files);
  const hits: RawHit[] = [];
  for (const file of files) {
    const r = rel(repoRoot, file);
    if (SKIP_PATHS.includes(r) || SKIP_DIRS.some((d) => r.startsWith(d))) continue;
    for (const h of scanSource(file, readFileSync(file, 'utf8'))) hits.push({ file: r, ...h });
  }
  return hits;
}

/** Fold hits into per-file counts, files sorted, zero kinds omitted. */
export function countByFile(hits: RawHit[]): Record<string, RawCounts> {
  const out: Record<string, RawCounts> = {};
  for (const h of hits) {
    const c = (out[h.file] ??= {});
    c[h.kind] = (c[h.kind] ?? 0) + 1;
  }
  return Object.fromEntries(Object.keys(out).sort().map((f) => [f, out[f]!]));
}

/** Sum of every kind in a counts record. */
export function total(c: RawCounts | undefined): number {
  return RAW_KINDS.reduce((n, k) => n + (c?.[k] ?? 0), 0);
}

/** A file whose count rose above the baseline (or appeared with any). */
export interface Regression {
  file: string;
  kind: RawKind;
  baseline: number;
  now: number;
}

/** Files and kinds that exceed the baseline. */
export function regressions(
  baseline: Record<string, RawCounts>,
  current: Record<string, RawCounts>,
): Regression[] {
  const out: Regression[] = [];
  for (const [file, counts] of Object.entries(current)) {
    for (const kind of RAW_KINDS) {
      const now = counts[kind] ?? 0;
      const was = baseline[file]?.[kind] ?? 0;
      if (now > was) out.push({ file, kind, baseline: was, now });
    }
  }
  return out;
}
