/* global document */ // page-side code inside p.eval() runs in the browser
// Before/after screenshots for the site-states PR.
// node scripts/site-states-pairs.mjs <beforeBase> <afterBase> <outDir> [jobsCsv]
//
// Supabase responses are scripted through the CDP Fetch domain so both sides
// render the same backend state, whatever the live database is doing:
//   empty → every REST read answers with no rows (the database since the
//           2026-10-26 reset: no seasons, competitions or matches)
//   hang  → every REST read is held and never answered (the outage)
// Screenshots are 390 px wide (the owner's iPhone), clipped to maxH.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { Browser, sleep } = await import('file:///C:/Users/rowle/AppData/Local/hermes/skills/creative/taste-skill/scripts/lib/cdp.mjs');
const [beforeBase, afterBase, outDir, jobsCsv] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const JOBS = [
  // name, route, mode, settleMs, maxH
  ['home-preseason', '/', 'empty', 6000, 2400],
  ['home-hang', '/', 'hang', 13000, 1800],
  ['fixtures-preseason', '/matches', 'empty', 6000, 1100],
  ['fixtures-hang', '/matches', 'hang', 13000, 1100],
  ['standings-preseason', '/leagues/rocky-inner', 'empty', 6000, 0],
  ['leaderboards-preseason', '/leaderboards', 'empty', 6000, 1500],
  ['seasons-preseason', '/seasons', 'empty', 6000, 900],
  ['match-unknown-id', '/matches/00000000-0000-0000-0000-000000000000', 'empty', 6000, 844],
];
const wanted = jobsCsv ? new Set(jobsCsv.split(',')) : null;

const CORS = [
  { name: 'Access-Control-Allow-Origin', value: '*' },
  { name: 'Access-Control-Allow-Headers', value: '*' },
  { name: 'Access-Control-Allow-Methods', value: 'GET, POST, HEAD, OPTIONS' },
];

const b = await Browser.launch();
for (const [name, route, mode, settle, maxH] of JOBS) {
  if (wanted && !wanted.has(name)) continue;
  for (const [side, base] of [['before', beforeBase], ['after', afterBase]]) {
    const p = await b.newPage({ width: 390, height: 844, dsf: 1, mobile: true });
    await p.send('Fetch.enable', { patterns: [{ urlPattern: '*supabase.co/rest/*' }] });
    b.on(p.sessionId, 'Fetch.requestPaused', (e) => {
      if (e.request.method === 'OPTIONS') {
        p.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: 204, responseHeaders: CORS }).catch(() => {});
        return;
      }
      if (mode === 'hang') return;
      const wantsObject = /vnd\.pgrst\.object/.test(JSON.stringify(e.request.headers));
      const [code, body] = wantsObject
        ? [406, { code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested, multiple (or no) rows returned' }]
        : [200, []];
      p.send('Fetch.fulfillRequest', {
        requestId: e.requestId,
        responseCode: code,
        responseHeaders: [...CORS, { name: 'Content-Type', value: 'application/json' }, { name: 'Content-Range', value: '*/0' }],
        body: Buffer.from(JSON.stringify(body)).toString('base64'),
      }).catch(() => {});
    });
    await p.goto(base + route, { settleMs: 500, timeoutMs: 30000 });
    await sleep(settle);
    const H = await p.eval(() => document.documentElement.scrollHeight);
    const text = await p.eval(() => (document.querySelector('main') ?? document.body).innerText.replace(/\s+/g, ' ').slice(0, 400));
    const h = maxH > 0 ? Math.min(H, maxH) : Math.min(H, 2400);
    const file = join(outDir, `${name}-${side}.jpg`);
    const { data } = await p.send('Page.captureScreenshot', {
      format: 'jpeg', quality: 55, captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 390, height: h, scale: 1 },
    }, 45000);
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`${name} ${side}: ${text.slice(0, 220)}`);
    await p.close();
  }
}
await b.close();
