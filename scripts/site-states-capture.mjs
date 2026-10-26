// Site-states capture: renders each route in a real Chrome and records what a
// fan sees when the Supabase backend answers normally, errors, or hangs.
//
// Usage:
//   node scripts/site-states-capture.mjs <baseUrl> <mode> <outDir> [width] [settleMs] [routesCsv]
//     mode: normal | error | hang
//       error: every request to *.supabase.co fails at the network layer
//       hang:  every request to *.supabase.co is paused and never answered
//
// Writes <outDir>/<mode>-<width>-<slug>.jpg and appends one JSON line per
// route to <outDir>/<mode>-<width>.jsonl with the visible text summary.
// Drives Chrome through the taste-skill CDP helper (not a project dependency;
// this is an audit tool, run by hand).

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CDP = 'file:///C:/Users/rowle/AppData/Local/hermes/skills/creative/taste-skill/scripts/lib/cdp.mjs';
const { Browser, sleep } = await import(CDP);

const [base, mode = 'normal', outDir = 'out', widthArg = '390', settleArg = '6000', routesCsv] =
  process.argv.slice(2);
const width = Number(widthArg);
const settleMs = Number(settleArg);

const DEFAULT_ROUTES = [
  '/', '/matches', '/leagues', '/leagues/rocky-inner', '/teams', '/teams/haumea-spinners',
  '/leaderboards', '/seasons', '/news', '/idols', '/voting', '/training', '/wagers', '/world',
  '/players/632910a1-855a-4b18-b6df-4dde04d0f7a9', '/managers/1994ace1-6363-44a1-9d63-6706140312af',
  '/entities/80000000-0000-0000-0000-000000000008', '/matches/00000000-0000-0000-0000-000000000000',
  '/profile', '/login',
];
const routes = routesCsv ? routesCsv.split(',') : DEFAULT_ROUTES;

mkdirSync(outDir, { recursive: true });
const b = await Browser.launch();
const slug = (r) => (r === '/' ? 'home' : r.slice(1).replace(/[^a-z0-9]+/gi, '-').slice(0, 40));

async function capture(route) {
  const p = await b.newPage({ width, height: width < 600 ? 844 : 900, dsf: 1, mobile: width < 600 });
  if (mode !== 'normal') {
    await p.send('Fetch.enable', { patterns: [{ urlPattern: '*supabase.co*' }] });
    b.on(p.sessionId, 'Fetch.requestPaused', (e) => {
      if (mode === 'error') {
        p.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'ConnectionRefused' }).catch(() => {});
      }
      // hang: never continue the request
    });
  }
  await p.goto(base + route, { settleMs: 500, timeoutMs: 30000 });
  await sleep(settleMs);
  const info = await p.eval(() => {
    const main = document.querySelector('main') ?? document.body;
    const text = (main.innerText || '').replace(/\s+/g, ' ').trim();
    return {
      title: document.title,
      text: text.slice(0, 700),
      loading: /loading|tuning in|consulting|fetching/i.test(text),
      live: /live now|\blive\b/i.test(text),
      error: /unavailable|signal lost|couldn.t|failed|retry|try again/i.test(text),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  const file = join(outDir, `${mode}-${width}-${slug(route)}.jpg`);
  await p.screenshot({ path: file, quality: 55 });
  appendFileSync(join(outDir, `${mode}-${width}.jsonl`), JSON.stringify({ route, ...info }) + '\n');
  await p.close();
  return route;
}

// Small batches keep the run short without starving the browser.
for (let i = 0; i < routes.length; i += 5) {
  const batch = routes.slice(i, i + 5);
  const done = await Promise.allSettled(batch.map(capture));
  for (const d of done) console.log(d.status, d.status === 'fulfilled' ? d.value : d.reason?.message);
}
await b.close();
