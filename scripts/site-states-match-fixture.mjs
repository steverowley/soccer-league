// Render a finished match page from a fixture served through CDP Fetch, so
// the match page can be checked while the database holds no matches.
// node scripts/site-states-match-fixture.mjs <baseUrl> <out.jpg> [width] [fullPage 0|1]
//
// The teams, players and stadium rows are read live from production (they
// survived the reset); the match row and its events are a fixture modelled
// on the owner's screenshot (a 1-5 away win for Haumea Spinners, with the
// worker's full-time 'mvp' event at 91').

const { Browser, sleep } = await import('file:///C:/Users/rowle/AppData/Local/hermes/skills/creative/taste-skill/scripts/lib/cdp.mjs');
const [base, out, w = '390', full = '1'] = process.argv.slice(2);
const KEY = 'sb_publishable_bbRGJ2fM9IQ9typ5x_Kwlg_R2gtgasP';
const REST = 'https://ddtpbipkqamuxnvupddc.supabase.co/rest/v1';
const FALLBACK = {
  'uranus-sidewinders': { id: 'uranus-sidewinders', name: 'Uranus Sidewinders', location: 'Uranus', color: '#4FD0E7', home_ground: 'Polar Tilt Arena', stadium: { name: 'Polar Tilt Arena' }, managers: [], players: [] },
  'haumea-spinners': { id: 'haumea-spinners', name: 'Haumea Spinners', location: 'Haumea', color: '#F0E68C', home_ground: 'Centrifuge Field "The Oval"', stadium: { name: 'Centrifuge Field' }, managers: [], players: [{ id: 'p1', name: 'Gyro Reyes', position: 'GK', starter: true, jersey_number: 1, overall_rating: 70 }] },
};
const team = async (id) => {
  const sel = '*,stadium:entities!teams_stadium_entity_id_fkey(name),managers(id,name,preferred_formation,style),players(id,name,position,starter,jersey_number,overall_rating)';
  try {
    const r = await fetch(`${REST}/teams?id=eq.${id}&select=${encodeURIComponent(sel)}`, { headers: { apikey: KEY }, signal: AbortSignal.timeout(8000) });
    return (await r.json())[0];
  } catch {
    // The database is not answering: fall back to the static canon.
    return FALLBACK[id];
  }
};
const home = await team('uranus-sidewinders');
const away = await team('haumea-spinners');
const MATCH_ID = '11111111-2222-3333-4444-555555555555';
const kickoff = new Date(Date.now() - 6 * 3600e3).toISOString();
const match = {
  id: MATCH_ID, status: 'completed', home_team_id: home.id, away_team_id: away.id,
  home_score: 1, away_score: 5, scheduled_at: kickoff, played_at: kickoff, round: 'Matchday 3',
  stadium: null, weather: null, competition_id: 'c1', referee_id: null,
  competitions: { id: 'c1', name: 'Gas/Ice Giants v Kuiper Belt Friendly', type: 'league', format: null },
  home_team: home, away_team: away, match_player_stats: [],
};
const ev = (i, minute, type, payload) => ({ id: `e${i}`, match_id: MATCH_ID, minute, subminute: 0, type, payload, created_at: kickoff });
const events = [
  ev(1, 0, 'kickoff', { commentary: 'We are under way at the far edge of the system.', voice: 'vox' }),
  ev(2, 12, 'goal', { isGoal: true, team: away.id, commentary: 'Spinners strike first, a low drive across the keeper.', voice: 'vox' }),
  ev(3, 40, 'goal', { isGoal: true, team: home.id, commentary: 'Sidewinders level it from a corner routine.', voice: 'zara' }),
  ev(4, 55, 'goal', { isGoal: true, team: away.id, commentary: 'The wide overload works again.', voice: 'nexus' }),
  ev(5, 70, 'goal', { isGoal: true, team: away.id, commentary: 'Three for the Spinners.', voice: 'vox' }),
  ev(6, 81, 'goal', { isGoal: true, team: away.id, commentary: 'Four. The Oval is spinning.', voice: 'zara' }),
  ev(7, 88, 'goal', { isGoal: true, team: away.id, commentary: 'Five, and the home end empties.', voice: 'vox' }),
  ev(8, 90, 'full_time', { commentary: 'Full time: one, five.', voice: 'vox' }),
  ev(9, 91, 'mvp', { player: away.players?.[0]?.name ?? 'Gyro Reyes' }),
];

const b = await Browser.launch();
const width = Number(w);
const p = await b.newPage({ width, height: width < 600 ? 844 : 900, dsf: 1, mobile: width < 600 });
await p.send('Fetch.enable', { patterns: [{ urlPattern: '*supabase.co/rest/*' }] });
b.on(p.sessionId, 'Fetch.requestPaused', (e) => {
  const url = e.request.url;
  const cors = [
    { name: 'Access-Control-Allow-Origin', value: '*' },
    { name: 'Access-Control-Allow-Headers', value: '*' },
    { name: 'Access-Control-Allow-Methods', value: 'GET, POST, HEAD, OPTIONS' },
  ];
  if (e.request.method === 'OPTIONS') {
    p.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: 204, responseHeaders: cors }).catch(() => {});
    return;
  }
  const wantsObject = /vnd\.pgrst\.object/.test(JSON.stringify(e.request.headers));
  let body = [];
  if (/\/matches\?/.test(url) && url.includes(MATCH_ID)) body = wantsObject ? match : [match];
  else if (/\/match_events\?/.test(url)) body = events;
  else if (wantsObject) body = null;
  const status = body === null ? 406 : 200;
  const json = JSON.stringify(body === null ? { code: 'PGRST116', message: 'no rows' } : body);
  p.send('Fetch.fulfillRequest', {
    requestId: e.requestId,
    responseCode: status,
    responseHeaders: [
      { name: 'Content-Type', value: 'application/json' },
      ...cors,
      { name: 'Content-Range', value: '0-0/*' },
    ],
    body: Buffer.from(json).toString('base64'),
  }).catch(() => {});
});
await p.goto(`${base}/matches/${MATCH_ID}`, { settleMs: 7000 });
const info = await p.eval(() => ({
  board: document.querySelector('.match-board')?.innerText?.replace(/\s+/g, ' ') ?? null,
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
  mvp: [...document.querySelectorAll('div,span,b')].filter((n) => /^\s*(Mvp|MVP|Player of the Match)\.?\s*$/i.test(n.textContent)).length,
}));
console.log(JSON.stringify(info));
await p.screenshot({ path: out, quality: 60, fullPage: full === '1' });
// Text of every feed / record row at 91 minutes (the full-time award line).
console.log(JSON.stringify(await p.eval(() => [...document.querySelectorAll('div')]
  .filter((d) => d.children.length <= 4 && /^\s*(Player of the Match|Mvp)/i.test(d.innerText) && /91/.test(d.innerText))
  .map((d) => d.innerText.replace(/\s+/g, ' ')))));
await b.close();
await sleep(10);
