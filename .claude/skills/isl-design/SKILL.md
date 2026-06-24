---
name: isl-design
description: Use this skill to generate well-branded interfaces and assets for the Intergalactic Soccer League (ISL) — a Blaseball-inspired, AI-simulated cosmic soccer betting & voting experience — either for production or throwaway prototypes/mocks. Contains essential design guidelines, colours, type, fonts, assets, and UI-kit components for prototyping.
user-invocable: true
---

Read the `README.md` file within this skill, and explore the other available files
(`colors_and_type.css` for tokens, `assets/` for logos + imagery, `preview/` for
specimen cards, `ui_kits/web/` for the recreated web app).

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy
assets out and create static HTML files for the user to view — always import
`colors_and_type.css` first and build on Space Mono, the Galactic-Abyss-on-Lunar-
Dust palette, hairline boxes, and the dry cosmic-bureaucratic voice. If working on
production code, copy assets and read the rules here to become an expert in
designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want
to build or design, ask a few focused questions, and act as an expert designer who
outputs HTML artifacts _or_ production code, depending on the need.

Core reminders (full detail in README.md):
- **One typeface:** Space Mono (Google Fonts). No second family. Mostly Bold,
  uppercase for UI chrome; sentence case for headlines.
- **Palette is rationed:** ~90% Lunar Dust (#E3E0D5) on Galactic Abyss (#111).
  Accents mean things — Solar Flare = live/error, Quantum Purple = focus/Architect
  (always glowing), Astro Explorer = CTA, Terra Nova = success.
- **Hard-edged:** radius 0 everywhere except round avatars/dots. Cards are 1px
  hairline boxes — no fill, no shadow. Elevation is shown with glow, not shadow.
- **Voice:** deadpan, technical, ominous. Roman numerals + astronomical glyphs.
  Never use emoji.
- **Imagery:** cool, dark, lightly-grained space photography. Never put text
  directly over an image.
- **Logo:** the full-colour ISL badge (`assets/isl-logo-full.png`) is the mark.
