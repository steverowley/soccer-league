// ISL Web UI Kit — league standings table + section wrapper.

function StandingsTable({ rows }) {
  const cols = [
    { k: "p", label: "P" }, { k: "w", label: "W" }, { k: "d", label: "D" },
    { k: "l", label: "L" }, { k: "gd", label: "GD" },
  ];
  return (
    <div style={{ border: "1px solid var(--isl-border)", padding: "8px 32px" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--isl-font-mono)" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--isl-border-faint)" }}>
            <th style={thStyle(56, "left")}>#</th>
            <th style={thStyle(null, "left")}>Club</th>
            {cols.map((c) => <th key={c.k} style={thStyle(64, "right")}>{c.label}</th>)}
            <th style={{ ...thStyle(null, "right"), paddingRight: 8 }}>Form</th>
            <th style={thStyle(64, "right")}>Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const rel = r.rank >= 7;
            const cup = r.rank <= 2;
            return (
              <tr key={i} style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--isl-border-faint)" : "none" }}>
                <td style={{ ...tdStyle("left"), color: rel ? "var(--isl-solar-flare)" : cup ? "var(--isl-terra-nova)" : "var(--isl-fg)" }}>| {String(r.rank).padStart(2, "0")}</td>
                <td style={tdStyle("left")}>{r.club}</td>
                <td style={tdStyle("right")}>{r.p}</td>
                <td style={tdStyle("right")}>{r.w}</td>
                <td style={tdStyle("right")}>{r.d}</td>
                <td style={tdStyle("right")}>{r.l}</td>
                <td style={tdStyle("right")}>{r.gd > 0 ? "+" + r.gd : r.gd < 0 ? "−" + Math.abs(r.gd) : "0"}</td>
                <td style={{ ...tdStyle("right"), paddingRight: 8 }}><span style={{ display: "inline-flex", gap: 4, justifyContent: "flex-end" }}><FormStrip results={r.form} /></span></td>
                <td style={tdStyle("right")}>{r.pts}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function thStyle(w, align) {
  return { width: w || undefined, textAlign: align, fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: ".03em", color: "var(--isl-fg)", padding: "16px 8px" };
}
function tdStyle(align) {
  return { textAlign: align, fontWeight: 700, fontSize: 15, color: "var(--isl-fg)", padding: "13px 8px", whiteSpace: "nowrap" };
}

// Full league section: eyebrow + title + desc + (button) + table.
function LeagueSection({ index, title, desc, rows, onBrowse, buttonLabel = "View all leagues", buttonVariant = "tertiary" }) {
  return (
    <section style={{ maxWidth: 1520, margin: "0 auto", width: "100%" }}>
      <div style={{ marginBottom: 24 }}><Eyebrow index={index}>Standings across the abyss</Eyebrow></div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 32, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 720 }}>
          <h2 style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 40, margin: "0 0 12px", textTransform: "uppercase", color: "var(--isl-fg)" }}>{title}</h2>
          <p style={{ fontFamily: "var(--isl-font-mono)", fontSize: 16, lineHeight: 1.5, margin: 0, color: "var(--isl-fg)" }}>{desc}</p>
        </div>
        {buttonVariant === "tertiary"
          ? <TertiaryLink onClick={onBrowse}>{buttonLabel}</TertiaryLink>
          : <Button variant="secondary" onClick={onBrowse}>{buttonLabel}</Button>}
      </div>
      <Divider style={{ margin: "24px 0 40px" }} />
      <StandingsTable rows={rows} />
    </section>
  );
}

Object.assign(window, { StandingsTable, LeagueSection });
