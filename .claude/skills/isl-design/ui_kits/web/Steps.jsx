// ISL Web UI Kit — "Three steps to enter" onboarding section.

const ISL_STEPS = [
  { n: "01", title: "Sign on", body: "One credential pair. Your handle persists across every season cycle and survives all but a complete heat-death.", img: "img-spacewalk.png" },
  { n: "02", title: "Pick a club", body: "Affiliation is permanent. The club may transfer leagues, dissolve, or be erased from the record — but you cannot leave.", img: "img-earth-united-flag.png" },
  { n: "03", title: "Watch & bet", body: "Stake Intergalactic Credits on outcomes, prop lines, or whether the Architect will manifest before the eightieth minute.", img: "img-moon-broadcast.png" },
];

function StepCard({ n, title, body, img }) {
  return (
    <div style={{ border: "1px solid var(--isl-border)", padding: 32, display: "flex", flexDirection: "column", gap: 32, minHeight: 420 }}>
      <span style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 32, color: "var(--isl-fg)" }}>{n}</span>
      <div style={{ flex: 1, minHeight: 180, background: `url(../../assets/${img}) center / cover no-repeat`, border: "1px solid var(--isl-border-faint)" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h3 style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 32, margin: 0, textTransform: "uppercase", color: "var(--isl-fg)" }}>{title}</h3>
        <p style={{ fontFamily: "var(--isl-font-mono)", fontSize: 16, lineHeight: 1.5, margin: 0, color: "var(--isl-fg)" }}>{body}</p>
      </div>
    </div>
  );
}

function Steps({ onCreate }) {
  return (
    <section style={{ maxWidth: 1520, margin: "0 auto", width: "100%" }}>
      <div style={{ marginBottom: 24 }}><Eyebrow index="II">Get started</Eyebrow></div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 32, flexWrap: "wrap" }}>
        <h2 style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 40, margin: 0, textTransform: "uppercase", color: "var(--isl-fg)" }}>Three steps to enter</h2>
        <TertiaryLink onClick={onCreate}>Create account</TertiaryLink>
      </div>
      <p style={{ fontFamily: "var(--isl-font-mono)", fontSize: 16, margin: "0 0 24px", color: "var(--isl-fg)" }}>Creating an account is easy. Escaping the league? Not so much.</p>
      <Divider style={{ marginBottom: 40 }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>
        {ISL_STEPS.map((s) => <StepCard key={s.n} {...s} />)}
      </div>
    </section>
  );
}

Object.assign(window, { Steps });
