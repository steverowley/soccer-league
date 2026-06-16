// ISL Web UI Kit — live game section.
// Layout follows the source design (Frame 21): full-width match card with real
// crests, uppercase team names, commentary blocks with a left accent rule, and a
// "Watch live match" button. A secondary row keeps betting + upcoming fixtures.

const ISL_COMMENTARY = [
  { name: "Zara Bloom", role: "Colour Analyst", min: "73'", text: "There it is — Mercer's been reading Mars' final-third patterns all second half, and it shows. That's the interception that wins a draw when your striker's gone haywire." },
  { name: "Nexus-7", role: "AI Analyst", min: "70'", text: "Manager One's final-minute directive at 90 minutes reaches 92.1 decibels with maximum urgency encoding, saturating Saturn Rings' auditory processing capacity as expected goal probability compresses toward binary outcomes. Both biological commanders now operate at peak vocalization intensity — a futile yet deeply human attempt to impose deterministic will upon match mathematics that have already calculated 47.3% draw." },
];

const ISL_FIXTURES = [
  { home: "Jovian Storm", away: "Ringed Saturn", league: "Gas Giant League", day: "Tue", time: "19:00" },
  { home: "Neptune Drift", away: "Uranus Tilt", league: "Gas Giant League", day: "Tue", time: "21:30" },
  { home: "Eris Heretics", away: "Plutonian Exiles", league: "Trans-Nep. League", day: "Wed", time: "20:00" },
];

const ISL_ODDS = [
  { key: "EU", label: "Earth United", odds: "1.85" },
  { key: "X", label: "Draw", odds: "3.40" },
  { key: "MR", label: "Mars Rovers", odds: "2.10" },
];

// "● LIVE · 73'" — neutral box, neutral text, the only colour is the red dot.
function LiveIndicator({ minute = "73'" }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 12, border: "1px solid var(--isl-border)", padding: "10px 16px" }}>
      <StatusDot />
      <span style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 16, textTransform: "uppercase", color: "var(--isl-fg)" }}>LIVE · {minute}</span>
    </span>
  );
}

function MetaPair({ items }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 12, fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 16, textTransform: "uppercase", color: "var(--isl-fg)" }}>
      {items.map((t, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span>•</span>}
          <span>{t}</span>
        </React.Fragment>
      ))}
    </span>
  );
}

function TeamColumn({ crest, accent, name, side, body }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, width: 240 }}>
      <Crest img={crest} monogram={name.split(" ").map((w) => w[0]).join("").slice(0, 2)} accent={accent} size={120} alt={name} />
      <span style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 28, textTransform: "uppercase", color: "var(--isl-fg)", textAlign: "center" }}>{name}</span>
      <MetaPair items={[side, body]} />
    </div>
  );
}

// Commentary block with a left accent rule (source design).
function CommentaryLine({ name, role, min, text }) {
  return (
    <div style={{ borderLeft: "2px solid var(--isl-border-faint)", paddingLeft: 24, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}>
        <span style={{ display: "flex", gap: 12, alignItems: "center", fontFamily: "var(--isl-font-mono)", fontSize: 16, color: "var(--isl-fg)" }}>
          <span style={{ fontWeight: 700 }}>{name}</span><span>•</span><span>{role}</span>
        </span>
        <span style={{ fontFamily: "var(--isl-font-mono)", fontSize: 16, color: "var(--isl-fg)" }}>{min}</span>
      </div>
      <p style={{ fontFamily: "var(--isl-font-mono)", fontStyle: "italic", fontSize: 16, lineHeight: 1.5, margin: 0, color: "var(--isl-fg)" }}>"{text}"</p>
    </div>
  );
}

// The featured live match card — faithful to the source.
function MatchCard({ onWatch }) {
  return (
    <div style={{ border: "1px solid var(--isl-border)", padding: 32, display: "flex", flexDirection: "column", gap: 32 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        <MetaPair items={["Rocky Inner", "Matchday 14"]} />
        <LiveIndicator />
      </div>
      <Divider color="var(--isl-border-faint)" />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 40, padding: "8px 0" }}>
        <TeamColumn crest="crest-earth-united.png" name="Earth United" side="Home" body="Earth" />
        <span style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 56, color: "var(--isl-fg)", paddingTop: 36 }}>2 · 1</span>
        <TeamColumn crest="crest-mars-rovers.png" name="Mars Rovers" side="Away" body="Mars" />
      </div>
      <Divider color="var(--isl-border-faint)" />
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {ISL_COMMENTARY.map((c, i) => <CommentaryLine key={i} {...c} />)}
      </div>
      <Button variant="primary" onClick={() => { window.location.href = "../../Match.html"; }} style={{ alignSelf: "flex-start" }}>Watch live match</Button>
    </div>
  );
}

