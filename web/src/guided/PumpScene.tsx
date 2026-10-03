/**
 * The machine on screen: a chilled-water pump in a data hall's cooling loop.
 *
 * A motor drives a centrifugal pump through a coupling, on a bolted skid. The
 * pump pushes chilled water to the server racks and takes it back. This is a
 * rotating machine, so every fault Crux reasons about (imbalance, misalignment,
 * looseness, bearing damage) has a place on the drawing.
 *
 * The scene shows symptoms, not causes: before the verdict it only shakes in
 * proportion to the measured vibration level, so it never gives the answer
 * away. After the verdict it points at the part Crux blamed.
 */

import { Part } from "./plain";

export type SceneStatus = "off" | "running" | "investigating" | "decided" | "healthy";

const LAMP: Record<SceneStatus, string> = {
  off: "#3b4752",
  running: "#35c89a",
  investigating: "#f2b134",
  decided: "#ff7a45",
  healthy: "#35c89a",
};

export function PumpScene({
  status,
  vibration,
  highlight,
  highlightLabel,
}: {
  status: SceneStatus;
  /** Measured vibration as a multiple of a healthy pump's; 1 means normal. */
  vibration: number;
  highlight: Part | null;
  highlightLabel?: string;
}) {
  const running = status !== "off";
  // Shake grows with how far the reading is above normal, capped so the drawing
  // stays readable. A healthy pump still hums a little.
  const amp = running ? Math.min(3.5, 0.3 + Math.max(0, vibration - 1) * 1.1) : 0;
  const hl = (part: Part) => (highlight === part ? " g-hl" : "");

  return (
    <svg
      className={`g-scene${running ? " running" : ""}`}
      viewBox="0 0 720 300"
      role="img"
      aria-label="A chilled-water pump in a data hall cooling loop: motor, coupling and pump on a bolted base, piped to the server racks"
    >
      {/* Server racks, the reason the pump exists. */}
      <g className="g-rack">
        <rect x="24" y="44" width="86" height="196" rx="6" />
        {Array.from({ length: 7 }, (_, row) => (
          <g key={row}>
            <rect x="34" y={56 + row * 25} width="66" height="17" rx="2" className="g-unit" />
            <circle cx="42" cy={64.5 + row * 25} r="2.4" className="g-led" style={{ animationDelay: `${row * 0.37}s` }} />
            <circle cx="50" cy={64.5 + row * 25} r="2.4" className="g-led" style={{ animationDelay: `${row * 0.21 + 0.5}s` }} />
          </g>
        ))}
        <text x="67" y="262" textAnchor="middle" className="g-cap">Server racks</text>
      </g>

      {/* The loop: chilled water out of the pump to the racks, warm water back. */}
      <path className="g-pipe" d="M600 124 V30 H110 V60" />
      <path className="g-pipe" d="M110 222 V276 H690 V176 H652" />
      <path className={`g-flow cold${running ? "" : " still"}`} d="M600 124 V30 H110 V60" />
      <path className={`g-flow warm${running ? "" : " still"}`} d="M110 222 V276 H690 V176 H652" />
      <text x="355" y="22" textAnchor="middle" className="g-cap">chilled water to the racks</text>
      <text x="400" y="292" textAnchor="middle" className="g-cap">warm water back to the pump</text>

      <g className="g-machine" style={{ ["--amp" as string]: `${amp}px` }}>
        {/* Skid and its bolts: where looseness lives. */}
        <g className={`g-part${hl("base")}`}>
          <rect x="258" y="226" width="410" height="20" rx="3" className="g-base" />
          {[282, 392, 532, 644].map((x) => (
            <g key={x}>
              <rect x={x - 9} y="214" width="18" height="12" className="g-foot" />
              <circle cx={x} cy="236" r="4.5" className="g-bolt" />
            </g>
          ))}
        </g>

        {/* Motor, with its cooling fins and fan cover. */}
        <rect x="270" y="150" width="20" height="52" rx="4" className="g-body dim" />
        <rect x="290" y="128" width="160" height="94" rx="10" className="g-body" />
        {Array.from({ length: 9 }, (_, i) => (
          <line key={i} x1={306 + i * 16} y1="136" x2={306 + i * 16} y2="214" className="g-fin" />
        ))}
        <text x="370" y="182" textAnchor="middle" className="g-label">Motor</text>
        <circle cx="304" cy="116" r="6" fill={LAMP[status]} className={running ? "g-lamp on" : "g-lamp"} />

        {/* Shaft through the coupling to the pump. */}
        <rect x="450" y="171" width="104" height="10" rx="3" className="g-shaft" />
        <g className={`g-part${hl("coupling")}`}>
          <rect x="486" y="157" width="34" height="38" rx="4" className="g-coupling" />
          <line x1="494" y1="160" x2="494" y2="192" className={`g-stripe${running ? " move" : ""}`} />
          <line x1="512" y1="160" x2="512" y2="192" className={`g-stripe${running ? " move" : ""}`} />
        </g>

        {/* Drive-end bearing: where race faults live. */}
        <g className={`g-part${hl("bearing")}`}>
          <circle cx="462" cy="176" r="12" className="g-bearing" />
          <circle cx="462" cy="176" r="5" className="g-bearing-in" />
        </g>

        {/* Pump volute and the impeller spinning inside it: where imbalance lives. */}
        <g className={`g-part${hl("rotor")}`}>
          <circle cx="600" cy="176" r="52" className="g-body" />
          <circle cx="600" cy="176" r="36" className="g-volute" />
          <g className={running ? "g-spin" : ""} style={{ transformOrigin: "600px 176px" }}>
            {Array.from({ length: 6 }, (_, i) => (
              <path
                key={i}
                d="M600 176 q 10 -14 4 -31"
                className="g-blade"
                transform={`rotate(${i * 60} 600 176)`}
              />
            ))}
            <circle cx="600" cy="176" r="6" className="g-hub" />
          </g>
        </g>
        <text x="600" y="250" textAnchor="middle" className="g-label">Pump</text>
      </g>

      {highlight && highlight !== "none" && highlightLabel && (
        <g className="g-callout">
          <rect x="300" y="62" width="270" height="40" rx="8" />
          <text x="435" y="87" textAnchor="middle">{highlightLabel}</text>
        </g>
      )}
    </svg>
  );
}
