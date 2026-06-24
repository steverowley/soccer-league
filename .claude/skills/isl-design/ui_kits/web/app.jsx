// ISL Web UI Kit — interactive app shell.
const { useState, useCallback } = React;

function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)", zIndex: 100,
      border: "1px solid var(--isl-astro-explorer)", background: "var(--isl-phobos-ash)",
      boxShadow: "0 0 14px 1px rgba(255,102,55,0.45)", padding: "16px 24px",
      fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 16, color: "var(--isl-fg)",
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <StatusDot color="var(--isl-astro-explorer)" />{msg}
    </div>
  );
}

function HomePage({ auth, onNavigate, onCreate, onStake }) {
  return (
    <React.Fragment>
      <Hero onPrimary={() => onNavigate("Leagues")} onSecondary={() => onNavigate("Matches")} />
      <LiveMatch onStake={onStake} onWatch={() => { window.location.href = "../../Match.html"; }} onBrowse={() => { window.location.href = "../../Matches.html"; }} />
      {auth !== "in" && <Steps onCreate={onCreate} />}
      <LeagueSection {...ISL_LEAGUES[0]} title="The standings"
        desc="Top of the table after fourteen matchdays. Form column shows the last five results."
        onBrowse={() => onNavigate("Leagues")} buttonLabel="View all leagues" buttonVariant="tertiary" />
    </React.Fragment>
  );
}

function LeaguesPage({ onNavigate }) {
  return (
    <React.Fragment>
      {ISL_LEAGUES.map((lg) => (
        <LeagueSection key={lg.index} {...lg}
          onBrowse={() => onNavigate("Home")} buttonLabel="Browse league" buttonVariant="secondary" />
      ))}
    </React.Fragment>
  );
}

function PlaceholderPage({ name }) {
  return (
    <section style={{ maxWidth: 1520, margin: "0 auto", width: "100%", border: "1px solid var(--isl-border)", padding: 64, textAlign: "center" }}>
      <Eyebrow>Not yet charted</Eyebrow>
      <h2 style={{ fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 40, margin: "24px 0 12px", textTransform: "uppercase", color: "var(--isl-fg)" }}>{name}</h2>
      <p style={{ fontFamily: "var(--isl-font-mono)", fontSize: 16, color: "var(--isl-fg)", margin: 0 }}>
        This surface is not in the design source. Left intentionally blank.
      </p>
    </section>
  );
}

function App() {
  const initialPage = decodeURIComponent((window.location.hash || "").slice(1)) || "Home";
  const [page, setPage] = useState(initialPage);
  const [auth, setAuth] = useState("new");
  const [balance, setBalance] = useState(200);
  const [toast, setToast] = useState(null);

  const flash = useCallback((msg) => {
    setToast(msg);
    window.clearTimeout(flash._t);
    flash._t = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const onAuth = useCallback(() => { setAuth("in"); flash("Account created — handle persists across every season cycle."); }, [flash]);
  const onStake = useCallback((amount, pick) => {
    if (auth !== "in") { setAuth("in"); }
    setBalance((b) => Math.max(0, b - amount));
    const team = pick === "EU" ? "Earth United" : pick === "MR" ? "Mars Rovers" : "the draw";
    flash(`Staked ${amount} ic on ${team}. Outcomes are permanent.`);
  }, [auth, flash]);

  const onNavigate = useCallback((p) => { setPage(p); window.scrollTo({ top: 0 }); }, []);

  const known = { Home: true, Leagues: true };
  return (
    <div style={{ minHeight: "100vh", background: "var(--isl-bg)", padding: "0 200px" }}>
      <Nav page={page} auth={auth} balance={balance} onNavigate={onNavigate} onAuth={onAuth} />
      <main style={{ display: "flex", flexDirection: "column", gap: 96, paddingTop: 32, paddingBottom: 64 }}>
        {page === "Home" && <HomePage auth={auth} onNavigate={onNavigate} onCreate={onAuth} onStake={onStake} />}
        {page === "Leagues" && <LeaguesPage onNavigate={onNavigate} />}
        {!known[page] && <PlaceholderPage name={page} />}
      </main>
      <Footer />
      <Toast msg={toast} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
