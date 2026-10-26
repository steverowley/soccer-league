/* global document */ // page-side code inside p.eval() runs in the browser
// Dump the visible text of a few routes (audit helper, run by hand).
// node scripts/site-states-text.mjs <baseUrl> <width> <chars> <route> [route...]
const { Browser, sleep } = await import('file:///C:/Users/rowle/AppData/Local/hermes/skills/creative/taste-skill/scripts/lib/cdp.mjs');
const [base, w = '390', chars = '1500', ...routes] = process.argv.slice(2);
const b = await Browser.launch();
for (const r of routes) {
  const p = await b.newPage({ width: Number(w), height: 844, mobile: Number(w) < 600 });
  await p.goto(base + r, { settleMs: 6000 });
  const t = await p.eval(() => (document.querySelector('main') ?? document.body).innerText.replace(/\s+/g, ' '));
  console.log(`=== ${r}\n${t.slice(0, Number(chars))}\n`);
  await p.close();
}
await b.close();
await sleep(10);
