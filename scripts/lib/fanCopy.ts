// ── scripts/lib/fanCopy.ts ───────────────────────────────────────────────────
// Find em dashes in text a fan can read.
//
// House style bans the em dash in prose (use a colon, comma, brackets or a new
// sentence). This scanner is the enforcement: it parses every source file with
// the TypeScript compiler and inspects only real text (string literals,
// template text, JSX text), so code comments are never matched and nothing is
// guessed from regexes over source.
//
// Deliberately NOT flagged:
//   - a string that is only a dash (trimmed "—"): the conventional empty-value
//     placeholder in a table cell or heading, a glyph rather than prose;
//   - arguments to console.* calls: developer logs, never shown to a fan;
//   - test files, type declarations and the generated database types.

import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const EM_DASH = '\u2014';

/** Roots that hold fan-facing copy: the web app and the edge functions. */
export const COPY_ROOTS = ['src', 'supabase/functions'];

const SKIP_FILE = /(\.test|\.spec)\.tsx?$|\.d\.ts$/;
const SKIP_PATH = [`src${sep}types${sep}database.ts`];

export interface EmDashHit {
  file: string;
  line: number;
  text: string;
}

function listSources(root: string, dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listSources(root, p, out);
    else if (/\.tsx?$/.test(name) && !SKIP_FILE.test(name)) out.push(p);
  }
}

function isConsoleArgument(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'console'
      )
        return true;
    }
    if (ts.isStatement(n)) return false;
  }
  return false;
}

/** Every em dash in fan-readable text under `repoRoot`. */
export function findEmDashes(repoRoot: string): EmDashHit[] {
  const files: string[] = [];
  for (const r of COPY_ROOTS) listSources(repoRoot, join(repoRoot, r), files);
  const hits: EmDashHit[] = [];

  for (const file of files) {
    const rel = relative(repoRoot, file);
    if (SKIP_PATH.includes(rel)) continue;
    const source = readFileSync(file, 'utf8');
    if (!source.includes(EM_DASH)) continue;
    const sf = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const visit = (node: ts.Node): void => {
      let text: string | null = null;
      // A lone dash is only a placeholder when it is the WHOLE string. A
      // template gap such as `${home} — ${away}` also trims to a lone dash,
      // but it is a separator inside a sentence, so template parts never get
      // the allowance.
      let wholeString = false;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        text = node.text;
        wholeString = true;
      } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
        text = node.text;
      else if (ts.isJsxText(node)) {
        text = node.text;
        wholeString = true;
      }

      const placeholder = wholeString && text !== null && text.trim() === EM_DASH;
      if (text !== null && text.includes(EM_DASH) && !placeholder && !isConsoleArgument(node)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        hits.push({
          file: rel.split(sep).join('/'),
          line: line + 1,
          text: text.trim().slice(0, 160),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return hits;
}
