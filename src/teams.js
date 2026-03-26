// ── teams.js ──────────────────────────────────────────────────────────────────
// Static roster data for the two default clubs.
//
// HOW PLAYER STATS WORK
// ─────────────────────
// Every player has five numeric attributes, each ranging from ~38 to ~90:
//
//  attacking  – used as the primary stat when shooting or making a run.
//               Also influences penalty-taking ability (combined with mental).
//  defending  – used when tackling, blocking or as a keeper stopping shots.
//               Goalkeepers have high defending; outfield defenders moderate.
//  mental     – decision-making, composure, set-piece quality.
//               High mental → more likely to become team captain.
//               Also drives the "team_player" personality threshold.
//  athletic   – speed, stamina, heading ability.
//               High athletic → "workhorse" personality; low → "lazy".
//               Also used for fatigue accumulation calculations.
//  technical  – passing, dribbling, free-kick accuracy.
//               Used for corner-kick delivery and through-ball sequences.
//
// HOW PERSONALITY IS ASSIGNED (in createAgent, gameEngine.js)
// ────────────────────────────────────────────────────────────
//  attacking > 82 AND position FW  → selfish
//  mental > 78                     → team_player
//  defending > 82 AND position DF  → aggressive
//  athletic < 70                   → lazy
//  athletic > 85                   → workhorse
//  10% random chance               → creative
//  20% random chance               → cautious
//  otherwise                       → balanced
//
// The starter flag determines the initial 11 vs the 5-player bench.
// Up to 3 substitutions can be made per match (one GK sub slot is shared).
// Having 5 bench players (1 GK, 2 DF, 1 MF, 1 FW) gives the manager
// enough cover to make all 3 allowed subs and still leave 2 unused
// options — matching standard football bench conventions.

