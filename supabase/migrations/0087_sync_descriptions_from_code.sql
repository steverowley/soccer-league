-- ── 0087_sync_descriptions_from_code.sql ───────────────────────────────────
-- The leagues and teams tables hold a second copy of the league and club
-- descriptions that also live in src/data/leagueData.ts. The copies drifted:
-- the database kept text that the code fixed in #701 (canon) and #702 (house
-- style), e.g. "founded in the earliest days of the ISL", "their few seasons",
-- and em dashes. The site renders the code copy; anything reading the
-- database (admin, edge functions, prompts) got the stale one.
--
-- Generated (one-off) from leagueData.ts, so the two are
-- byte-identical. Idempotent: rows already matching are untouched.

UPDATE leagues SET description = $lore$Founded in the earliest days of interplanetary football, the Rocky Inner League is the bedrock of the game, both literally and culturally. Born from humanity's first intra-solar rivalries, its teams hail from the inner planets where soccer evolved under harsh environments and heavy gravity. The league is known for its unforgiving tempo and tactical fundamentals, earning it the nickname "The Forge." Matches here are tests of durability and discipline, with a history of grinding scorelines and epic rivalries, most famously the "Crust Clash" between Earth United and Mercury Heat. Legends like Iro Duma of Mars Rovers, a striker who once scored from orbit during a low-gravity assist match, and Captain Solara, Earth United's last true sweeper-keeper, are immortalised in match tapes still studied by youth academies galaxy-wide.$lore$
WHERE id = 'rocky-inner' AND description IS DISTINCT FROM $lore$Founded in the earliest days of interplanetary football, the Rocky Inner League is the bedrock of the game, both literally and culturally. Born from humanity's first intra-solar rivalries, its teams hail from the inner planets where soccer evolved under harsh environments and heavy gravity. The league is known for its unforgiving tempo and tactical fundamentals, earning it the nickname "The Forge." Matches here are tests of durability and discipline, with a history of grinding scorelines and epic rivalries, most famously the "Crust Clash" between Earth United and Mercury Heat. Legends like Iro Duma of Mars Rovers, a striker who once scored from orbit during a low-gravity assist match, and Captain Solara, Earth United's last true sweeper-keeper, are immortalised in match tapes still studied by youth academies galaxy-wide.$lore$;

UPDATE leagues SET description = $lore$The Gas Giants League emerged later, but quickly became a powerhouse of spectacle and innovation. With playfields suspended above clouds, wrapped around orbital rings, or drifting inside pressurised spheres, this league had to reinvent the sport, leading to an emphasis on aerial agility, multi-dimensional formations, and split-second reflexes. Known colloquially as "The Ballet of the Sky," its players often double as performance artists and pioneers of gravity-defying play. The Saturn Rings were the first to perfect the zero-G spiral formation, while the Uranus Revolution shook the league in 2589 with their inverted protest-formation that led to a ten-match winning streak.$lore$
WHERE id = 'gas-giants' AND description IS DISTINCT FROM $lore$The Gas Giants League emerged later, but quickly became a powerhouse of spectacle and innovation. With playfields suspended above clouds, wrapped around orbital rings, or drifting inside pressurised spheres, this league had to reinvent the sport, leading to an emphasis on aerial agility, multi-dimensional formations, and split-second reflexes. Known colloquially as "The Ballet of the Sky," its players often double as performance artists and pioneers of gravity-defying play. The Saturn Rings were the first to perfect the zero-G spiral formation, while the Uranus Revolution shook the league in 2589 with their inverted protest-formation that led to a ten-match winning streak.$lore$;

