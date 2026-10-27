# Design system, group 5b: admin console, What if, match viewer, guard at zero

The last group of the design-language rebuild (`docs/design-language.md`,
section 9, item 5; review findings #723): the admin console (every tab),
What if, the pixel-art match viewer and its demo, the player inspect panel,
the canvas palette, `constants.ts` and the Architect's feed colour. Then the
old duplicates are deleted and the style guard becomes a hard zero.

Captured from a local `vite preview` build at 390 px (full page) and
1440 px, before (origin/main) and after (this branch). `/api/db/*` and the
public replay file were answered from a disk cache: each URL fetched from
production once, replayed after (the final after pass made 0 production
fetches). Admin needs an admin session: a fake local session with
`is_admin: true`, and every request to the Supabase project answered by a
local stub with made-up admin rows (a voting season, five fixtures, three
interventions, three clubs, ten shadow timelines). Every write (rpc, POST,
PATCH) was stubbed; nothing signed in to or wrote to production. Images
stay out of git.

## Routes

`/admin` (Overview), `?tab=season`, `?tab=fixtures` (and with the inline
completion editor open), `?tab=testing`, `?tab=architect`, `?tab=viewer`
(and with a player selected, so the inspect panel shows data),
`/admin/what-if`, and a completed match page with the replay viewer open.
The viewer only shows inside a match's pacing window, so the match tab ran
on a frozen clock five minutes after kickoff with reduced motion on: the
canvas is then a pure function of the build.

## The replay canvas is unchanged

The viewer's backing store (320 x 208) was saved as PNG on both builds at
both widths: the before and after files are byte-identical (same pixel hash,
same 708 distinct colours). Two before runs were identical too, so the
comparison is a real oracle. The canvas reads its colours from
`canvasColor` in `tokens.ts`; `tokens.test.ts` parses `tokens.css` and fails
if any canvas value drifts from its `--isl-pitch-*` (or `--isl-text`,
`--isl-bg`, `--isl-architect`) custom property.

## Measurements (before / after)

Purple excludes the off-screen skip link's focus border (present on every
page). "Orange" counts visible buttons and links filled with the action
colour.

| View | Path | scrollWidth 390 | Orange 390 | Orange 1440 | Purple | Red | Text under 11 px | Font sizes at 390 |
|---|---|---|---|---|---|---|---|---|
| overview | /admin | 390 / 390 | 0 / 0 | 0 / 0 | 1 / 0 | 0 / 0 | 0 / 0 | 11,12,13,15,18,20,30 / 11,13,15,16,22,30 |
| season | ?tab=season | 390 / 390 | 1 / 1 | 1 / 1 | 3 / 0 | 2 / 0 | 0 / 0 | 11,12,13,15,20,30 / 11,13,15,16,22,30 |
| fixtures | ?tab=fixtures | 390 / 390 | 0 / 0 | 0 / 0 | 7 / 0 | 1 / 1 | 0 / 0 | 11,12,13,15,20,30 / 11,13,15,22,30 |
| fixtures, editor open | ?tab=fixtures | 390 / 390 | 1 / 1 | 1 / 1 | 7 / 0 | 2 / 1 | 0 / 0 | same |
| testing | ?tab=testing | 390 / 390 | 0 / 0 | 0 / 0 | 1 / 0 | 3 / 0 | 0 / 0 | 11,12,13,15,20,30 / 11,13,15,22,30 |
| architect | ?tab=architect | 390 / 390 | 0 / 0 | 0 / 0 | 4 / 4 | 0 / 0 | 0 / 0 | 11,12,13,15,20,30 / 11,13,15,22,30 |
| viewer | ?tab=viewer | 390 / 390 | 0 / 1 | 0 / 1 | 2 / 0 | 0 / 0 | 0 / 0 | 11,12,13,15,30 / 11,13,15,22,30 |
| viewer, player selected | ?tab=viewer | 390 / 390 | 0 / 1 | 0 / 1 | 8 / 0 | 0 / 0 | **8** / 0 | 10,11,12,13,15,16,30 / 11,13,15,16,22,30 |
| what if | /admin/what-if | 390 / 390 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 11,13,15,16,30 / 11,13,15,22,30 |
| match, viewer open | /matches/:id | 390 / 390 | 0 / 0 | 0 / 0 | 6 / 6 | 0 / 0 | 0 / 0 | unchanged |

- **Orange: at most one per view.** Season: Fast forward (the tab's reason to
  exist); Trigger enactment, Open and Close voting are secondary. Fixtures:
  "Complete…" repeats per row so it is secondary; the inline editor's Save is
  the one primary (one row edits at a time). Viewer: Kick off (it was a
  purple fill). Testing has none: no single action is the point of that
  view, and an orange Reset beside two forms invites the wrong click.
