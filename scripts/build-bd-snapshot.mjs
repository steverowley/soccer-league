#!/usr/bin/env node
// ── scripts/build-bd-snapshot.mjs ──────────────────────────────────────────
// Reads `.beads/issues.jsonl` (the bd issue tracker source of truth) and
// writes a normalised, trimmed snapshot to `public/bd-snapshot.json` for
// the in-app /roadmap dashboard to render.
//
// WHY a snapshot rather than reading the JSONL at runtime:
//   1. Vite's static-asset story for files outside `src/` is awkward
//      (especially for a dotfile-prefixed directory like `.beads/`).
//      Copying to `public/` sidesteps the bundler entirely.
//   2. The snapshot is a deterministic build artefact — if `.beads/`
//      changes, the snapshot is regenerated.  Commit cycle for the
//      dashboard is: edit bd → commit JSONL → push → GitHub Pages
//      rebuild fetches the new snapshot.
//   3. Trimming irrelevant fields (audit timestamps, internal metadata)
//      keeps the shipped JSON small — the dashboard never needs to
//      know about `dependency_count` or `_type`.
//
// RUNNING:
//   This script is wired to `predev` and `prebuild` in `package.json`,
//   so it runs automatically on every `npm run dev` / `npm run build`.
//   It can also be invoked directly: `node scripts/build-bd-snapshot.mjs`.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Paths ──────────────────────────────────────────────────────────────────
// Resolve paths relative to this script so it works regardless of CWD.

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, '..', '.beads', 'issues.jsonl');
const OUT_DIR = resolve(HERE, '..', 'public');
const OUT = resolve(OUT_DIR, 'bd-snapshot.json');

// ── Trimmed shape ──────────────────────────────────────────────────────────
// Mirrors `BdIssueSnapshot` in `src/features/roadmap/api/bdSnapshot.ts`.
// Keep both ends in sync — the Zod schema there validates this exact shape.
//
// We drop these fields from the raw bd JSONL:
//   - _type (always 'issue' after the filter below)
//   - design / acceptance_criteria / notes (kept; useful in card detail)
//   - dependencies / dependency_count / dependent_count / comment_count
//     (consumers don't render these on the kanban — re-add if needed)
//   - owner / created_by (assignee already covers attribution)

function trim(row) {
  return {
    id:           row.id,
    title:        row.title,
    description:  row.description ?? null,
    notes:        row.notes ?? null,
    status:       row.status,
    priority:     row.priority,
    issue_type:   row.issue_type ?? 'task',
    assignee:     row.assignee ?? null,
    created_at:   row.created_at,
    updated_at:   row.updated_at,
    started_at:   row.started_at ?? null,
    closed_at:    row.closed_at ?? null,
    close_reason: row.close_reason ?? null,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  // Tolerate a missing .beads/ directory — write an empty snapshot so the
  // dashboard renders cleanly in environments that don't track bd state
  // (forks, CI, fresh clones before bd init).
  if (!existsSync(SOURCE)) {
    console.warn(`[bd-snapshot] ${SOURCE} not found — writing empty snapshot.`);
    writeSnapshot([]);
    return;
  }

  const raw = readFileSync(SOURCE, 'utf8');
  const issues = [];

  // JSONL = one JSON object per line.  Skip blanks and non-issue records
  // (bd's "memory" entries from `bd remember` ride in the same file).
  for (const line of raw.split('\n')) {
    const stripped = line.trim();
    if (!stripped) continue;
    let parsed;
    try {
      parsed = JSON.parse(stripped);
    } catch (err) {
      console.warn('[bd-snapshot] skipping malformed JSONL line:', err.message);
      continue;
    }
    if (parsed._type !== 'issue') continue;
    if (!parsed.id || !parsed.title || !parsed.status) {
      console.warn('[bd-snapshot] skipping issue with missing id/title/status:', parsed.id ?? '<unknown>');
      continue;
    }
    issues.push(trim(parsed));
  }

  // Sort newest-updated first so the dashboard's column-internal tiebreak
  // (which uses updated_at) renders predictably.
  issues.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));

  writeSnapshot(issues);
  console.log(`[bd-snapshot] wrote ${issues.length} issue(s) to ${OUT}`);
}

/**
 * Write the snapshot JSON envelope.  Wraps the array in an object so
 * future metadata (snapshot timestamp, bd version) can be added without
 * a breaking schema change for consumers.
 */
function writeSnapshot(issues) {
  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    issues,
  };
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
}

main();
