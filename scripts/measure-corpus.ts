// Measure the deterministic narrative corpus: how many distinct lines can the
// grammar actually produce with no LLM involved? Calls the project's own
// variety instrumentation rather than re-deriving the combinatorics.
import { voiceVariety } from '../supabase/functions/architect-galaxy-tick/voices.ts';
import { omenVariety } from '../supabase/functions/match-worker/architectOmens.ts';
import { proclamationVariety } from '../supabase/functions/match-worker/interferenceDirector.ts';

function report(label: string, v: Record<string, number>) {
  const entries = Object.entries(v).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, b) => a + b[1], 0);
  console.log(`\n${label}  —  total ${total.toLocaleString()} variants`);
  for (const [k, n] of entries) {
    const flag = n < 50 ? '   <-- thin' : '';
    console.log(`   ${String(n).padStart(12)}  ${k}${flag}`);
  }
  return total;
}

let grand = 0;
grand += report('ARCHITECT / GALAXY VOICES', voiceVariety());
grand += report('MATCH OMENS + TITLES', omenVariety());
grand += report('IN-MATCH PROCLAMATIONS', proclamationVariety());

console.log(`\n${'='.repeat(58)}`);
console.log(`GRAND TOTAL: ${grand.toLocaleString()} distinct generated lines`);
console.log(`${'='.repeat(58)}`);

// ── Match commentary (added for the no-LLM MVP) ─────────────────────────────
import { commentaryVariety } from '../supabase/functions/match-worker/commentary.ts';
const cv = commentaryVariety();
const byVoice: Record<string, number> = {};
for (const [k, n] of Object.entries(cv)) {
  const voice = k.split(':')[0]!;
  byVoice[voice] = (byVoice[voice] ?? 0) + n;
}
const commTotal = report('MATCH COMMENTARY (per voice)', byVoice);
console.log(`\nGRAND TOTAL INCLUDING COMMENTARY: ${(grand + commTotal).toLocaleString()}`);