UPDATE leagues SET description = $lore$Cold, dark, and distant: these teams play like survivors. The Outer Reaches League, the Belt's league, thrives on underdog energy and raw ambition. Ceres Miners are brutal and workmanlike, grinding opponents down as if chiseling through stone. Psyche Metallics play on a pitch of solid metal and tackle like it. Vesta float the ball where heavier leagues would hammer it, and Beltway, with the smallest budget in the division, beat sides that cost ten times as much and never let them forget it. Out here, the void watches, but never blinks.$lore$
WHERE id = 'outer-reaches' AND description IS DISTINCT FROM $lore$Cold, dark, and distant: these teams play like survivors. The Outer Reaches League, the Belt's league, thrives on underdog energy and raw ambition. Ceres Miners are brutal and workmanlike, grinding opponents down as if chiseling through stone. Psyche Metallics play on a pitch of solid metal and tackle like it. Vesta float the ball where heavier leagues would hammer it, and Beltway, with the smallest budget in the division, beat sides that cost ten times as much and never let them forget it. Out here, the void watches, but never blinks.$lore$;

UPDATE leagues SET description = $lore$The most distant league in the ISL. Clubs from trans-Neptunian objects brave the deepest cold of the outer system. The longest travel distances in the ISL create unique home-advantage effects: visiting teams arrive exhausted, and home sides exploit every atmospheric and psychological edge the void has to offer.$lore$
WHERE id = 'kuiper-belt' AND description IS DISTINCT FROM $lore$The most distant league in the ISL. Clubs from trans-Neptunian objects brave the deepest cold of the outer system. The longest travel distances in the ISL create unique home-advantage effects: visiting teams arrive exhausted, and home sides exploit every atmospheric and psychological edge the void has to offer.$lore$;

UPDATE teams SET description = $lore$Hailing from the closest planet to the sun, Mercury Runners FC is a founding member of the prestigious Rocky Inner League. They represent the unique challenges and adaptations required for life and sport on the small, scorching planet. True to their name, the Runners are renowned throughout the solar system for their blistering pace and relentless energy. This signature speed isn't just tactics; it's an evolutionary advantage honed by generations adapting to Mercury's extreme temperature swings, demanding rapid movement and endurance.

Their home matches are played at the Solar Sprint Stadium, aptly nicknamed "The Heat Box" by visiting teams who often struggle with the intense conditions. The team competes in distinctive muted colors of Burnt Sienna, Dark Slate, and Goldenrod, reflecting the metallic hues and deep shadows of their home world. While major silverware has eluded them so far, the Runners are a consistently competitive side, known for causing upsets with their rapid counter-attacks and pushing opponents to their physical limits. Their ambition burns as brightly as their home star as they strive to translate their unique planetary gifts into championship glory.$lore$
WHERE id = 'mercury-runners' AND description IS DISTINCT FROM $lore$Hailing from the closest planet to the sun, Mercury Runners FC is a founding member of the prestigious Rocky Inner League. They represent the unique challenges and adaptations required for life and sport on the small, scorching planet. True to their name, the Runners are renowned throughout the solar system for their blistering pace and relentless energy. This signature speed isn't just tactics; it's an evolutionary advantage honed by generations adapting to Mercury's extreme temperature swings, demanding rapid movement and endurance.

Their home matches are played at the Solar Sprint Stadium, aptly nicknamed "The Heat Box" by visiting teams who often struggle with the intense conditions. The team competes in distinctive muted colors of Burnt Sienna, Dark Slate, and Goldenrod, reflecting the metallic hues and deep shadows of their home world. While major silverware has eluded them so far, the Runners are a consistently competitive side, known for causing upsets with their rapid counter-attacks and pushing opponents to their physical limits. Their ambition burns as brightly as their home star as they strive to translate their unique planetary gifts into championship glory.$lore$;

UPDATE teams SET description = $lore$Earth United FC is the oldest and most storied club in the Rocky Inner League. Playing at the iconic Blue Marble Arena, they embody the full diversity of human sporting tradition. Their balanced, disciplined approach to the game has produced more league titles than any other Rocky Inner side.$lore$
WHERE id = 'earth-united' AND description IS DISTINCT FROM $lore$Earth United FC is the oldest and most storied club in the Rocky Inner League. Playing at the iconic Blue Marble Arena, they embody the full diversity of human sporting tradition. Their balanced, disciplined approach to the game has produced more league titles than any other Rocky Inner side.$lore$;

