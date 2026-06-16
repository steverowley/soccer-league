// ISL Web UI Kit — standings data for the four orbital leagues.
function mkForm(s) { return s.split(""); }

const ISL_LEAGUES = [
  {
    index: "I", title: "Rocky Inner League",
    desc: "Clubs from terrestrial planets and inner solar colonies.",
    rows: [
      { rank: 1, club: "Mercury Runners FC", p: 14, w: 10, d: 2, l: 2, gd: 18, form: mkForm("WWDWL"), pts: 32 },
      { rank: 2, club: "Earth United FC", p: 14, w: 9, d: 3, l: 2, gd: 14, form: mkForm("WDWWD"), pts: 30 },
      { rank: 3, club: "Terra Nova SC", p: 14, w: 9, d: 1, l: 4, gd: 8, form: mkForm("WLWLW"), pts: 28 },
      { rank: 4, club: "Mars Rovers", p: 14, w: 7, d: 4, l: 3, gd: 5, form: mkForm("DWDWL"), pts: 25 },
      { rank: 5, club: "Olympus Mons FC", p: 14, w: 6, d: 3, l: 5, gd: -1, form: mkForm("LWDLW"), pts: 21 },
      { rank: 6, club: "Valles Mariners SC", p: 14, w: 4, d: 4, l: 6, gd: -7, form: mkForm("LDLWD"), pts: 16 },
      { rank: 7, club: "Venus Volcanic", p: 14, w: 3, d: 4, l: 7, gd: -12, form: mkForm("LLDLW"), pts: 13 },
      { rank: 8, club: "Solar City FC", p: 14, w: 2, d: 3, l: 9, gd: -25, form: mkForm("LLLDL"), pts: 9 },
    ],
  },
  {
    index: "II", title: "Gas/Ice Giant League",
    desc: "Teams from gas and ice giant planets emphasise strength and tactical excellence.",
    rows: [
      { rank: 1, club: "Jupiter Royals F", p: 14, w: 10, d: 2, l: 2, gd: 18, form: mkForm("WWDWL"), pts: 32 },
      { rank: 2, club: "Great Red FC", p: 14, w: 9, d: 3, l: 2, gd: 14, form: mkForm("WDWWD"), pts: 30 },
      { rank: 3, club: "Saturn Rings United", p: 14, w: 9, d: 1, l: 4, gd: 8, form: mkForm("WLWLW"), pts: 28 },
      { rank: 4, club: "Cassini Explorers FC", p: 14, w: 7, d: 4, l: 3, gd: 5, form: mkForm("DWDWL"), pts: 25 },
      { rank: 5, club: "Uranus Athletic Club", p: 14, w: 6, d: 3, l: 5, gd: -1, form: mkForm("LWDLW"), pts: 21 },
      { rank: 6, club: "Neptune FC Mariners", p: 14, w: 4, d: 4, l: 6, gd: -7, form: mkForm("LDLWD"), pts: 16 },
      { rank: 7, club: "Galilean Giants FC", p: 14, w: 3, d: 4, l: 7, gd: -12, form: mkForm("LLDLW"), pts: 13 },
      { rank: 8, club: "Saturn Orbital SC", p: 14, w: 2, d: 3, l: 9, gd: -25, form: mkForm("LLLDL"), pts: 9 },
    ],
  },
  {
    index: "III", title: "Asteroid Belt League",
    desc: "Teams representing asteroid belt objects are known for resilience and tactical adaptability.",
    rows: [
      { rank: 1, club: "Ceres City FC", p: 14, w: 10, d: 2, l: 2, gd: 18, form: mkForm("WWDWL"), pts: 32 },
      { rank: 2, club: "Vesta United", p: 14, w: 9, d: 3, l: 2, gd: 14, form: mkForm("WDWWD"), pts: 30 },
      { rank: 3, club: "Pallas SC", p: 14, w: 9, d: 1, l: 4, gd: 8, form: mkForm("WLWLW"), pts: 28 },
      { rank: 4, club: "Hygiea Rangers", p: 14, w: 7, d: 4, l: 3, gd: 5, form: mkForm("DWDWL"), pts: 25 },
      { rank: 5, club: "Beltway FC", p: 14, w: 6, d: 3, l: 5, gd: -1, form: mkForm("LWDLW"), pts: 21 },
      { rank: 6, club: "Solar Miners FC", p: 14, w: 4, d: 4, l: 6, gd: -7, form: mkForm("LDLWD"), pts: 16 },
      { rank: 7, club: "Juno Athletic", p: 14, w: 3, d: 4, l: 7, gd: -12, form: mkForm("LLDLW"), pts: 13 },
      { rank: 8, club: "Pallas Rovers F", p: 14, w: 2, d: 3, l: 9, gd: -25, form: mkForm("LLLDL"), pts: 9 },
    ],
  },
  {
    index: "IV", title: "Kuiper Belt League",
    desc: "Clubs from distant dwarf planets emphasise endurance and tactical finesse.",
    rows: [
      { rank: 1, club: "Pluto FC Wanderers", p: 14, w: 10, d: 2, l: 2, gd: 18, form: mkForm("WWDWL"), pts: 32 },
      { rank: 2, club: "Eris FC Rebels", p: 14, w: 9, d: 3, l: 2, gd: 14, form: mkForm("WDWWD"), pts: 30 },
      { rank: 3, club: "Haumea SC Cyclones", p: 14, w: 9, d: 1, l: 4, gd: 8, form: mkForm("WLWLW"), pts: 28 },
      { rank: 4, club: "Makemake United", p: 14, w: 7, d: 4, l: 3, gd: 5, form: mkForm("DWDWL"), pts: 25 },
      { rank: 5, club: "Sedna FC Mariners", p: 14, w: 6, d: 3, l: 5, gd: -1, form: mkForm("LWDLW"), pts: 21 },
      { rank: 6, club: "Plutino FC Pirates", p: 14, w: 4, d: 4, l: 6, gd: -7, form: mkForm("LDLWD"), pts: 16 },
      { rank: 7, club: "Orcus FC Shadows", p: 14, w: 3, d: 4, l: 7, gd: -12, form: mkForm("LLDLW"), pts: 13 },
      { rank: 8, club: "Scattered Disc FC Rangers", p: 14, w: 2, d: 3, l: 9, gd: -25, form: mkForm("LLLDL"), pts: 9 },
    ],
  },
];

Object.assign(window, { ISL_LEAGUES });
