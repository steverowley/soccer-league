# Page header unification: before and after

Every page except the Home hero opens with PageShell + PageHeader (src/shared/ui), so every h1 is the title token (40 px desktop, 30 px phone), uppercase, 0.02em tracking, on the container's left edge.

Captured from a local production build (vite preview, base /soccer-league/) with Chrome over CDP: 1440 x 560 desktop tops and 390 x 844 phone tops. Public reads (/api/db/*) were answered from production's read cache, one load per page per state. The signed-in rows used a fake session in localStorage with every Supabase request stubbed locally (no production database traffic).

- before-<page>-1440.jpg / before-<page>-390.jpg: main at 8b517d1 (group 1 merged)
- after-<page>-1440.jpg / after-<page>-390.jpg: this branch
- after-<page>-signed-in-*.jpg: signed-in states of the account and admin pages
- sheet-1440-*.jpg, sheet-390-*.jpg, sheet-signed-in-1440.jpg: contact sheets (before | after)
- facts-before.json, facts-after.json: every h1 measured in the browser

## h1 per page (after)

Desktop and phone columns are this branch; the last column is main before the change. y is from the top of the document.

| page | h1 count | desktop 1440 | phone 390 | before (desktop) |
|---|---|---|---|---|
| home | 1 | 56px uppercase ls=1.12px x=744 y=253 | 40px uppercase ls=0.8px x=16 y=664 | 56px uppercase ls=1.12px x=744 y=253 |
| leagues | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 40px uppercase ls=0.8px x=120 y=163 |
| league | 1 | 40px uppercase ls=0.8px x=120 y=247 | 30px uppercase ls=0.6px x=16 y=247 | 40px uppercase ls=0.8px x=120 y=247 |
| matches | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 40px uppercase ls=0.8px x=120 y=163 |
| teams | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 56px uppercase ls=normal x=112 y=193 |
| team | 1 | 40px uppercase ls=0.8px x=200 y=248 | 30px uppercase ls=0.6px x=96 y=247 | 48px uppercase ls=normal x=353 y=320 |
| player | 1 | 40px uppercase ls=0.8px x=200 y=248 | 30px uppercase ls=0.6px x=96 y=253 | 36px none ls=-0.36px x=112 y=221 |
| manager | 1 | 40px uppercase ls=0.8px x=200 y=248 | 30px uppercase ls=0.6px x=96 y=253 | 40px uppercase ls=0.8px x=112 y=290 |
| entity-pundit | 1 | 40px uppercase ls=0.8px x=120 y=223 | 30px uppercase ls=0.6px x=16 y=223 | 32px none ls=normal x=112 y=181 |
| entity-stadium | 1 | 40px uppercase ls=0.8px x=120 y=223 | 30px uppercase ls=0.6px x=16 y=223 | 32px none ls=normal x=112 y=181 |
| news | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 56px uppercase ls=normal x=112 y=193 |
| idols | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 56px uppercase ls=normal x=112 y=193 |
| leaderboards | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 40px uppercase ls=0.8px x=112 y=240 |
| seasons | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 40px uppercase ls=0.8px x=112 y=240 |
| season | 1 | 40px uppercase ls=0.8px x=120 y=247 | 30px uppercase ls=0.6px x=16 y=247 | 40px uppercase ls=0.8px x=112 y=288 |
| world | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 56px uppercase ls=normal x=112 y=193 |
| voting | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 56px uppercase ls=normal x=112 y=193 |
| training | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 40px uppercase ls=0.8px x=112 y=240 |
| wagers | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 40px uppercase ls=0.8px x=112 y=240 |
| profile | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 40px uppercase ls=0.8px x=112 y=240 |
| login | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 40px uppercase ls=0.8px x=112 y=240 |
| welcome | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 40px uppercase ls=0.8px x=112 y=240 |
| reset-password | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 40px uppercase ls=0.8px x=112 y=192 |
| about | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 40px uppercase ls=0.8px x=112 y=192 |
| privacy | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 40px uppercase ls=0.8px x=112 y=192 |
| terms | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 40px uppercase ls=0.8px x=112 y=192 |
| admin | 1 | 40px uppercase ls=0.8px x=120 y=223 | 30px uppercase ls=0.6px x=16 y=223 | (no h1) |
| what-if | 1 | 40px uppercase ls=0.8px x=120 y=223 | 30px uppercase ls=0.6px x=16 y=223 | (no h1) |
| not-found | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | 40px uppercase ls=0.8px x=112 y=192 |
| training (signed in) | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | n/a |
| wagers (signed in) | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | n/a |
| profile (signed in) | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | n/a |
| voting (signed in) | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | n/a |
| welcome (signed in) | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | n/a |
| admin (signed in) | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | n/a |
| what-if (signed in) | 1 | 40px uppercase ls=0.8px x=120 y=163 | 30px uppercase ls=0.6px x=16 y=163 | n/a |

Index pages share y=163 (desktop and phone). Detail pages sit lower by the back link and crumbs. On the club, player and manager pages the crest sits beside the title as the spec and specimen show, so their h1 starts 80 px right of the shared edge (64 px crest + 16 px gap); the crest itself starts on the shared edge (x=120 desktop, 16 phone).
