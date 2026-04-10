// ── Prettier configuration ──────────────────────────────────────────────────
// WHY: Prettier is the single source of truth for code formatting. The
// engineering principles explicitly call out "no style debates in review",
// and Prettier achieves that by mechanically rewriting every file to a
// consistent shape. ESLint (via eslint-config-prettier) is configured to
// stand aside on anything Prettier cares about.
//
// CHOICES:
// - singleQuote: true — matches the existing JS/JSX codebase style. Double
//   quotes are still used inside JSX attributes automatically.
// - semi: true — explicit semicolons. The existing code is inconsistent
//   here; Prettier will normalize on the next run.
// - trailingComma: 'all' — safer diffs when adding items to arrays/objects
//   and required by ES2017+ function trailing commas.
// - printWidth: 100 — a readable balance between "narrow enough to review"
//   and "wide enough not to wrap constantly". The existing codebase has
//   several files with very long lines; those will reflow on first format.
// - arrowParens: 'always' — consistent parens on arrow function params
//   (x) => x rather than x => x. Reduces diff churn when a second param
//   is later added.

/** @type {import('prettier').Config} */
export default {
  // String quoting — single quotes match existing codebase style.
  singleQuote: true,

  // Explicit semicolons at statement ends.
  semi: true,

  // Trailing commas everywhere they're legal (ES2017+ function args).
  // Safer diffs; each new line is +1 instead of rewriting the previous.
  trailingComma: 'all',

  // 100 chars — wide enough for real code, narrow enough to review in
  // split-pane. The existing codebase has some files wider than this;
  // those will reflow on first `npm run format`.
  printWidth: 100,

  // Always wrap arrow function parameters in parens, even for single
  // arguments. Consistent shape; less churn when adding params.
  arrowParens: 'always',

  // 2-space indent matches the existing codebase.
  tabWidth: 2,
  useTabs: false,

  // Leave EOLs alone — respects existing .gitattributes.
  endOfLine: 'lf',
};
