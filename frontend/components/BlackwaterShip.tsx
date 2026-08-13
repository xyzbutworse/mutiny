import type { CSSProperties } from "react";

export function BlackwaterShip({
  health = [55, 55, 55],
  compact = false,
}: {
  health?: [number, number, number];
  compact?: boolean;
}) {
  const minimumHealth = Math.min(...health);
  const vesselState = minimumHealth < 20
    ? "critical"
    : minimumHealth < 40
      ? "warning"
      : minimumHealth > 60
        ? "stable"
        : "nominal";
  const status = {
    stable: "SYSTEMS HOLDING",
    nominal: "STRUCTURAL LOAD NOMINAL",
    warning: "SYSTEM INSTABILITY",
    critical: "SEVERE HULL EMERGENCY",
  }[vesselState];

  return (
    <div
      className={`blackwater-vessel ${compact ? "compact" : ""} is-${vesselState}`}
      data-vessel-state={vesselState}
      style={{ "--minimum-health": minimumHealth } as CSSProperties}
    >
      <svg viewBox="0 0 980 360" role="img" aria-label="Blackwater-7 vessel schematic">
        <defs>
          <linearGradient id="hullFade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="48%" stopColor="currentColor" stopOpacity="0.05" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.13" />
          </linearGradient>
          <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <g className="ship-grid" opacity="0.28">
          {Array.from({ length: 18 }).map((_, i) => (
            <line key={`v-${i}`} x1={40 + i * 52} y1="38" x2={40 + i * 52} y2="322" />
          ))}
          {Array.from({ length: 6 }).map((_, i) => (
            <line key={`h-${i}`} x1="38" y1={55 + i * 50} x2="942" y2={55 + i * 50} />
          ))}
        </g>

        <g className="vessel-outline">
          <path d="M63 183 L138 145 L265 125 L377 93 L623 93 L711 112 L812 144 L914 164 L951 181 L914 198 L812 217 L711 248 L623 267 L377 267 L265 235 L138 215 Z" fill="url(#hullFade)" />
          <path d="M63 183 L138 145 L265 125 L377 93 L623 93 L711 112 L812 144 L914 164 L951 181 L914 198 L812 217 L711 248 L623 267 L377 267 L265 235 L138 215 Z" />
          <path d="M157 181 H909" className="hull-axis" />
          <path d="M278 128 L315 181 L278 232" />
          <path d="M718 114 L684 181 L718 246" />
          <path d="M365 95 L408 181 L365 265" />
          <path d="M629 95 L592 181 L629 265" />
          <path d="M451 93 V267 M543 93 V267" opacity="0.44" />
          <path d="M816 144 L780 181 L816 217" opacity="0.6" />
        </g>

        <g className="ship-conduits">
          <path d="M211 181 C295 181 328 155 392 155 H445" />
          <path d="M541 155 H627 C685 155 728 181 790 181" />
          <path d="M211 181 C295 181 328 208 392 208 H445" />
          <path d="M541 208 H627 C685 208 728 181 790 181" />
        </g>

        <g className="ship-core-node" transform="translate(496 181)">
          <circle r="54" />
          <circle r="41" />
          <circle r="27" />
          <circle r="8" className="core-pulse" filter="url(#softGlow)" />
          <path d="M-74 0 H-54 M54 0 H74 M0 -74 V-54 M0 54 V74" />
        </g>

        <g className="system-node reactor" transform="translate(245 181)">
          <circle r="24" />
          <circle r="7" />
          <text x="0" y="-39">RCTR</text>
          <text x="0" y="48">{health[0]}%</text>
        </g>
        <g className="system-node life" transform="translate(496 112)">
          <circle r="18" />
          <circle r="5" />
          <text x="0" y="-31">LIFE</text>
          <text x="0" y="39">{health[1]}%</text>
        </g>
        <g className="system-node nav" transform="translate(756 181)">
          <circle r="24" />
          <circle r="7" />
          <text x="0" y="-39">NAV</text>
          <text x="0" y="48">{health[2]}%</text>
        </g>

        <g className="ship-labels">
          <text x="80" y="82">BW–7 // LONG RANGE VESSEL</text>
          <text x="80" y="297">HULL CLASS / OBSIDIAN</text>
          <text x="790" y="82" textAnchor="end">DECK 04 / COMMAND</text>
          <text x="915" y="297" textAnchor="end">5 LIFE SIGNS</text>
        </g>

        <g className="signal-marks">
          <path d="M90 110 h38 M90 118 h19" />
          <path d="M852 244 h62 M874 252 h40" />
        </g>
      </svg>
      <div className="vessel-scan" />
      <div className="vessel-noise" />
      <div className="vessel-fault-line" aria-hidden="true" />
      <div className="vessel-status-line">
        <span>BLACKWATER–7 / TELEMETRY LINK</span>
        <span>{status}</span>
      </div>
      <div className="vessel-health-rail">
        {health.map((value, i) => (
          <div key={i} className="vessel-health-item">
            <span>{["REACTOR", "LIFE", "NAV"][i]}</span>
            <i><b style={{ "--health": `${value}%` } as CSSProperties} /></i>
            <strong>{value.toString().padStart(2, "0")}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
