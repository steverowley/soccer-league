// ISL Web UI Kit — site footer.
function Footer() {
  const items = ["© 2026 Intergalactic Soccer League", "v 0.7.0", "EST. SOLAR CYCLE 2401", "EPOCH MMXXXVII"];
  return (
    <footer style={{ maxWidth: 1520, margin: "0 auto", width: "100%", padding: "32px 0 64px" }}>
      <Divider color="var(--isl-white)" />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, flexWrap: "wrap", paddingTop: 32 }}>
        <Logo height={40} />
        {items.map((t, i) => (
          <React.Fragment key={i}>
            <span style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 16, color: "var(--isl-fg)" }}>{t}</span>
            {i < items.length - 1 && <span style={{ color: "var(--isl-fg)", margin: "0 8px" }}>•</span>}
          </React.Fragment>
        ))}
      </div>
    </footer>
  );
}
Object.assign(window, { Footer });
