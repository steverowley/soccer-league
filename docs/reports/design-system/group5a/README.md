# Design system, group 5a: account and static pages, site chrome

Login, Welcome, Reset password, Profile, Training, Wagers, Voting, About,
Privacy, Terms and Not found, the site header, nav and footer, both error
boundaries, toasts and the notification settings, moved onto the design
language (`docs/design-language.md`, section 9, group 5). Review findings:
#723. Admin, What if and the match viewer are group 5b.

Captured from a local `vite preview` build at 390 px (full page) and
1440 px. `/api/db/*` was answered from production's read cache: each URL
fetched once (16 requests, on the first before pass) and replayed from
disk for every later pass (58 replays per pass, 0 production fetches),
so both sides show the same data. Signed-in states use a fake local
session; every request to the Supabase project was answered by a local
stub with made-up personal rows (four wagers, four focus options, two
enacted focuses, a training log), so nothing signed in to or wrote to
production. Each width and each auth state is captured in its own tab
(signed-out tabs clear the stored session explicitly: tabs share
localStorage). Images stay out of git.

## Routes

Signed out: `/`, `/matches`, a match page, `/login`, `/reset-password`,
`/training`, `/voting`, `/about`, `/privacy`, `/terms`, `/nope` (404), and
the phone menu open on `/matches`. Signed in: `/`, `/profile`,
`/training`, `/wagers`, `/voting`, `/welcome` (no favourite club yet), and
the toast after saving the allegiance form. `/wagers`, `/profile` and
`/welcome` redirect to `/login` when signed out, as before.

## Measurements (390 px, before / after)

| Route | Path | scrollWidth | Orange buttons 390 | Orange buttons 1440 | Purple | Red | Green | Text under 11 px |
|---|---|---|---|---|---|---|---|---|
| home | / | 390 / 390 | 1 / 1 | **2** / 1 | 1 / 1 | 0 / 0 | 10 / 10 | 0 / 0 |
| matches | /matches | 390 / 390 | 0 / 0 | 1 / 0 | 7 / 7 | 0 / 0 | 6 / 6 | 0 / 0 |
| match | /matches/:id | 390 / 390 | 0 / 0 | 1 / 0 | 1 / 1 | 0 / 0 | 0 / 0 | 0 / 0 |
| login | /login | 390 / 390 | 1 / 1 | **2** / 1 | 1 / 1 | 0 / 0 | 0 / 0 | 0 / 0 |
| reset-password | /reset-password | 390 / 390 | 0 / 1 | 1 / 1 | 2 / 1 | 0 / 0 | 0 / 0 | 0 / 0 |
| training | /training | 390 / 390 | 0 / 1 | 1 / 1 | 1 / 1 | 0 / 0 | 0 / 0 | 0 / 0 |
| voting | /voting | 390 / 390 | 0 / 1 | 1 / 1 | 1 / 1 | 2 / 0 | 0 / 0 | 0 / 0 |
| about | /about | 390 / 390 | 0 / 0 | 1 / 0 | 1 / 1 | 0 / 0 | 0 / 0 | 0 / 0 |
| privacy | /privacy | 390 / 390 | 0 / 0 | 1 / 0 | 1 / 1 | 0 / 0 | 0 / 0 | 0 / 0 |
| terms | /terms | 390 / 390 | 0 / 0 | 1 / 0 | 1 / 1 | 0 / 0 | 0 / 0 | 0 / 0 |
| not-found | /nope | 390 / 390 | 0 / 0 | 1 / 0 | 1 / 1 | 1 / 0 | 0 / 0 | 0 / 0 |
| menu open | /matches | 390 / 390 | 1 / 0 | n/a | 7 / 7 | 0 / 0 | 6 / 6 | 0 / 0 |
| home (in) | / | 390 / 390 | 1 / 1 | 1 / 1 | 1 / 1 | 0 / 0 | 10 / 10 | 0 / 0 |
| profile | /profile | 390 / 390 | 1 / 1 | 1 / 1 | 4 / 1 | 1 / 0 | 0 / 0 | 0 / 0 |
| training (in) | /training | **484** / 390 | 1 / 1 | 1 / 1 | 1 / 1 | 0 / 0 | 0 / 0 | 0 / 0 |
| wagers | /wagers | 390 / 390 | 0 / 0 | 0 / 0 | 2 / 1 | 2 / 0 | 3 / 3 | **4** / 0 |
| voting (in) | /voting | 390 / 390 | **2** / 0 | **2** / 0 | 1 / 1 | 2 / 0 | 0 / 0 | 0 / 0 |
| welcome | /welcome | 390 / 390 | 0 / 0 | 0 / 0 | 2 / 1 | 0 / 0 | 0 / 1 | 0 / 0 |