UPDATE teams SET description = $lore$Venus Volcanic SC play an intense high-press game that mirrors the volcanic fury of their home world. Few teams can withstand their relentless pressure in the first half.$lore$
WHERE id = 'venus-volcanic' AND description IS DISTINCT FROM $lore$Venus Volcanic SC play an intense high-press game that mirrors the volcanic fury of their home world. Few teams can withstand their relentless pressure in the first half.$lore$;

UPDATE teams SET description = $lore$Terra Nova SC are known across the league for their investment in youth academies and flowing attacking football. Their teams are often the youngest in the league, and among the most exciting.$lore$
WHERE id = 'terra-nova' AND description IS DISTINCT FROM $lore$Terra Nova SC are known across the league for their investment in youth academies and flowing attacking football. Their teams are often the youngest in the league, and among the most exciting.$lore$;

UPDATE teams SET description = $lore$Mars Athletic are renowned as one of the toughest defensive sides in the league. Their low-block system, built on Martian endurance, has frustrated the best attacking teams in the solar system.$lore$
WHERE id = 'mars-athletic' AND description IS DISTINCT FROM $lore$Mars Athletic are renowned as one of the toughest defensive sides in the league. Their low-block system, built on Martian endurance, has frustrated the best attacking teams in the solar system.$lore$;

UPDATE teams SET description = $lore$Playing at the highest-altitude stadium in the league, Olympus Mons FC have developed an unrivalled aerial game. Their set-piece record is the stuff of legend.$lore$
WHERE id = 'olympus-mons' AND description IS DISTINCT FROM $lore$Playing at the highest-altitude stadium in the league, Olympus Mons FC have developed an unrivalled aerial game. Their set-piece record is the stuff of legend.$lore$;

UPDATE teams SET description = $lore$Valles Mariners SC are the thinking person's team in the Rocky Inner League. Their tiki-taka style, adapted from ancient canyon tactics, produces the highest pass-completion rates in the division.$lore$
WHERE id = 'valles-mariners' AND description IS DISTINCT FROM $lore$Valles Mariners SC are the thinking person's team in the Rocky Inner League. Their tiki-taka style, adapted from ancient canyon tactics, produces the highest pass-completion rates in the division.$lore$;

UPDATE teams SET description = $lore$Representing the most populous orbital colony in the inner system, Solar City FC draws on a diverse roster of players from across the solar system. Their eclectic style reflects the cosmopolitan nature of their home.$lore$
WHERE id = 'solar-city' AND description IS DISTINCT FROM $lore$Representing the most populous orbital colony in the inner system, Solar City FC draws on a diverse roster of players from across the solar system. Their eclectic style reflects the cosmopolitan nature of their home.$lore$;

UPDATE teams SET description = $lore$Jupiter Titans FC are the giants of the Gas/Ice Giants League in every sense. Their imposing physicality, reinforced by Jupiter's intense gravity training, makes them the most physically dominant side in the ISL.$lore$
WHERE id = 'jupiter-titans' AND description IS DISTINCT FROM $lore$Jupiter Titans FC are the giants of the Gas/Ice Giants League in every sense. Their imposing physicality, reinforced by Jupiter's intense gravity training, makes them the most physically dominant side in the ISL.$lore$;

UPDATE teams SET description = $lore$Europa Oceanic SC play a fluid, flowing style inspired by the vast subsurface oceans of their moon home. Their intricate passing weaves like water, impossible to contain.$lore$
WHERE id = 'europa-oceanic' AND description IS DISTINCT FROM $lore$Europa Oceanic SC play a fluid, flowing style inspired by the vast subsurface oceans of their moon home. Their intricate passing weaves like water, impossible to contain.$lore$;

UPDATE teams SET description = $lore$Born from the mining communities of Ganymede, United represent working-class values translated into sport. Their relentless work rate across 90 minutes is unmatched in the division.$lore$
WHERE id = 'ganymede-united' AND description IS DISTINCT FROM $lore$Born from the mining communities of Ganymede, United represent working-class values translated into sport. Their relentless work rate across 90 minutes is unmatched in the division.$lore$;

