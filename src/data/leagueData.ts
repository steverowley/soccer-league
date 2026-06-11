// ── Type definitions ────────────────────────────────────────────────────────────

export interface League {
  id: string;
  name: string;
  shortName: string;
  description: string;
}

export interface Team {
  id: string;
  name: string;
  location: string;
  homeGround: string;
  capacity: string;
  color: string;
  tagline: string;
  description: string;
}

export interface TeamWithLeague extends Team {
  leagueId: string;
}

// ── League definitions ────────────────────────────────────────────────────────
export const LEAGUES: League[] = [
  {
    id: 'rocky-inner',
    name: 'Rocky Inner League',
    shortName: 'RIL',
    description:
      'Founded in the earliest days of the ISL, the Rocky Inner League is the bedrock of interplanetary soccer—both literally and culturally. Born from humanity\'s first intra-solar rivalries, its teams hail from the inner planets where soccer evolved under harsh environments and heavy gravity. The league is known for its unforgiving tempo and tactical fundamentals, earning it the nickname "The Forge." Matches here are tests of durability and discipline, with a history of grinding scorelines and epic rivalries—most famously the "Crust Clash" between Earth United and Mercury Heat. Legends like Iro Duma of Mars Rovers, a striker who once scored from orbit during a low-gravity assist match, and Captain Solara, Earth United\'s last true sweeper-keeper, are immortalised in match tapes still studied by youth academies galaxy-wide.',
  },
  {
    id: 'gas-giants',
    name: 'Gas/Ice Giants League',
    shortName: 'GGL',
    description:
      'The Gas Giants League emerged later, but quickly became a powerhouse of spectacle and innovation. With playfields suspended above clouds, wrapped around orbital rings, or drifting inside pressurised spheres, this league had to reinvent the sport—leading to an emphasis on aerial agility, multi-dimensional formations, and split-second reflexes. Known colloquially as "The Ballet of the Sky," its players often double as performance artists and pioneers of gravity-defying play. The Saturn Rings were the first to perfect the zero-G spiral formation, while the Uranus Revolution shook the league in 2432 with their inverted protest-formation that led to a ten-match winning streak.',
  },
  {
    id: 'outer-reaches',
    name: 'Outer Reaches League',
    shortName: 'ORL',
    description:
      'Cold, dark, and distant—these teams play like survivors. The Outer Reaches League thrives on underdog energy and raw ambition. Pluto Rebels fight with scrappy defiance, often turning chaos into strategy. Ceres Miners are brutal and workmanlike, grinding opponents down as if chiseling through stone. Europa Explorers bring a touch of science and discovery to the pitch, their style experimental but brilliant. And the Titan Titans? They\'re towering, slow-burning, and impossible to shake once they gather momentum. Out here, the void watches—but never blinks.',
  },
  {
    id: 'kuiper-belt',
    name: 'Kuiper Belt League',
    shortName: 'KBL',
    description:
      'The most distant league in the ISL. Clubs from trans-Neptunian objects brave the deepest cold of the outer system. The longest travel distances in the ISL create unique home-advantage effects—visiting teams arrive exhausted, and home sides exploit every atmospheric and psychological edge the void has to offer.',
  },
];