- **Purple only for the Architect and focus.** Gone: the active-tab bar, the
  filter fill, the "View" links, the voting status, the stat bars and
  personality in the inspect panel, the Kick off fill. Kept on the
  Architect tab: the intervention log sits in an `architect` Card and the
  changed field is named in purple (Architect content). The match page's six
  are group 2's (cosmic voices), unchanged.
- **Red only for live and errors.** Gone: the red Danger zone box and label,
  the red "danger" fills on Trigger enactment, Close voting and Reset, the red
  Cancel. Kept: the fixtures table's live row (the shared LiveBadge dot);
  failures go to the site toast, which marks errors red.
- **Type on the scale.** 12, 18 and 20 px are gone from admin; the inspect
  panel's 10 px snippet labels and headings (8 elements) are now 11 px.
- **No overflow at 390** before or after. The admin tab strip squeezed its
  six labels into each other at 390 on main; tabs now keep their width and
  the strip scrolls.

## What changed

- **Admin**: SectionHeader (I) per tab, StatBlock grid in a Card (Overview),
  two SectionPanels with StatBlocks and Field controls (Season), Tag filters
  plus DataTable with LiveBadge and TextLink (Fixtures), three SectionPanels
  with Field / CheckField forms on `inputStyle` (Testing), DataTable in an
  `architect` Card (Architect). Outcomes use the site toast (`useToast`), with
  the same messages, kinds and 4 s dismissal as the old admin toast. The tab
  strip copies the header nav (label type, underline on the current tab).
- **What if**: numbered section, shared DataTable (fixture, kickoff, home,
  draw, away, scorelines), shared LoadingState and EmptyState.
- **Viewer**: demo and inspect panel on the type presets, text tones, the one
  input style and SectionPanel; stat bars in the text tone, square.
- **Canvas palette**: `canvasColor` and `canvasColorVar` in `tokens.ts`,
  the `--isl-pitch-*` block in `tokens.css`, `tokens.test.ts`. `render.ts`,
  `appearance.ts` (hair tones) and `MatchViewer.tsx` draw from it.
- **constants.ts**: the `C` palette had no users and is deleted.
  **CosmicArchitect.ts**: the proclamation's feed colour is `color.architect`
  (it was `#7C3AED`, an off-palette purple).
- **Mini pitch** (`MiniPitch`, `PitchSurface`): `COLORS.*` swapped for the
  `color.*` tokens it already pointed at (no visual change).

## Deleted

- `COLORS` in `components/Layout.tsx` (the 5a bridge).
- `features/admin/ui/primitives.tsx`: PanelHeader, StatCell, AdminButton,
  FilterChip, ActionToast, Skeleton, LABEL_STYLE, VALUE_STYLE,
  adminSelectStyle, adminInputStyle, the colour constants, Toast types and
  `useAutoDismissToast` (`fmtDatetime` moved to `ui/format.ts`).
- `shared/ui` Chip, Kicker, Pip, StatPair and KeyValue (no renders left),
  with `Chip.test.tsx` and `primitives.test.tsx`; the Button's legacy
  `active` alias and its test; the inspect panel's local SectionLabel.
- The ratchet: `scripts/designTokens.baseline.json`,
  `scripts/design-baseline.ts` and the `design:baseline` npm script.

`tsc --noEmit` passes after each deletion, and a grep for every deleted name
finds no references outside historical reports.

## The guard is a hard zero

Baseline before this branch: 86 raw values in 15 files. After: none.
`scripts/designTokens.test.ts` now fails on any raw font size, colour, dust
opacity or letter spacing in `src/` (tests and the token files excluded), and
asserts the baseline file and script are gone. A fixture proves it: a
component with `fontSize: 14, color: '#FF0000'` yields a colour and a
fontSize hit and the hard-zero assertion throws naming the file and line;
the same component on tokens passes. One precise rule was added instead of an
exemption: a colour function whose first argument is an interpolation
(`rgb(${r},${g},${b})`, the viewer's cel shading) is computed, not raw; a
literal channel next to an interpolation still fails. The club colours in
`leagueData.ts` stay excluded as data.

## Bundle

A module-level spread of an imported style preset is a possible side effect
to Rollup, so `main.tsx`'s import of the match barrel kept the viewer demo,
the viewer and the client-side engine in the entry chunk (212 kB to 307 kB).
Those two presets are built inside functions; the entry chunk is back to
212 kB with the same 115 modules as main.