UPDATE teams SET description = $lore$The Wolves hunt in packs. Their coordinated pressing system, developed through the brutal conditions of Callisto's surface, is one of the most tactically sophisticated in the league.$lore$
WHERE id = 'callisto-wolves' AND description IS DISTINCT FROM $lore$The Wolves hunt in packs. Their coordinated pressing system, developed through the brutal conditions of Callisto's surface, is one of the most tactically sophisticated in the league.$lore$;

UPDATE teams SET description = $lore$Saturn Rings FC play the most aesthetically pleasing football in the ISL. Their passing patterns mirror the rings of their home planet: circular, hypnotic, and impossible to break.$lore$
WHERE id = 'saturn-rings' AND description IS DISTINCT FROM $lore$Saturn Rings FC play the most aesthetically pleasing football in the ISL. Their passing patterns mirror the rings of their home planet: circular, hypnotic, and impossible to break.$lore$;

UPDATE teams SET description = $lore$Training in Titan's thick methane atmosphere builds extraordinary lung capacity. Titan Methane SC use this to press relentlessly for the full 90 minutes, exhausting opponents.$lore$
WHERE id = 'titan-methane' AND description IS DISTINCT FROM $lore$Training in Titan's thick methane atmosphere builds extraordinary lung capacity. Titan Methane SC use this to press relentlessly for the full 90 minutes, exhausting opponents.$lore$;

UPDATE teams SET description = $lore$Like the geysers of their icy home, Enceladus Geysers erupt with sudden, devastating counter-attacks. They can absorb pressure for long periods before unleashing explosive offensives.$lore$
WHERE id = 'enceladus-geysers' AND description IS DISTINCT FROM $lore$Like the geysers of their icy home, Enceladus Geysers erupt with sudden, devastating counter-attacks. They can absorb pressure for long periods before unleashing explosive offensives.$lore$;

UPDATE teams SET description = $lore$Playing on a planet tilted at 98 degrees has given the Sidewinders an unconventional perspective on the game. Their unpredictable tactics and lateral movement confuse even the best-prepared opposition.$lore$
WHERE id = 'uranus-sidewinders' AND description IS DISTINCT FROM $lore$Playing on a planet tilted at 98 degrees has given the Sidewinders an unconventional perspective on the game. Their unpredictable tactics and lateral movement confuse even the best-prepared opposition.$lore$;

UPDATE teams SET description = $lore$The Miners represent the grit and determination of the asteroid belt. Their grinding style of play wears down opponents like rock against rock.$lore$
WHERE id = 'ceres-miners' AND description IS DISTINCT FROM $lore$The Miners represent the grit and determination of the asteroid belt. Their grinding style of play wears down opponents like rock against rock.$lore$;

UPDATE teams SET description = $lore$Vesta FC have mastered the art of football in low gravity. Their floating passing game and long-range shooting make them one of the most entertaining sides in the league.$lore$
WHERE id = 'vesta' AND description IS DISTINCT FROM $lore$Vesta FC have mastered the art of football in low gravity. Their floating passing game and long-range shooting make them one of the most entertaining sides in the league.$lore$;

UPDATE teams SET description = $lore$The Wanderers live up to their name. They adapt their system each match, unpredictable and versatile in equal measure.$lore$
WHERE id = 'pallas-wanderers' AND description IS DISTINCT FROM $lore$The Wanderers live up to their name. They adapt their system each match, unpredictable and versatile in equal measure.$lore$;

UPDATE teams SET description = $lore$Playing in the darkest reaches of the asteroid belt, Hygiea United have built a fortress. Their defensive record is the best in the outer reaches.$lore$
WHERE id = 'hygiea-united' AND description IS DISTINCT FROM $lore$Playing in the darkest reaches of the asteroid belt, Hygiea United have built a fortress. Their defensive record is the best in the outer reaches.$lore$;

UPDATE teams SET description = $lore$Playing on a metallic asteroid has given the Metallics an almost supernatural physicality. They are the strongest side in the belt, pound for pound.$lore$
WHERE id = 'psyche-metallics' AND description IS DISTINCT FROM $lore$Playing on a metallic asteroid has given the Metallics an almost supernatural physicality. They are the strongest side in the belt, pound for pound.$lore$;

