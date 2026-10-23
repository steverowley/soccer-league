// Audit: for every table a Zod api-boundary schema validates, compare the
// schema's nullability against the generated database types.
//
// A Zod field that is not `.nullable()` where the column IS nullable makes the
// parser drop the row — silently, behind a console.warn. Same bug class as the
// `subminute` `.int()` defect, different mechanism.
const fs = require('fs');

const db = fs.readFileSync('src/types/database.ts', 'utf8');

/** Pull the Row shape for a table out of the generated types. */
function rowFields(table) {
  // Tables block: `      <table>: {` then `        Row: {` ... `        }`
  const tRe = new RegExp(`\\n      ${table}: \\{`);
  const t = db.search(tRe);
  if (t < 0) return null;
  const rowIdx = db.indexOf('Row: {', t);
  if (rowIdx < 0) return null;
  const end = db.indexOf('\n        }', rowIdx);
  const block = db.slice(rowIdx, end);
  const out = {};
  for (const m of block.matchAll(/^\s{10}([a-z_0-9]+)(\?)?:\s*(.+?)$/gm)) {
    out[m[1]] = { nullable: /\bnull\b/.test(m[3]), type: m[3].trim() };
  }
  return out;
}

const SCHEMAS = [
  ['match_events', 'src/features/match/api/matchEvents.schema.ts'],
  ['wagers', 'src/features/betting/api/wagers.schema.ts'],
  ['match_odds', 'src/features/betting/api/oddsRepo.schema.ts'],
  ['architect_lore', 'src/features/architect/api/lore.schema.ts'],
  ['narratives', 'src/features/entities/api/entities.schema.ts'],
  ['focus_votes', 'src/features/voting/api/focuses.schema.ts'],
];

let problems = 0;
for (const [table, file] of SCHEMAS) {
  if (!fs.existsSync(file)) {
    console.log(`SKIP ${table}: ${file} missing`);
    continue;
  }
  const fields = rowFields(table);
  if (!fields) {
    console.log(`SKIP ${table}: not found in database.ts`);
    continue;
  }
  const src = fs.readFileSync(file, 'utf8');
  const issues = [];
  for (const [name, info] of Object.entries(fields)) {
    // Find `  name:  z....,` in the schema (single line).
    const re = new RegExp(`^\\s*${name}:\\s*(z\\.[^\\n]*?),?\\s*$`, 'm');
    const m = src.match(re);
    if (!m) continue; // field not validated by this schema — fine
    const zod = m[1];
    const zodNullable = /\.nullable\(\)|\.nullish\(\)|\.optional\(\)/.test(zod);
    if (info.nullable && !zodNullable) {
      issues.push(`    ${name}: column is nullable, Zod is NOT -> ${zod.slice(0, 60)}`);
      problems++;
    }
  }
  console.log(`${table}  (${Object.keys(fields).length} cols)  ${issues.length ? 'ISSUES' : 'ok'}`);
  issues.forEach((i) => console.log(i));
}
console.log(`\ntotal nullability mismatches: ${problems}`);
