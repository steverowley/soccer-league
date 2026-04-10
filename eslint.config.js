// ── ESLint flat-config ──────────────────────────────────────────────────────
// WHY: Phase -1 introduces a shared linting baseline so that (a) feature
// boundaries are mechanically enforced (no cross-feature deep imports), (b)
// common TS pitfalls are caught in review, and (c) style debates are settled
// by Prettier rather than humans.
//
// FLAT CONFIG: this file uses ESLint's flat-config format (the default for
// ESLint 9+). Each array entry is an "override" that applies to matching
// files. Order matters — later entries merge/override earlier ones.
//
// KEY RULES (the ones that aren't just boilerplate):
// - `no-restricted-imports`: forbids cross-feature deep imports. Every
//   feature exports a public API via its `index.ts` barrel, and other
//   features must import from that barrel only. This is the single most
//   important rule for keeping the codebase modular — if this rule is
//   disabled, the feature walls collapse and Phase -1's biggest win is
//   lost.
// - `@typescript-eslint/consistent-type-imports`: enforces `import type`
//   for type-only imports. Complements tsconfig's `verbatimModuleSyntax`
//   and helps tree-shaking.
// - React Hooks rules are enabled but `react-in-jsx-scope` is off because
//   React 17+ automatic JSX runtime means we don't import React just to
//   use JSX.
//
// LEGACY JS FILES: the existing .js/.jsx files are linted with a lighter
// rule set (no TS-specific rules) so Phase -1's initial commit doesn't
// create a sea of lint errors from legacy code. As files are migrated to
// TS they automatically pick up the stricter rule set.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // ── Global ignores ─────────────────────────────────────────────────────────
  // Files that should NEVER be linted: build output, deps, Deno Edge
  // Functions (their own tooling), and the ISL Logo image.
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'supabase/functions/**',
      '*.png',
    ],
  },

  // ── Base recommendations ────────────────────────────────────────────────────
  // Pull in the @eslint/js recommended rule set as the floor for every file.
  js.configs.recommended,

  // ── TypeScript rules (applied to .ts/.tsx only) ─────────────────────────────
  // typescript-eslint's "recommended" set provides safe defaults; we layer
  // project-specific rules on top in the block below.
  ...tseslint.configs.recommended,

  // ── React + React Hooks rules (applied to all .jsx/.tsx) ───────────────────
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // React 17+ automatic JSX runtime: no need to import React in scope.
      'react/react-in-jsx-scope': 'off',
      // PropTypes are superseded by TypeScript prop types.
      'react/prop-types': 'off',
    },
    settings: {
      react: { version: 'detect' },
    },
  },

  // ── Project-wide TS rules (applied to .ts/.tsx only) ───────────────────────
  // These are the rules that make Phase -1's modularity story real.
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Enforce `import type` for type-only imports. Complements
      // tsconfig's `verbatimModuleSyntax` and prevents accidental
      // runtime deps on type-only modules.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // Allow `_prefixed` unused args — useful for callback signatures
      // where we must match an interface but don't need every parameter.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // FEATURE BOUNDARY ENFORCEMENT ────────────────────────────────────────
      // Cross-feature deep imports are forbidden. Features must import each
      // other's public API via the feature's barrel (`@features/{name}`).
      // Deep imports (e.g. `@features/auth/logic/foo`) break encapsulation
      // and turn the codebase into a ball of spaghetti, so this rule is
      // non-negotiable.
      //
      // The patterns say: you may NOT import from `@features/X/...` from
      // anywhere — instead, import from `@features/X` (the barrel). The
      // feature's own internal files can import deeply from themselves
      // because eslint's `no-restricted-imports` operates on the resolved
      // import path, and a file in `features/auth/ui/Foo.tsx` importing
      // `../logic/helper` uses a relative path that isn't matched.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@features/*/*', '@features/*/*/*'],
              message:
                'Cross-feature deep imports are forbidden. Import from the feature barrel instead (e.g. "@features/auth" not "@features/auth/logic/foo"). This preserves the modularity guarantee from Phase -1.',
            },
            {
              group: ['src/features/*/*', 'src/features/*/*/*'],
              message:
                'Use the @features/* alias and import from the feature barrel, not a deep relative path.',
            },
          ],
        },
      ],
    },
  },

  // ── Test files: relaxed rules ──────────────────────────────────────────────
  // Tests often need to import internals to exercise private behavior,
  // and may use `any` to build minimal fixtures. Relax the strictest
  // rules here so the test-writing experience stays friction-free.
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}', 'src/shared/test/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-imports': 'off',
    },
  },

  // ── Legacy JS files: minimal rules ─────────────────────────────────────────
  // During the Phase -1 migration window, existing .js/.jsx files are
  // linted with a lighter rule set (no TS-specific checks, no feature
  // boundary enforcement) so we don't create a sea of errors from code
  // that is already queued for conversion.
  {
    files: ['src/**/*.{js,jsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      'no-restricted-imports': 'off',
      'no-unused-vars': 'off',
      'no-undef': 'off',
      // Legacy JSX files contain bare quotes/entities in JSX text that are
      // technically valid HTML5. Fixing them in Phase -1 would be pure churn —
      // they'll be cleaned up when the component is migrated to TSX.
      'react/no-unescaped-entities': 'off',
      // Legacy files may use regex character classes with combined characters
      // (emoji, Unicode ligatures) as visual styling. Defer fixing to the TS
      // migration of each file.
      'no-misleading-character-class': 'off',
      // Duplicate else-if conditions flagged in pre-existing simulation
      // branching logic. Defer to the TS migration commit of that file.
      'no-dupe-else-if': 'off',
      // react-hooks/preserve-manual-memoization and set-state-in-effect are
      // new rules from eslint-plugin-react-hooks that fire on patterns the
      // legacy components used intentionally. Suppressed for the migration
      // window — each file gets these fixed when it moves to TSX.
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },

  // ── Root-level config files ────────────────────────────────────────────────
  // vite.config.js, vitest.config.ts, eslint.config.js, prettier.config.js
  // all run in Node, not in the browser, so they need Node globals (URL,
  // process, __dirname, etc.). These files live at the repo root (not under
  // src/) so they don't match the other per-directory overrides.
  {
    files: ['*.config.{js,ts}', 'eslint.config.js', 'prettier.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // ── Prettier compatibility ─────────────────────────────────────────────────
  // MUST be last — disables any ESLint rules that conflict with Prettier
  // formatting. Prettier owns formatting; ESLint owns correctness.
  prettier,
);