UPDATE teams SET description = $lore$Juno City FC are the most tactically disciplined club in the outer reaches. Their rigid organisational structure rarely concedes (or entertains) but delivers results.$lore$
WHERE id = 'juno-city' AND description IS DISTINCT FROM $lore$Juno City FC are the most tactically disciplined club in the outer reaches. Their rigid organisational structure rarely concedes (or entertains) but delivers results.$lore$;

UPDATE teams SET description = $lore$Born from the intersection of a dozen asteroid belt trade routes, Beltway FC represent the pragmatic, opportunistic spirit of colony life. Their tactics mirror the belt itself: adaptable, layered, and always looking for the gap. Formed by workers who played football in cargo bays and pressurised corridors, they carry a blue-collar heart into every match.

With the smallest budget in the Outer Reaches League, Beltway punch well above their weight through organised counterattacking and relentless set-piece preparation. The Junction has an atmosphere disproportionate to its size: belt colony fans are loud, passionate, and unafraid of a fight.$lore$
WHERE id = 'beltway' AND description IS DISTINCT FROM $lore$Born from the intersection of a dozen asteroid belt trade routes, Beltway FC represent the pragmatic, opportunistic spirit of colony life. Their tactics mirror the belt itself: adaptable, layered, and always looking for the gap. Formed by workers who played football in cargo bays and pressurised corridors, they carry a blue-collar heart into every match.

With the smallest budget in the Outer Reaches League, Beltway punch well above their weight through organised counterattacking and relentless set-piece preparation. The Junction has an atmosphere disproportionate to its size: belt colony fans are loud, passionate, and unafraid of a fight.$lore$;

UPDATE teams SET description = $lore$Solar Miners FC channel the exhausting, relentless work ethic of asteroid mining operations directly into their football. They drill through defences, press without mercy, and never stop running, even when the match is lost. Originally a recreational side for workers at the Kepler-7 extraction colony, they earned promotion through sheer collective effort.

Physical and direct, Solar Miners rarely produce beautiful football, but they produce results. The Dig is an intimidating venue built partly underground in a decommissioned ore shaft, and visiting teams hate its uneven acoustics and faintly sulfurous atmosphere.$lore$
WHERE id = 'solar-miners' AND description IS DISTINCT FROM $lore$Solar Miners FC channel the exhausting, relentless work ethic of asteroid mining operations directly into their football. They drill through defences, press without mercy, and never stop running, even when the match is lost. Originally a recreational side for workers at the Kepler-7 extraction colony, they earned promotion through sheer collective effort.

Physical and direct, Solar Miners rarely produce beautiful football, but they produce results. The Dig is an intimidating venue built partly underground in a decommissioned ore shaft, and visiting teams hate its uneven acoustics and faintly sulfurous atmosphere.$lore$;

UPDATE teams SET description = $lore$Still mourning their planet's demotion, Pluto Frost channel their righteous anger into football. They are perpetual underdogs with the spirit of former champions.$lore$
WHERE id = 'pluto-frost' AND description IS DISTINCT FROM $lore$Still mourning their planet's demotion, Pluto Frost channel their righteous anger into football. They are perpetual underdogs with the spirit of former champions.$lore$;

UPDATE teams SET description = $lore$Long overshadowed by their larger neighbour Pluto, Charon United are in the process of forging an identity entirely their own. A young club on the rise.$lore$
WHERE id = 'charon-united' AND description IS DISTINCT FROM $lore$Long overshadowed by their larger neighbour Pluto, Charon United are in the process of forging an identity entirely their own. A young club on the rise.$lore$;

UPDATE teams SET description = $lore$Eris Wanderers travel the longest distances for away matches, and it shows in their mental fortitude. No club trains harder between fixtures.$lore$
WHERE id = 'eris-wanderers' AND description IS DISTINCT FROM $lore$Eris Wanderers travel the longest distances for away matches, and it shows in their mental fortitude. No club trains harder between fixtures.$lore$;

