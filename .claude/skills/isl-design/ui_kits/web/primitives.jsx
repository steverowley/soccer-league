// ISL Web UI Kit — shared primitives
// Logo, Button, Arrow, Eyebrow, Divider, FormStrip, Crest, StatusDot
// Exported to window for use by other Babel scripts.

const ISL_SHIELD_PATH = "M60.952 0.05C43.085 1.013 28.465 4.302 15.172 10.348C10.024 12.69 4.597 15.964 1.96 18.319C-0.237 20.281 -0.041 15.749 0.048 62.389C0.124 102.755 0.134 103.5 0.596 106.664C2.856 122.134 7.937 133.542 17.843 145.391C20.215 148.228 27.531 155.437 30.688 158.049C39.111 165.015 51.47 172.757 63.506 178.608C66.299 179.965 66.451 180.012 68.084 179.999L69.773 179.985L74.556 177.601C86.575 171.61 95.872 165.799 104.722 158.745C108.294 155.898 116.024 148.201 118.914 144.614C128.417 132.818 133.114 122.084 135.471 106.775C135.811 104.567 135.854 100.355 135.923 62.61L136 20.887L135.356 19.878C133.913 17.616 126.167 12.758 119.014 9.627C107.419 4.553 95.218 1.688 79.487 0.347C76.703 0.11 63.706 -0.099 60.952 0.05ZM77.589 5.133C87.496 5.875 94.804 7.057 103.063 9.253C113.263 11.965 123.485 16.514 129.499 21.018L131.296 22.364L131.294 60.02C131.293 82.578 131.202 99.143 131.068 101.334C130.145 116.419 125.26 128.987 115.67 140.953C112.511 144.894 105.232 152.064 100.903 155.499C95.085 160.116 89.013 164.204 81.944 168.264C78.083 170.481 68.617 175.241 68.067 175.241C67.263 175.241 58.096 170.479 51.908 166.847C48.378 164.774 42.071 160.636 39.076 158.426C30.423 152.041 21.476 143.004 16.469 135.588C10.214 126.326 6.239 115.34 5.131 104.255C4.983 102.774 4.901 87.757 4.901 62.032L4.901 22.107L6.683 20.794C15.715 14.139 30.516 8.755 46.325 6.374C56.089 4.904 68.138 4.425 77.589 5.133Z";

function Logo({ height = 48, color = "var(--isl-fg)", variant = "full", style }) {
  if (variant === "full") {
    return (
      <img src="../../assets/isl-logo-full.png" alt="ISL"
        style={{ height, width: "auto", display: "block", ...style }} />
    );
  }
  return (
    <svg viewBox="0 0 136 180" width={height * 136 / 180} height={height}
      style={{ display: "block", color, ...style }} aria-label="ISL">
      <path d={ISL_SHIELD_PATH} fill="currentColor" />
    </svg>
  );
}

function Arrow({ size = 12, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={{ display: "block", flex: "none" }}>
      <path d="M0 0 L9 5.196 L0 10.392 Z" fill={color} />
    </svg>
  );
}

const islBtnBase = {
  fontFamily: "var(--isl-font-mono)",
  fontWeight: 700,
  fontSize: 16,
  lineHeight: 1,
  textTransform: "uppercase",
  padding: "16px 32px",
  border: "1px solid transparent",
  cursor: "pointer",
  transition: "background .12s linear, color .12s linear, box-shadow .12s linear",
  whiteSpace: "nowrap",
};

function Button({ variant = "secondary", children, onClick, style }) {
  const [hover, setHover] = React.useState(false);
  const variants = {
    primary: hover
      ? { background: "var(--isl-lunar-dust)", color: "var(--isl-galactic-abyss)", borderColor: "var(--isl-lunar-dust)", boxShadow: "var(--isl-glow-light)" }
      : { background: "var(--isl-lunar-dust)", color: "var(--isl-galactic-abyss)", borderColor: "var(--isl-lunar-dust)" },
    secondary: hover
      ? { background: "var(--isl-galactic-abyss)", color: "var(--isl-lunar-dust)", borderColor: "var(--isl-lunar-dust)", boxShadow: "var(--isl-glow-light)" }
      : { background: "var(--isl-galactic-abyss)", color: "var(--isl-lunar-dust)", borderColor: "var(--isl-lunar-dust)" },
    cta: { background: "var(--isl-astro-explorer)", color: "var(--isl-galactic-abyss)", borderColor: "var(--isl-astro-explorer)", boxShadow: hover ? "var(--isl-glow-cta)" : "none" },
    architect: { background: "var(--isl-quantum-purple)", color: "var(--isl-galactic-abyss)", borderColor: "var(--isl-quantum-purple)", boxShadow: hover ? "0 0 18px 2px rgba(154,92,244,0.7)" : "none" },
  };
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ ...islBtnBase, ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

function TertiaryLink({ children, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: 0,
        color: "var(--isl-lunar-dust)", padding: hover ? "2px 4px" : 0, font: "inherit",
        fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 16, textTransform: "uppercase",
        cursor: "pointer", boxShadow: hover ? "var(--isl-glow-light)" : "none", transition: "box-shadow .12s linear",
      }}>
      {children}<Arrow />
    </button>
  );
}

// "I  •  STANDINGS ACROSS THE ABYSS"
function Eyebrow({ index, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 16, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--isl-fg)" }}>
      {index && <span>{index}</span>}
      <span>•</span>
      <span>{children}</span>
    </div>
  );
}

function Divider({ color = "var(--isl-border)", thickness = 1, style }) {
  return <div style={{ height: 0, borderTop: `${thickness}px solid ${color}`, width: "100%", ...style }} />;
}

// W/D/L form strip
function FormStrip({ results = [] }) {
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {results.map((r, i) => (
        <span key={i} style={{
          width: 24, height: 24, display: "grid", placeItems: "center",
          fontFamily: "var(--isl-font-mono)", fontWeight: 700, fontSize: 12,
          border: `1px solid ${r === "L" ? "var(--isl-solar-flare)" : r === "D" ? "rgba(227,224,213,0.45)" : "var(--isl-border)"}`,
          color: r === "W" ? "var(--isl-fg)" : r === "D" ? "rgba(227,224,213,0.82)" : "var(--isl-solar-flare)",
        }}>{r}</span>
      ))}
    </span>
  );
}

// Team crest. Pass `img` for real crest art (transparent PNG); falls back to a
// monogram circle when art isn't available.
function Crest({ monogram, img, alt, size = 80, accent = "var(--isl-lunar-dust)" }) {
  if (img) {
    return (
      <img src={`../../assets/${img}`} alt={alt || monogram}
        style={{ height: size, width: "auto", display: "block", flex: "none" }} />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", border: `1px solid ${accent}`,
      display: "grid", placeItems: "center", fontFamily: "var(--isl-font-mono)", fontWeight: 700,
      fontSize: size * 0.3, color: accent, background: "var(--isl-phobos-ash)", flex: "none",
    }}>{monogram}</div>
  );
}

function StatusDot({ color = "var(--isl-solar-flare)", size = 10 }) {
  return <span style={{ width: size, height: size, borderRadius: "50%", background: color, flex: "none" }} />;
}

Object.assign(window, { Logo, Arrow, Button, TertiaryLink, Eyebrow, Divider, FormStrip, Crest, StatusDot });
