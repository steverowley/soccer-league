# ISL Web UI Kit

A high-fidelity, click-through recreation of the **Intergalactic Soccer League**
public web app. Faithful to the Figma source (`New-App-Pages → home` / `leagues`)
and the design-system frame — desktop, dark, monospace, hard-edged.

Open **`index.html`**. Everything is built with React (via in-browser Babel) and
the shared tokens in `../../colors_and_type.css`.

## What's interactive
- **Auth states** — the nav starts as a *new user* (purple **Create account**).
  Create an account → the nav flips to the *logged-in* state with a live
  **USER · BALANCE · ic** chip. (A *logged-out* "Log in" state also exists.)
- **Navigation** — Home and Leagues are fully built; click any link to route.
  Surfaces not present in the design source (Teams, Matches, …) show an honest
  "Not yet charted" placeholder rather than invented UI.
- **Betting** — on the live match card, pick an outcome and drag the stake slider;
  **Place stake** deducts Intergalactic Credits from your balance and fires a
  confirmation toast. (Cosmetic — no real odds engine.)
- **Live match** — featured match with score, possession **momentum bar** whose
  purple bloom intensifies with possession, two AI commentators, and an upcoming-
  fixtures rail.
- **Standings** — dense monospace tables for all four orbital leagues, with the
  W/D/L form strip (losses red, draws dimmed) and red-marked relegation rows.

## Files
| File | Component(s) |
|---|---|
| `index.html` | Entry point — loads React + all components in order. |
| `primitives.jsx` | `Logo`, `Button`, `TertiaryLink`, `Arrow`, `Eyebrow`, `Divider`, `FormStrip`, `Crest`, `StatusDot`. |
| `Nav.jsx` | Top navigation with the three auth states. |
| `Hero.jsx` | Homepage hero (image left, content right) + `MetaChips`, `StatBlock`. |
| `LiveMatch.jsx` | Featured match card, commentary, fixtures rail, `StakeRow`. |
| `Steps.jsx` | "Three steps to enter" onboarding. |
| `Standings.jsx` | `StandingsTable` + `LeagueSection` wrapper. |
| `Footer.jsx` | Site footer. |
| `data.jsx` | Standings data for the four leagues (`ISL_LEAGUES`). |
| `app.jsx` | App shell — routing, auth, balance, toast; Home + Leagues pages. |

## Conventions
- Components share scope via `window` (each Babel `<script>` is isolated), so every
  file ends with `Object.assign(window, { … })`. Style objects are uniquely named
  (e.g. `islBtnBase`) — never a bare `styles`.
- All colour/type/spacing comes from CSS variables in `colors_and_type.css`. No
  hard-coded hexes in components.

## Known placeholders / caveats
- **Team crests** — **Earth United** and **Mars Rovers** use real crest art
  (`assets/crest-*.png`). Other clubs fall back to monogram circles until their
  art is produced; pass an `img` to `Crest` to slot in new crests.
- The kit is a **desktop** recreation designed at 1920. Below ~1200px it scrolls
  horizontally rather than reflowing — matching the source, which has no mobile
  layout in scope.
