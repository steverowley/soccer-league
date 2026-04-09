// ── Vitest global test setup ─────────────────────────────────────────────────
// WHY: This file runs once before every test suite (configured via
// `vitest.config.ts → test.setupFiles`). It extends Vitest's `expect` with
// the jest-dom custom matchers so tests can assert on DOM state with readable
// prose:
//
//   expect(element).toBeInTheDocument()
//   expect(button).toBeDisabled()
//   expect(input).toHaveValue('hello')
//
// Without this import those matchers would be undefined and tests would throw
// on first use. Adding it here means every test file in the project gets them
// automatically — no per-file import required.
//
// If you add further global test infrastructure (mock factories, custom
// render helpers, fake timers policy), add it here with an explanatory WHY
// comment rather than scattering setup across individual test files.

import '@testing-library/jest-dom';