"Orange buttons" counts visible links and buttons whose fill is the action
colour. Colour counts are elements whose text, fill, stroke or border uses
the accent. At 390 the signed-out header's Sign up sits in the closed
drawer, so the before column only shows it with the menu open.

- **Orange: at most one per view on every route and width.** Before, the
  header's signed-out Sign up was orange next to Home's hero, the Log in
  submit, and every page's own call to action (2 on Home and Login at
  1440), and Voting had two orange Cast vote buttons. Now the header's
  Sign up is a secondary Button, Cast vote is secondary (a repeated
  control), and the only orange is the page's own action: See fixtures,
  Log in, Send reset link, Sign up (the Training and Voting sign-in
  cards), Save allegiance, Click for +10 XP.
- **Purple**: the one left on every page is the off-screen skip link's
  focus border (`.isl-skip-link` in index.css; checked by element). The
  Matches page's seven are group 1 content, unchanged here. Gone: the
  purple Reset password submit, league chips on Welcome, the credit
  balance and streak glyphs on Profile and Wagers, checkbox accents.
- **Red**: none on these pages at rest. Removed: the Voting permanence
  banner (now a full-tone hairline notice), the Not found link, the
  Profile delete controls, the Wagers "Lost" chip and losses. Red stays
  for real failures only: form errors, the load-error states, a failed
  training click, too few credits to vote (role="alert" each).
- **Green**: a won wager's Tag and payout and a positive Net P&L
  (Wagers), the stat-bump Tag (Training), the success toast. Welcome's
  one is the Terra Nova club's crest (club colour is data).
- **Overflow**: the signed-in Training page was 484 px wide at 390 (the
  clicker's fixed 280 px column); it now fits.

Font sizes at 390 px (px):

| Route | Before | After |
|---|---|---|
| login | 11/12/13/14/15/30 | 11/13/15/30 |
| profile | 11/12/13/14/15/22/30/40 | 11/13/15/16/22/30 |
| training (in) | 11/12/13/14/15/28/30/40 | 11/13/15/16/22/30 |
| wagers | 10/11/12/13/15/22/30/40 | 11/13/15/16/22/30 |
| voting (in) | 11/12/13/14/15/16/18/20/24/28/30 | 11/13/15/16/22/30 |
| welcome | 11/12/13/14/15/16/30 | 11/13/15/16/30 |
| about, privacy, terms, not found | 11/12/13/15/30 | 11/13/15/30 |

Every size is now a type token (label 11, small 13, body 15, subheading
16, heading 22, title 30 on a phone). The 12 px footer and header text is
gone everywhere.

## Header widths

The nine nav labels plus the account control wrapped onto two rows at
768 px, so the drawer now runs below 1024 px. Measured signed out and
signed in at 768, 1023, 1024 and 1280: one nav row from 1024 up, the
drawer below it, no horizontal overflow at any width. Header targets are
at least 44 px tall at every width.

## Toast

Saving the allegiance form (stubbed write): before, a solid green fill
with dark text and a drop shadow; after, the raised surface with a green
1 px border and a "Done" label, default-tone message, no shadow. Errors
use the red border and an "Error" label, info the neutral line.

## Guard

`scripts/designTokens.baseline.json`: 333 raw values in 32 files before,
86 in 15 files after. The eleven pages, Header, Layout, both error
boundaries, Toast, NotificationSettings and the two new shared files
(`Field.tsx`, `Prose.tsx`) are in `MIGRATED` at zero. What remains is
group 5b (Admin, What if, the admin panels, the match viewer) and
`src/constants.ts`.