// ── Teams grouped by league id ─────────────────────────────────────────────────
export const TEAMS_BY_LEAGUE: Record<string, Team[]> = {

  'rocky-inner': [
    {
      id: 'mercury-runners',
      name: 'Mercury Runners FC',
      location: 'Mercury',
      homeGround: 'Solar Sprint Stadium, "The Heat Box"',
      capacity: '35,000',
      color: '#CD7F32',
      tagline: 'Notable for their extraordinary speed on the pitch.',
      description:
        'Hailing from the closest planet to the sun, Mercury Runners FC is a founding member of the prestigious Rocky Inner League. They represent the unique challenges and adaptations required for life and sport on the small, scorching planet. True to their name, the Runners are renowned throughout the solar system for their blistering pace and relentless energy. This signature speed isn\'t just tactics; it\'s an evolutionary advantage honed by generations adapting to Mercury\'s extreme temperature swings, demanding rapid movement and endurance.\n\nTheir home matches are played at the Solar Sprint Stadium, aptly nicknamed "The Heat Box" by visiting teams who often struggle with the intense conditions. The team competes in distinctive muted colors of Burnt Sienna, Dark Slate, and Goldenrod, reflecting the metallic hues and deep shadows of their home world. While major silverware has eluded them so far, the Runners are a consistently competitive side, known for causing upsets with their rapid counter-attacks and pushing opponents to their physical limits. Their ambition burns as brightly as their home star as they strive to translate their unique planetary gifts into championship glory.',
    },
    {
      id: 'earth-united',
      name: 'Earth United FC',
      location: 'Earth',
      homeGround: 'Blue Marble Arena, "The Blue Marble"',
      capacity: '95,000',
      color: '#4169E1',
      tagline: 'The oldest club in the league with a balanced play style.',
      description:
        'Earth United FC is the oldest and most storied club in the Rocky Inner League. Playing at the iconic Blue Marble Arena, they embody the full diversity of human sporting tradition. Their balanced, disciplined approach to the game has produced more league titles than any other Rocky Inner side.',
    },
    {
      id: 'venus-volcanic',
      name: 'Venus Volcanic SC',
      location: 'Venus',
      homeGround: 'Pressure Cooker Stadium',
      capacity: '52,000',
      color: '#FF6B35',
      tagline: 'Known for their aggressive pressing style.',
      description:
        'Venus Volcanic SC play an intense high-press game that mirrors the volcanic fury of their home world. Few teams can withstand their relentless pressure in the first half.',
    },
    {
      id: 'terra-nova',
      name: 'Terra Nova SC',
      location: 'Earth',
      homeGround: 'The World Park, "The Greenhouse"',
      capacity: '58,000',
      color: '#A5D6A7',
      tagline: 'Focused on youth development and attacking football.',
      description:
        'Terra Nova SC are known across the league for their investment in youth academies and flowing attacking football. Their teams are often the youngest in the league—and among the most exciting.',
    },
    {
      id: 'mars-athletic',
      name: 'Mars Athletic',
      location: 'Mars',
      homeGround: 'Red Planet Arena, "The Dust Bowl"',
      capacity: '48,000',
      color: '#FF4500',
      tagline: 'Disciplined defensive structure and counter-attacks.',
      description:
        'Mars Athletic are renowned as one of the toughest defensive sides in the league. Their low-block system, built on Martian endurance, has frustrated the best attacking teams in the solar system.',
    },
    {
      id: 'olympus-mons',
      name: 'Olympus Mons FC',
      location: 'Mars',
      homeGround: 'Limeil Stadium, "The Mountain"',
      capacity: '89,000',
      color: '#CC4444',
      tagline: 'Specialists in aerial duels.',
      description:
        'Playing at the highest-altitude stadium in the league, Olympus Mons FC have developed an unrivalled aerial game. Their set-piece record is the stuff of legend.',
    },
    {
      id: 'valles-mariners',
      name: 'Valles Mariners SC',
      location: 'Mars',
      homeGround: 'Canyon Complex, "The Trench"',
      capacity: '61,000',
      color: '#8B4513',
      tagline: 'Famous for technical midfielders and positional play.',
      description:
        'Valles Mariners SC are the thinking person\'s team in the Rocky Inner League. Their tiki-taka style, adapted from ancient canyon tactics, produces the highest pass-completion rates in the division.',
    },
    {
      id: 'solar-city',
      name: 'Solar City FC',
      location: 'Largest Orbital Colony',
      homeGround: 'Orbital Stadium, "The Ring"',
      capacity: '72,000',
      color: '#FFD700',
      tagline: 'A diverse team representing the largest inhabited colony.',
      description:
        'Representing the most populous orbital colony in the inner system, Solar City FC draws on a diverse roster of players from across the solar system. Their eclectic style reflects the cosmopolitan nature of their home.',
    },
  ],

  'gas-giants': [
    {
      id: 'jupiter-titans',
      name: 'Jupiter Titans FC',
      location: 'Jupiter',
      homeGround: 'Storm Arena, "The Red Spot"',
      capacity: '110,000',
      color: '#D2691E',
      tagline: 'Known for their physical power and fearsome defensive line.',
      description:
        'Jupiter Titans FC are the giants of the Gas/Ice Giants League in every sense. Their imposing physicality, reinforced by Jupiter\'s intense gravity training, makes them the most physically dominant side in the ISL.',
    },
    {
      id: 'europa-oceanic',
      name: 'Europa Oceanic SC',
      location: 'Europa',
      homeGround: 'Subsurface Stadium, "The Ice Bowl"',
      capacity: '53,000',
      color: '#87CEEB',
      tagline: 'Pioneers of fluid football.',
      description:
        'Europa Oceanic SC play a fluid, flowing style inspired by the vast subsurface oceans of their moon home. Their intricate passing weaves like water, impossible to contain.',
    },
    {
      id: 'ganymede-united',
      name: 'Ganymede United',
      location: 'Ganymede',
      homeGround: 'Crater Fields, "The Cradle"',
      capacity: '67,000',
      color: '#708090',
      tagline: 'Founded by miners; emphasises endurance.',
      description:
        'Born from the mining communities of Ganymede, United represent working-class values translated into sport. Their relentless work rate across 90 minutes is unmatched in the division.',
    },
    {
      id: 'callisto-wolves',
      name: 'Callisto Wolves',
      location: 'Callisto',
      homeGround: 'Frozen Plains Stadium, "The Howling Den"',
      capacity: '45,000',
      color: '#B0C4DE',
      tagline: 'Famous for pack mentality and coordinated pressing.',
      description:
        'The Wolves hunt in packs. Their coordinated pressing system, developed through the brutal conditions of Callisto\'s surface, is one of the most tactically sophisticated in the league.',
    },
    {
      id: 'saturn-rings',
      name: 'Saturn Rings FC',
      location: 'Saturn Rings',
      homeGround: 'Cassini Colosseum, "The Halo"',
      capacity: '65,000',
      color: '#9A5CF4',
      tagline: 'Known for fluid movement and beautiful passing patterns.',
      description:
        'Saturn Rings FC play the most aesthetically pleasing football in the ISL. Their passing patterns mirror the rings of their home planet—circular, hypnotic, and impossible to break.',
    },
    {
      id: 'titan-methane',
      name: 'Titan Methane SC',
      location: 'Titan',
      homeGround: 'Hydrocarbon Park, "The Orange Haze"',
      capacity: '46,000',
      color: '#FFA500',
      tagline: 'Specialists in high-pressing games in thick atmosphere.',
      description:
        'Training in Titan\'s thick methane atmosphere builds extraordinary lung capacity. Titan Methane SC use this to press relentlessly for the full 90 minutes, exhausting opponents.',
    },
    {
      id: 'enceladus-geysers',
      name: 'Enceladus Geysers',
      location: 'Enceladus',
      homeGround: 'Geyser Stadium, "The Spray"',
      capacity: '38,000',
      color: '#E0F7FA',
      tagline: 'Known for explosive counterattacks.',
      description:
        'Like the geysers of their icy home, Enceladus Geysers erupt with sudden, devastating counter-attacks. They can absorb pressure for long periods before unleashing explosive offensives.',
    },
    {
      id: 'uranus-sidewinders',
      name: 'Uranus Sidewinders',
      location: 'Uranus',
      homeGround: 'Polar Tilt Arena, "The Tilted Field"',
      capacity: '55,000',
      color: '#40E0D0',
      tagline: 'Famous for unpredictable play style.',
      description:
        'Playing on a planet tilted at 98 degrees has given the Sidewinders an unconventional perspective on the game. Their unpredictable tactics and lateral movement confuse even the best-prepared opposition.',
    },
  ],

  'outer-reaches': [
    {
      id: 'ceres-miners',
      name: 'Ceres Miners FC',
      location: 'Ceres',
      homeGround: 'Dwarf Planet Field, "The Rock"',
      capacity: '29,000',
      color: '#8B7355',
      tagline: 'Oldest and toughest club in the Asteroid Belt.',
      description:
        'The Miners represent the grit and determination of the asteroid belt. Their grinding style of play wears down opponents like rock against rock.',
    },
    {
      id: 'vesta',
      name: 'Vesta FC',
      location: 'Vesta',
      homeGround: 'Protoplanet Arena, "The Crater"',
      capacity: '24,000',
      color: '#C0C0C0',
      tagline: 'Masters of low-gravity football.',
      description:
        'Vesta FC have mastered the art of football in low gravity. Their floating passing game and long-range shooting make them one of the most entertaining sides in the league.',
    },
    {
      id: 'pallas-wanderers',
      name: 'Pallas Wanderers',
      location: 'Pallas',
      homeGround: 'Nomad Stadium, "The Drifter"',
      capacity: '21,000',
      color: '#DEB887',
      tagline: 'Known for adaptability in tactics.',
      description:
        'The Wanderers live up to their name—they adapt their system each match, unpredictable and versatile in equal measure.',
    },
    {
      id: 'hygiea-united',
      name: 'Hygiea United',
      location: 'Hygiea',
      homeGround: 'Subterranean Field, "The Dark Pitch"',
      capacity: '18,000',
      color: '#696969',
      tagline: 'Famous for solid defensive structures.',
      description:
        'Playing in the darkest reaches of the asteroid belt, Hygiea United have built a fortress. Their defensive record is the best in the outer reaches.',
    },
    {
      id: 'psyche-metallics',
      name: 'Psyche Metallics',
      location: 'Psyche',
      homeGround: 'Core Ore Stadium, "The Forge"',
      capacity: '22,000',
      color: '#B8860B',
      tagline: 'Known for physical strength and power.',
      description:
        'Playing on a metallic asteroid has given the Metallics an almost supernatural physicality. They are the strongest side in the belt, pound for pound.',
    },
    {
      id: 'juno-city',
      name: 'Juno City FC',
      location: 'Juno',
      homeGround: 'Juno Memorial Stadium, "The Temple"',
      capacity: '31,000',
      color: '#9370DB',
      tagline: 'Values discipline and tactical organisation.',
      description:
        'Juno City FC are the most tactically disciplined club in the outer reaches. Their rigid organisational structure rarely concedes—or entertains—but delivers results.',
    },
    {
      id: 'beltway',
      name: 'Beltway FC',
      location: 'Asteroid Belt Colony',
      homeGround: 'Transit Hub Arena, "The Junction"',
      capacity: '19,000',
      color: '#4A4A8A',
      tagline: 'Tactical and gritty, forged in the lawless belt colonies.',
      description:
        'Born from the intersection of a dozen asteroid belt trade routes, Beltway FC represent the pragmatic, opportunistic spirit of colony life. Their tactics mirror the belt itself: adaptable, layered, and always looking for the gap. Formed by workers who played football in cargo bays and pressurised corridors, they carry a blue-collar heart into every match.\n\nWith the smallest budget in the Outer Reaches League, Beltway punch well above their weight through organised counterattacking and relentless set-piece preparation. The Junction has an atmosphere disproportionate to its size—belt colony fans are loud, passionate, and unafraid of a fight.',
    },
    {
      id: 'solar-miners',
      name: 'Solar Miners FC',
      location: 'Asteroid Belt Colony',
      homeGround: 'Extraction Field, "The Dig"',
      capacity: '17,000',
      color: '#E8C84A',
      tagline: 'They drill for every inch of the pitch.',
      description:
        'Solar Miners FC channel the exhausting, relentless work ethic of asteroid mining operations directly into their football. They drill through defences, press without mercy, and never stop running—even when the match is lost. Originally a recreational side for workers at the Kepler-7 extraction colony, they earned promotion through sheer collective effort.\n\nPhysical and direct, Solar Miners rarely produce beautiful football—but they produce results. The Dig is an intimidating venue built partly underground in a decommissioned ore shaft, and visiting teams hate its uneven acoustics and faintly sulfurous atmosphere.',
    },
  ],

  'kuiper-belt': [
    {
      id: 'pluto-frost',
      name: 'Pluto Frost FC',
      location: 'Pluto',
      homeGround: 'Nitrogen Icebox, "The Deep Freeze"',
      capacity: '25,000',
      color: '#B0E0E6',
      tagline: 'Former giants of outer solar system football.',
      description:
        'Still mourning their planet\'s demotion, Pluto Frost channel their righteous anger into football. They are perpetual underdogs with the spirit of former champions.',
    },
    {
      id: 'charon-united',
      name: 'Charon United',
      location: 'Charon',
      homeGround: 'Binary Lagrange Arena, "The Moon"',
      capacity: '18,000',
      color: '#A9A9A9',
      tagline: 'Developing their own identity.',
      description:
        'Long overshadowed by their larger neighbour Pluto, Charon United are in the process of forging an identity entirely their own. A young club on the rise.',
    },
    {
      id: 'eris-wanderers',
      name: 'Eris Wanderers',
      location: 'Eris',
      homeGround: 'Distant Objects Stadium, "The Outpost"',
      capacity: '16,000',
      color: '#DDA0DD',
      tagline: 'Most distant club in the league.',
      description:
        'Eris Wanderers travel the longest distances for away matches, and it shows in their mental fortitude. No club trains harder between fixtures.',
    },
    {
      id: 'haumea-spinners',
      name: 'Haumea Spinners',
      location: 'Haumea',
      homeGround: 'Centrifuge Field, "The Oval"',
      capacity: '14,000',
      color: '#F0E68C',
      tagline: 'Known for unusual elliptical wide-area play.',
      description:
        'Playing on Haumea\'s egg-shaped surface has given the Spinners an eccentric wide-play style. Their wingers operate at unusual angles that disorient conventional defences.',
    },
    {
      id: 'makemake',
      name: 'Makemake FC',
      location: 'Makemake',
      homeGround: 'Creation Stadium, "The Cradle"',
      capacity: '12,000',
      color: '#CD853F',
      tagline: 'Specialists in creating chances from nothing.',
      description:
        'As their planetary name suggests, Makemake FC are creators. Their attacking play conjures chances from almost nothing—one of the most inventive clubs in the ISL.',
    },
    {
      id: 'orcus-athletic',
      name: 'Orcus Athletic',
      location: 'Orcus',
      homeGround: 'Underworld Arena, "The Pit"',
      capacity: '11,000',
      color: '#2F4F4F',
      tagline: 'Dark horses who excel at free-kicks.',
      description:
        'From the darkest corner of the Kuiper Belt, Orcus Athletic are the ultimate dark horse. Their dead-ball specialists have decided more matches than any other set-piece team in the league.',
    },
    {
      id: 'sedna-mariners',
      name: 'Sedna FC Mariners',
      location: 'Sedna',
      homeGround: 'Perihelion Park, "The Long Way Round"',
      capacity: '9,000',
      color: '#8B0000',
      tagline: 'The most patient team in the outer system.',
      description:
        'Sedna FC Mariners play like their home world orbits: with vast, unhurried patience. Sedna\'s extraordinary 11,400-year elliptical orbit has instilled in its inhabitants a philosophical relationship with time—and their football reflects it. They build slowly, absorb pressure without breaking, and strike only when the moment is certain.\n\nPerihelion Park is among the most remote stadiums in the known solar system, and home advantage here is almost mythological. Visiting teams must travel further than anyone else in the ISL, and they arrive already drained. The Mariners have never beaten a top-four side away from home—but they have never been relegated either.',
    },
    {
      id: 'scattered-disc',
      name: 'Scattered Disc FC Rangers',
      location: 'Outer Kuiper Belt',
      homeGround: 'Void Stadium, "The Scatter"',
      capacity: '8,000',
      color: '#556B2F',
      tagline: 'Wild, untamed football from the edge of everything.',
      description:
        'Scattered Disc FC Rangers play from the absolute fringe of the solar system, in a region so loosely defined that cartographers argue about whether it technically exists. Their football is similarly hard to classify: chaotic, improvisational, and occasionally brilliant. Tactics arrive by committee, change at half-time, and are abandoned by the 70th minute.\n\nThe Void Stadium\'s sparse attendance and enormous silence create a unique atmosphere—not intimidating so much as deeply unsettling. Opponents describe games there as "playing against the cosmos itself." In their few seasons in the Kuiper Belt League, the Rangers have delivered both the highest-scoring victory and the most embarrassing defeat in the division\'s history.',
    },
  ],
};