const TEAMS = {
  // ── Mars United ─────────────────────────────────────────────────────────────
  // Colour: volcanic orange (#FF4500)
  // Home ground: Olympus Mons Arena, Mars (capacity 89,000)
  // Formation: 4-3-3
  //
  // Strengths: Explosive forward trio with very high attacking stats.
  //            Vex Drago (ATK 88) and Asha Renn (ATK 85) are elite finishers.
  // Weaknesses: Midfield is slightly below Saturn's; the back four is solid
  //             but not exceptional.  GK Rex Volkov is reliable, not outstanding.
  mars: {
    name: "Mars United",
    shortName: "MAR",
    color: "#FF4500",
    stadium: { name: "Olympus Mons Arena", planet: "Mars", capacity: "89,000" },
    players: [
      // ── Starters ──────────────────────────────────────────────────────────
      // Goalkeeper
      { name: "Rex Volkov",      position: "GK", starter: true,  attacking: 45, defending: 82, mental: 78, athletic: 75, technical: 70 },
      // Defenders
      { name: "Dara Solis",      position: "DF", starter: true,  attacking: 55, defending: 85, mental: 72, athletic: 80, technical: 68 },
      { name: "Oryn Kade",       position: "DF", starter: true,  attacking: 50, defending: 83, mental: 70, athletic: 78, technical: 65 },
      { name: "Lyra Vance",      position: "DF", starter: true,  attacking: 58, defending: 80, mental: 75, athletic: 76, technical: 72 },
      { name: "Colt Mercer",     position: "DF", starter: true,  attacking: 60, defending: 78, mental: 68, athletic: 82, technical: 70 },
      // Midfielders — Mira Castillo has mental 82, so she qualifies as "team_player"
      { name: "Zane Obi",        position: "MF", starter: true,  attacking: 72, defending: 70, mental: 80, athletic: 78, technical: 76 },
      { name: "Mira Castillo",   position: "MF", starter: true,  attacking: 75, defending: 68, mental: 82, athletic: 74, technical: 80 },
      { name: "Teo Harlow",      position: "MF", starter: true,  attacking: 70, defending: 72, mental: 76, athletic: 80, technical: 74 },
      // Forwards — all qualify as "selfish" (attacking > 82, position FW)
      { name: "Asha Renn",       position: "FW", starter: true,  attacking: 85, defending: 45, mental: 74, athletic: 88, technical: 82 },
      { name: "Vex Drago",       position: "FW", starter: true,  attacking: 88, defending: 40, mental: 70, athletic: 86, technical: 80 },
      { name: "Nia Strome",      position: "FW", starter: true,  attacking: 83, defending: 42, mental: 72, athletic: 84, technical: 78 },
      // ── Bench ─────────────────────────────────────────────────────────────
      { name: "Bren Holloway",   position: "GK", starter: false, attacking: 42, defending: 78, mental: 70, athletic: 72, technical: 65 },
      { name: "Sael Dorin",      position: "DF", starter: false, attacking: 52, defending: 75, mental: 65, athletic: 74, technical: 62 },
      // Second backup DF — provides defensive depth so the manager can rotate
      // or cover injuries to the back four without burning the midfield sub.
      { name: "Kai Voss",        position: "DF", starter: false, attacking: 54, defending: 76, mental: 66, athletic: 76, technical: 63 },
      { name: "Kyra Moss",       position: "MF", starter: false, attacking: 68, defending: 65, mental: 70, athletic: 72, technical: 70 },
      { name: "Jett Crane",      position: "FW", starter: false, attacking: 80, defending: 38, mental: 68, athletic: 82, technical: 75 },
    ],
  },

  // ── Saturn Rings FC ──────────────────────────────────────────────────────────
  // Colour: cosmic purple (#9A5CF4)
  // Home ground: Cassini Division Field, Saturn Rings (capacity 65,000)
  // Formation: 4-3-3
  //
  // Strengths: Marginally higher overall team quality.  Halo Creed (ATK 89) is
  //            the single best forward on the pitch.  Midfield trio averages
  //            slightly higher technical and mental stats.
  // Weaknesses: Very similar to Mars United; slight edge in GK (Eon Vasquez
  //             defending 84 vs Rex Volkov 82), but both teams are well-matched.
  saturn: {
    name: "Saturn Rings FC",
    shortName: "SAT",
    color: "#9A5CF4",
    stadium: { name: "Cassini Division Field", planet: "Saturn Rings", capacity: "65,000" },
    players: [
      // ── Starters ──────────────────────────────────────────────────────────
      // Goalkeeper
      { name: "Eon Vasquez",     position: "GK", starter: true,  attacking: 44, defending: 84, mental: 80, athletic: 76, technical: 72 },
      // Defenders
      { name: "Nora Blaze",      position: "DF", starter: true,  attacking: 56, defending: 86, mental: 74, athletic: 79, technical: 70 },
      { name: "Axel Frost",      position: "DF", starter: true,  attacking: 52, defending: 84, mental: 71, athletic: 80, technical: 67 },
      { name: "Livy Thane",      position: "DF", starter: true,  attacking: 60, defending: 81, mental: 76, athletic: 77, technical: 73 },
      { name: "Rook Steele",     position: "DF", starter: true,  attacking: 62, defending: 79, mental: 69, athletic: 83, technical: 71 },
      // Midfielders — Demi Volta (mental 83) and Cass Wren (mental 81) are "team_player"
      { name: "Cass Wren",       position: "MF", starter: true,  attacking: 74, defending: 71, mental: 81, athletic: 79, technical: 77 },
      { name: "Demi Volta",      position: "MF", starter: true,  attacking: 76, defending: 69, mental: 83, athletic: 75, technical: 81 },
      { name: "Pierce Lux",      position: "MF", starter: true,  attacking: 71, defending: 73, mental: 77, athletic: 81, technical: 75 },
      // Forwards — all qualify as "selfish"
      { name: "Sera Nox",        position: "FW", starter: true,  attacking: 86, defending: 44, mental: 75, athletic: 87, technical: 83 },
      { name: "Halo Creed",      position: "FW", starter: true,  attacking: 89, defending: 39, mental: 71, athletic: 85, technical: 81 },
      { name: "Yuki Storm",      position: "FW", starter: true,  attacking: 84, defending: 41, mental: 73, athletic: 83, technical: 79 },
      // ── Bench ─────────────────────────────────────────────────────────────
      { name: "Finn Ardent",     position: "GK", starter: false, attacking: 41, defending: 79, mental: 71, athletic: 73, technical: 66 },
      { name: "Tara Veil",       position: "DF", starter: false, attacking: 53, defending: 76, mental: 66, athletic: 75, technical: 63 },
      // Second backup DF — mirrors Mars United's bench depth so both squads
      // have equivalent tactical flexibility in defensive cover situations.
      { name: "Reese Dawn",      position: "DF", starter: false, attacking: 55, defending: 77, mental: 67, athletic: 77, technical: 64 },
      { name: "Corin Ash",       position: "MF", starter: false, attacking: 69, defending: 66, mental: 71, athletic: 73, technical: 71 },
      { name: "Mav Solaris",     position: "FW", starter: false, attacking: 81, defending: 37, mental: 69, athletic: 83, technical: 76 },
    ],
  },
};

export default TEAMS;
