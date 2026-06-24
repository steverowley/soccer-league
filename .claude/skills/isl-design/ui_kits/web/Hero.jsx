// ISL Web UI Kit — homepage hero. Image left, content right.

function MetaChips({ items }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: "var(--isl-fg)" }}>•</span>}
          <span style={{
            fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 16, textTransform: "uppercase",
            letterSpacing: ".03em", color: it.live ? "var(--isl-solar-flare)" : "var(--isl-fg)",
            display: "inline-flex", alignItems: "center", gap: 8,
          }}>
            {it.live && <StatusDot />}{it.label}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

function StatBlock({ label, value }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--isl-fg)" }}>{label}</span>
      <span style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 16, color: "var(--isl-fg)" }}>{value}</span>
    </div>
  );
}

function Hero({ onPrimary, onSecondary }) {
  return (
    <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "stretch", maxWidth: 1520, margin: "0 auto", width: "100%" }}>
      <div style={{ minHeight: 620, background: "url(../../assets/img-spacewalk.png) center / cover no-repeat", border: "1px solid var(--isl-border-faint)" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 32, justifyContent: "center" }}>
        <MetaChips items={[{ label: "Season VII" }, { label: "Matchday XIV" }, { label: "Live Now", live: true }]} />
        <Divider />
        <h1 style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 40, lineHeight: 1.1, margin: 0, textTransform: "uppercase", color: "var(--isl-fg)" }}>
          Soccer, charted across<br />the stars
        </h1>
        <div style={{ display: "flex", gap: 16, fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 16, textTransform: "uppercase", color: "var(--isl-fg)", flexWrap: "wrap" }}>
          <span>RA 14ʰ 04ᵐ 12ˢ</span><span style={{ color: "var(--isl-fg)" }}>•</span>
          <span>EPOCH MMXXXVII</span><span style={{ color: "var(--isl-fg)" }}>•</span>
          <span>DEC −27° 19′</span>
        </div>
        <p style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 400, fontSize: 16, lineHeight: 1.6, margin: 0, color: "var(--isl-fg)", maxWidth: 560 }}>
          Thirty-two clubs across four orbital leagues. Five-hundred-twelve souls. One Cosmic Architect rewriting the rules between heartbeats. Place your stake, vote on your club's future, and watch the void stare back.
        </p>
        <div style={{ display: "flex", gap: 32 }}>
          <Button variant="secondary" onClick={onPrimary}>Browse leagues</Button>
          <Button variant="primary" onClick={onSecondary}>Watch live match</Button>
        </div>
        <Divider />
        <div style={{ display: "flex", gap: 64 }}>
          <StatBlock label="Active matches" value="01 / 16" />
          <StatBlock label="Season cycle" value="014 / 030" />
          <StatBlock label="Architect" value="Elevated" />
          <StatBlock label="Build" value="v0.7.0" />
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { Hero, MetaChips, StatBlock });