UPDATE teams SET description = $lore$Playing on Haumea's egg-shaped surface has given the Spinners an eccentric wide-play style. Their wingers operate at unusual angles that disorient conventional defences.$lore$
WHERE id = 'haumea-spinners' AND description IS DISTINCT FROM $lore$Playing on Haumea's egg-shaped surface has given the Spinners an eccentric wide-play style. Their wingers operate at unusual angles that disorient conventional defences.$lore$;

UPDATE teams SET description = $lore$As their planetary name suggests, Makemake FC are creators. Their attacking play conjures chances from almost nothing: one of the most inventive clubs in the ISL.$lore$
WHERE id = 'makemake' AND description IS DISTINCT FROM $lore$As their planetary name suggests, Makemake FC are creators. Their attacking play conjures chances from almost nothing: one of the most inventive clubs in the ISL.$lore$;

UPDATE teams SET description = $lore$From the darkest corner of the Kuiper Belt, Orcus Athletic are the ultimate dark horse. Their dead-ball specialists have decided more matches than any other set-piece team in the league.$lore$
WHERE id = 'orcus-athletic' AND description IS DISTINCT FROM $lore$From the darkest corner of the Kuiper Belt, Orcus Athletic are the ultimate dark horse. Their dead-ball specialists have decided more matches than any other set-piece team in the league.$lore$;

UPDATE teams SET description = $lore$Sedna FC Mariners play like their home world orbits: with vast, unhurried patience. Sedna's extraordinary 11,400-year elliptical orbit has instilled in its inhabitants a philosophical relationship with time, and their football reflects it. They build slowly, absorb pressure without breaking, and strike only when the moment is certain.

Perihelion Park is among the most remote stadiums in the known solar system, and home advantage here is almost mythological. Visiting teams must travel further than anyone else in the ISL, and they arrive already drained. The Mariners have never beaten a top-four side away from home, but they have never been relegated either.$lore$
WHERE id = 'sedna-mariners' AND description IS DISTINCT FROM $lore$Sedna FC Mariners play like their home world orbits: with vast, unhurried patience. Sedna's extraordinary 11,400-year elliptical orbit has instilled in its inhabitants a philosophical relationship with time, and their football reflects it. They build slowly, absorb pressure without breaking, and strike only when the moment is certain.

Perihelion Park is among the most remote stadiums in the known solar system, and home advantage here is almost mythological. Visiting teams must travel further than anyone else in the ISL, and they arrive already drained. The Mariners have never beaten a top-four side away from home, but they have never been relegated either.$lore$;

UPDATE teams SET description = $lore$Scattered Disc FC Rangers play from the absolute fringe of the solar system, in a region so loosely defined that cartographers argue about whether it technically exists. Their football is similarly hard to classify: chaotic, improvisational, and occasionally brilliant. Tactics arrive by committee, change at half-time, and are abandoned by the 70th minute.

The Void Stadium's sparse attendance and enormous silence create a unique atmosphere: not intimidating so much as deeply unsettling. Opponents describe games there as "playing against the cosmos itself." In forty-four seasons in the Kuiper Belt League (a span everyone else still describes as "a few"), the Rangers have delivered both the highest-scoring victory and the most embarrassing defeat in the division's history.$lore$
WHERE id = 'scattered-disc' AND description IS DISTINCT FROM $lore$Scattered Disc FC Rangers play from the absolute fringe of the solar system, in a region so loosely defined that cartographers argue about whether it technically exists. Their football is similarly hard to classify: chaotic, improvisational, and occasionally brilliant. Tactics arrive by committee, change at half-time, and are abandoned by the 70th minute.

The Void Stadium's sparse attendance and enormous silence create a unique atmosphere: not intimidating so much as deeply unsettling. Opponents describe games there as "playing against the cosmos itself." In forty-four seasons in the Kuiper Belt League (a span everyone else still describes as "a few"), the Rangers have delivered both the highest-scoring victory and the most embarrassing defeat in the division's history.$lore$;
