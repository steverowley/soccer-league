// ISL Web UI Kit — top navigation. Three auth states: "new" | "out" | "in".
const ISL_NAV_LINKS = ["Home", "Leagues", "Teams", "Matches", "World", "Galaxy Dispatch", "Idols", "Voting"];
// Surfaces that exist as real pages at the project root — navigate out of the SPA.
const ISL_EXTERNAL_PAGES = { Teams: "../../Teams.html", Matches: "../../Matches.html", World: "../../World.html", "Galaxy Dispatch": "../../Dispatch.html", Idols: "../../Idols.html", Voting: "../../Voting.html" };

function Nav({ page, auth, balance, onNavigate, onAuth }) {
  return (
    <nav style={{
      display: "flex", alignItems: "flex-start", gap: 32,
      padding: "32px 0", maxWidth: 1520, margin: "0 auto", width: "100%", boxSizing: "border-box",
    }}>
      <a onClick={() => onNavigate("Home")} style={{ cursor: "pointer", flex: "none" }}>
        <Logo height={132} />
      </a>
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 36 }}>
        {ISL_NAV_LINKS.map((l) => {
          const active = l === page;
          const ext = ISL_EXTERNAL_PAGES[l];
          return (
            <a key={l} href={ext} onClick={ext ? undefined : () => onNavigate(l)} style={{
              cursor: "pointer", fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 16,
              textTransform: "uppercase", color: "var(--isl-fg)", whiteSpace: "nowrap",
              textShadow: active ? "0 0 12px rgba(227,224,213,0.95), 0 0 4px rgba(227,224,213,0.8)" : "none",
              transition: "text-shadow .12s linear",
            }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.textShadow = "0 0 10px rgba(227,224,213,0.6)"; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.textShadow = "none"; }}>
              {l}
            </a>
          );
        })}
      </div>
      <div style={{ flex: "none", marginLeft: 16, marginTop: 24 }}>
        {auth === "new" && <Button variant="cta" onClick={() => onAuth("in")}>Create account</Button>}
        {auth === "out" && <Button variant="cta" onClick={() => onAuth("in")}>Log in</Button>}
        {auth === "in" && (
          <div style={{
            display: "flex", alignItems: "center", gap: 16, border: "1px solid var(--isl-white)",
            padding: "16px 32px", fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 16,
          }}>
            <span style={{ color: "var(--isl-fg)" }}>USER</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--isl-fg)" }}>BALANCE</span>
              <span style={{ color: "var(--isl-astro-explorer)", textShadow: "0 0 6px rgba(255,102,55,0.7)" }}>{balance} ic</span>
            </span>
          </div>
        )}
      </div>
    </nav>
  );
}

Object.assign(window, { Nav });
