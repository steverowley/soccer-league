# Intergalactic Soccer League — Project Context

## Vision

A social experiment browser game inspired by Blaseball. Users watch AI-simulated soccer matches, bet on outcomes using Intergalactic Credits, and at the end of each season collectively vote with their winnings to shape their club's future. Hidden mechanics, emergent storylines, and fan-driven narratives are core to the experience.

---

## Game Design Document

### Goal
Create a soccer simulation browser game inspired by Blaseball — a social experiment with many hidden and unexplained mechanics.

### Player Interaction
- **Betting**: Bet tokens on match outcomes; odds are generated from team skill and probability.
- **Voting**: At season's end, fans pool credits to vote on club decisions (signing players, training, upgrades).
- **Fan Support**: Teams with more fans logged in during a match receive a small stat boost.
- **Training Minigame**: Visit the training facility between matches; a clicker minigame helps boost individual players.

### User Account
- Username
- Favourite team and player
- Start with **200 Intergalactic Credits**
- Logging in during a match slightly boosts the supported team's performance

### Betting Rules
- Minimum bet: 10 Intergalactic Credits, no maximum
- Realistic odds generated per match based on team stats
- Win/loss determined by match result; winnings paid out accordingly

### Voting (End of Season)
- Fans spend credits on "focuses" for their team
- The focus with the most credits across all fans of a team is enacted
- **2 focuses per season**: 1 major, 1 minor
- Focus options: Sign new players, Promote youth players, Player boosts, Preseason training investments, Stadium upgrades

### Fan Support Boost
- Each match: compare logged-in fans for both teams
- The team with more logged-in fans receives a small % stat boost for that match

---

## Leagues (4 conferences × 8 teams = 32 teams)

### Rocky Inner League
| Club | Location |
|------|----------|
| Mercury Runners FC | Mercury |
| Venus Volcanic SC | Venus |
| Earth United FC | Earth |
| Terra Nova SC | Earth |
| Mars Athletic | Mars |
| Olympus Mons FC | Mars |
| Valles Mariners SC | Mars |
| Solar City FC | Earth Orbital Colony |

### Gas/Ice Giant League
| Club | Location |
|------|----------|
| Jupiter Royals FC | Jupiter |
| Great Red FC | Jupiter |
| Saturn Rings United | Saturn |
| Cassini Explorers FC | Saturn |
| Uranus Athletic Club | Uranus |
| Neptune FC Mariners | Neptune |
| Galilean Giants FC | Jupiter region |
| Saturn Orbital SC | Saturn orbital colony |

### Asteroid Belt League
| Club | Location |
|------|----------|
| Ceres City FC | Ceres |
| Vesta United | Vesta |
| Pallas SC | Pallas |
| Hygiea Rangers | Hygiea |
| Beltway FC | Asteroid Belt colony |
| Solar Miners FC | Asteroid Belt colony |
| Juno Athletic | Juno |
| Pallas Rovers FC | Pallas |

### Kuiper Belt League
| Club | Location |
|------|----------|
| Pluto FC Wanderers | Pluto |
| Eris FC Rebels | Eris |
| Haumea SC Cyclones | Haumea |
| Makemake United | Makemake |
| Sedna FC Mariners | Sedna |
| Plutino FC Pirates | Plutino Region |
| Orcus FC Shadows | Orcus |
| Scattered Disc FC Rangers | Outer Kuiper Belt |

---

## Tournament Structure

### League
- Win = 3 pts, Draw = 1 pt, Loss = 0 pts
- Tiebreaker: goal difference → goals scored
- Each team plays every other team twice (home and away)

### Celestial Cup (Champions League equivalent)
- Top 3 teams per league qualify
- Random draw single-elimination tournament

### Solar Shield (Europa League equivalent)
- Teams ranked 4th–6th per league qualify
- Random draw single-elimination tournament

---

## Match Rules
- Standard 11-a-side football
- Two 45-minute halves + stoppage time
- Yellow and red cards
- 11 players per team (1 GK) + 5 substitutes; 3 substitutions allowed
- VAR enforcement

---

## Team Structure

Each club has:
- Name, Location, Home Ground (name, capacity, nickname)
- Training Facility (name, nickname, quality)
- History/Lore (league & cup history, notable events)
- Manager (name, age, race, nationality, tactical preferences)

### Manager
- **Formations**: 4-4-2, 3-4-3, 4-5-1, 5-4-1 (expandable)
- **Play Styles**: Offensive, Balanced, Defensive, Direct, Possession, Counterattacking, High Pressing, Aggressive
- **Coaching Stats**: Attacking, Defending, Technical, Athletic, Mental

### Squad
- 22–25 players per club
- **Player Details**: Name, Age (16+), Height, Weight, Appearance, Race, Historical achievements, Seasonal stats, Injury status, Form
- **Player Stats**: Shooting, Assisting, Tackling, Blocking, Goalkeeping, Passing, Dribbling, Speed, Stamina, Strength, Positioning, Aggression, Vision
- **Potential**: Godly / High / Medium / Low; Early / Balanced / Late Developer; Superstar flag

---

## Current Implementation Status

### Already Built
- Match simulator (90-min, procedural events, momentum, chaos)
- AI commentary via Claude (3 commentator voices + Cosmic Architect)
- 15 teams across 4 leagues (needs expanding to 32)
- League standings, team/player profile pages
- Supabase backend (matches, players, stats, leagues, teams)
- Manager tactics AI, player psychology system
- Planetary weather system
- Match result persistence

### Planned / Not Yet Built
- User authentication (Supabase Auth)
- User accounts (username, team allegiance, 200 starting credits)
- Betting system (odds generation, wager placement, payout)
- Fan support boost (logged-in fans affect match stats)
- End-of-season voting (collective focus decisions)
- Training facility minigame
- Full 32-team expansion (currently 15 teams)
- Full player squads per team (currently partial)
- Celestial Cup & Solar Shield tournament bracket logic
- Hidden/unexplained Blaseball-style mechanics
