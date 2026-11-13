// ── shared/design/direction.ts ──────────────────────────────────────────────
// Opt-in, site-wide preview of a proposed design direction.
//
// WHY: the owner judges a design direction by using it, not from screenshots.
// Every type role (face, case, weight, size, tracking) and the card surface
// are CSS variables in tokens.css, so a direction is just a block of
// overrides under html[data-direction="..."]. This module switches that
// attribute: open any page with ?direction=broadcast and the whole site
// renders in that direction with its real data; the choice is remembered in
// this browser until ?direction=off (or the switcher's Current button).
//
// Fans are untouched: with no ?direction link ever followed, nothing is set,
// no extra font loads and the switcher chunk is never downloaded.

/** The directions a preview can show, in the order the switcher lists them. */
export const DIRECTIONS = ['terminal', 'broadcast', 'almanac'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Switcher labels: the letters match docs/design-directions.md. */
export const DIRECTION_LABEL: Readonly<Record<Direction, string>> = {
  terminal: 'A · Refined terminal',
  broadcast: 'B · Broadcast',
  almanac: 'C · Almanac',
};

/** localStorage key that remembers an active preview in this browser. */
export const DIRECTION_STORAGE_KEY = 'isl-design-direction';

/** Query values that switch a preview off. */
const OFF = new Set(['off', 'current', 'none']);

/** The faces the three directions add, loaded only while a preview is on. */
export const DIRECTION_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700' +
  '&family=Big+Shoulders+Display:wght@700;800;900' +
  '&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap';

const FONTS_LINK_ID = 'isl-direction-fonts';

function isDirection(value: string | null | undefined): value is Direction {
  return value != null && (DIRECTIONS as readonly string[]).includes(value);
}

/**
 * Decide which direction (if any) is active from the URL and the stored choice.
 *
 * @param search  `location.search`.
 * @param stored  The value in localStorage, or null.
 * @returns       `{ direction, store }`: the direction to show (null for the
 *                current site) and what to write back to storage (undefined
 *                leaves storage alone, null clears it).
 */
export function resolveDirection(
  search: string,
  stored: string | null,
): { direction: Direction | null; store: Direction | null | undefined } {
  const asked = new URLSearchParams(search).get('direction');
  if (asked != null) {
    const value = asked.trim().toLowerCase();
    if (OFF.has(value)) return { direction: null, store: null };
    if (isDirection(value)) return { direction: value, store: value };
  }
  return { direction: isDirection(stored) ? stored : null, store: undefined };
}

function readStored(): string | null {
  try { return window.localStorage.getItem(DIRECTION_STORAGE_KEY); } catch { return null; }
}

function writeStored(value: Direction | null): void {
  try {
    if (value == null) window.localStorage.removeItem(DIRECTION_STORAGE_KEY);
    else window.localStorage.setItem(DIRECTION_STORAGE_KEY, value);
  } catch { /* private mode: the preview just will not persist */ }
}

function ensureFonts(): void {
  if (document.getElementById(FONTS_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FONTS_LINK_ID;
  link.rel = 'stylesheet';
  link.href = DIRECTION_FONTS_URL;
  document.head.appendChild(link);
}

/**
 * Show a direction site-wide (or the current site, for null) and remember it.
 *
 * @param direction  The direction, or null to switch the preview off.
 */
export function applyDirection(direction: Direction | null): void {
  const root = document.documentElement;
  if (direction == null) {
    delete root.dataset.direction;
  } else {
    ensureFonts();
    root.dataset.direction = direction;
  }
  writeStored(direction);
}

/**
 * Read the URL and storage once at startup and apply the result.
 *
 * @returns The active direction, or null when no preview is on (the normal case).
 */
export function initDirection(): Direction | null {
  if (typeof window === 'undefined') return null;
  const { direction, store } = resolveDirection(window.location.search, readStored());
  if (direction != null) {
    ensureFonts();
    document.documentElement.dataset.direction = direction;
  }
  if (store !== undefined) writeStored(store);
  return direction;
}
