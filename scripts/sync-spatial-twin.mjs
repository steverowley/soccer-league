// scripts/sync-spatial-twin.mjs
// Copy the canonical spatial engine (src/features/match/logic/spatial) into its
// Deno twin (supabase/functions/match-worker/spatial), adding the `.ts` suffix
// Deno requires on relative imports. Tests and the browser barrel (index.ts)
// are not copied. Run: node scripts/sync-spatial-twin.mjs
//
// twinParity.test.ts then proves the copies match. Never hand-edit the twin:
// edit src and re-run this.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src/features/match/logic/spatial';
const DST = 'supabase/functions/match-worker/spatial';

const files = readdirSync(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts');
for (const f of files) {
  const text = readFileSync(join(SRC, f), 'utf8');
  const out = text.replace(/(from\s+['"])(\.{1,2}\/[^'"]+?)(['"])/g, (m, a, path, b) =>
    path.endsWith('.ts') ? m : `${a}${path}.ts${b}`);
  writeFileSync(join(DST, f), out);
  console.log(`synced ${f}`);
}