function StakeRow({ onStake }) {
  const [pick, setPick] = React.useState(null);
  const [amount, setAmount] = React.useState(25);
  return (
    <div style={{ border: "1px solid var(--isl-border)", padding: 32, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 16, textTransform: "uppercase", color: "var(--isl-fg)" }}>Match result</span>
        <span style={{ fontFamily: "var(--isl-font-mono)", fontSize: 12, textTransform: "uppercase", color: "var(--isl-fg)" }}>Prop line · open</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {ISL_ODDS.map((o) => {
          const sel = pick === o.key;
          return (
            <button key={o.key} onClick={() => setPick(o.key)} style={{
              display: "flex", flexDirection: "column", gap: 6, alignItems: "center", padding: "12px 8px", cursor: "pointer",
              border: `1px solid ${sel ? "var(--isl-astro-explorer)" : "var(--isl-border)"}`,
              background: sel ? "var(--isl-phobos-ash)" : "var(--isl-galactic-abyss)",
              boxShadow: sel ? "0 0 14px 1px rgba(255,102,55,0.5)" : "none", transition: "all .12s linear",
            }}>
              <span style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 13, textTransform: "uppercase", color: "var(--isl-fg)" }}>{o.label}</span>
              <span style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 20, color: sel ? "var(--isl-astro-explorer)" : "var(--isl-fg)" }}>{o.odds}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", border: "1px solid var(--isl-border)", padding: "0 16px", gap: 10 }}>
          <input type="range" min="5" max="200" step="5" value={amount} onChange={(e) => setAmount(+e.target.value)}
            style={{ flex: 1, accentColor: "var(--isl-astro-explorer)" }} />
          <span style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 16, color: "var(--isl-astro-explorer)", minWidth: 70, textAlign: "right" }}>{amount} ic</span>
        </div>
        <Button variant="cta" onClick={() => onStake && onStake(amount, pick)} style={{ opacity: pick ? 1 : .4, pointerEvents: pick ? "auto" : "none" }}>
          Place stake
        </Button>
      </div>
    </div>
  );
}

function FixtureRow({ f }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "18px 0", borderBottom: "1px solid var(--isl-border-faint)" }}>
      <span style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 16, color: "var(--isl-fg)" }}>{f.home} <span>v</span> {f.away}</span>
      <span style={{ fontFamily: "var(--isl-font-mono)", fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--isl-fg)" }}>{f.league}</span>
      <div style={{ display: "flex", gap: 12, alignItems: "center", fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 16, color: "var(--isl-fg)" }}>
        <span style={{ textTransform: "uppercase" }}>{f.day}</span><span>•</span><span>{f.time}</span>
      </div>
    </div>
  );
}

function LiveMatch({ onStake, onBrowse, onWatch }) {
  return (
    <section style={{ maxWidth: 1520, margin: "0 auto", width: "100%" }}>
      <div style={{ marginBottom: 24 }}><Eyebrow index="I">The present</Eyebrow></div>
      <h2 style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 40, margin: "0 0 8px", textTransform: "uppercase", color: "var(--isl-fg)" }}>Live from the void</h2>
      <p style={{ fontFamily: "var(--isl-font-mono)", fontSize: 16, lineHeight: 1.5, margin: "0 0 32px", color: "var(--isl-fg)", maxWidth: 640 }}>
        Matches in progress. Position updates every ninety seconds. Architect interference reflected in real time.
      </p>
      <MatchCard onWatch={onWatch || onBrowse} />
      {/* Secondary row — bet on the match + what's next */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24, marginTop: 24 }}>
        <StakeRow onStake={onStake} />
        <aside style={{ border: "1px solid var(--isl-border)", padding: 32, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 16, textTransform: "uppercase", color: "var(--isl-fg)" }}>Upcoming fixtures</span>
            <span style={{ fontFamily: "var(--isl-font-mono)", fontSize: 12, textTransform: "uppercase", color: "var(--isl-fg)" }}>Next 48h</span>
          </div>
          <div style={{ flex: 1 }}>
            {ISL_FIXTURES.map((f, i) => <FixtureRow key={i} f={f} />)}
          </div>
          <Button variant="secondary" onClick={onBrowse} style={{ marginTop: 24, width: "100%" }}>Browse matches</Button>
        </aside>
      </div>
    </section>
  );
}

Object.assign(window, { LiveMatch });
