/**
 * Crux Lens: point a phone at a machine.
 *
 * Record ten seconds of video. A vision model says what the machine is, reads
 * the nameplate and boxes the housing; the physics measures how that housing
 * shakes from the video itself and listens to the sound. The person confirms
 * the speed and the box before anything is analysed: model readings are never
 * used unchecked.
 */

import { useEffect, useRef, useState } from "react";
import {
  analyse,
  type Analysis,
  type Box,
  type Finding,
  markNormal,
  type Scan,
  type ScanRow,
  scan as getScan,
  scans as listScans,
  stillUrl,
  upload,
} from "./api";
import "./lens.css";

const ORDER = (o: number) => (o === 0.5 ? "½x" : o === 1.5 ? "1½x" : `${o}x`);

export function Lens() {
  const [machine, setMachine] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Scan | null>(null);
  const [past, setPast] = useState<ScanRow[]>([]);

  const refresh = () =>
    listScans()
      .then(setPast)
      .catch(() => setPast([]));
  useEffect(() => {
    refresh();
  }, []);

  const send = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setCurrent(null);
    setBusy("Uploading 0%");
    upload(file, machine, (f) =>
      setBusy(
        f < 1
          ? `Uploading ${Math.round(f * 100)}%`
          : "Reading the video and looking at the machine…",
      ),
    )
      .then((s) => {
        setCurrent(s);
        refresh();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  };

  const open = (id: string) =>
    getScan(id)
      .then((s) => {
        setCurrent(s);
        setMachine(s.machine);
        window.scrollTo({ top: 0, behavior: "smooth" });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  return (
    <main className="l-shell">
      <section className="l-hero">
        <p className="l-kicker">Crux Lens</p>
        <h1>Point your phone at the machine.</h1>
        <p className="l-lede">
          Record ten seconds. Crux measures how the housing shakes from the video itself, listens to
          the sound, and looks for anything plainly wrong. Then it tells you the one check that
          would settle it.
        </p>
      </section>

      <section className="l-card">
        <label className="l-field">
          Machine
          <input
            value={machine}
            onChange={(e) => setMachine(e.target.value)}
            placeholder="e.g. Cooling pump 2, or Desk fan"
          />
        </label>
        <div className="l-pick">
          <label className={`l-big${busy ? " off" : ""}`}>
            Record a video
            <input
              type="file"
              accept="video/*"
              capture="environment"
              disabled={!!busy}
              onChange={(e) => send(e.target.files?.[0])}
            />
          </label>
          <label className={`l-big quiet${busy ? " off" : ""}`}>
            Choose a video
            <input
              type="file"
              accept="video/*"
              disabled={!!busy}
              onChange={(e) => send(e.target.files?.[0])}
            />
          </label>
        </div>
        <ul className="l-tips">
          <li>Rest the phone on something steady, a metre or so away.</li>
          <li>
            Keep the motor or bearing housing in the middle, with some wall or floor around it.
          </li>
          <li>Use Slo-mo if your phone has it: it sees faster shaking.</li>
          <li>About ten seconds, at normal running speed. Don't talk: Crux listens too.</li>
        </ul>
        {busy && <p className="l-busy">{busy}</p>}
        {error && <p className="l-error">{error}</p>}
      </section>

      {current && (
        <ScanView key={current.id} scan={current} onChange={(s) => (setCurrent(s), refresh())} />
      )}

      {past.length > 0 && (
        <section className="l-card">
          <h2>Earlier scans</h2>
          <ul className="l-past">
            {past.map((p) => (
              <li key={p.id}>
                <button onClick={() => open(p.id)}>
                  <strong>{p.machine}</strong>
                  {p.normal && <span className="l-tag">normal</span>}
                  <span className="l-dim">{new Date(p.created).toLocaleString()}</span>
                  <span className="l-dim">
                    {p.summary[0] ?? (p.analysed ? "" : "Not analysed yet")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function ScanView({ scan, onChange }: { scan: Scan; onChange: (s: Scan) => void }) {
  const [box, setBox] = useState<Box>(scan.analysis?.box ?? scan.box);
  const [drawing, setDrawing] = useState<{ x: number; y: number } | null | false>(false);
  const [rpm, setRpm] = useState<string>(
    scan.analysis ? String(Math.round(scan.analysis.rpm_given)) : "",
  );
  const [bearing, setBearing] = useState("");
  const [result, setResult] = useState<Analysis | null>(scan.analysis);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const img = useRef<HTMLDivElement>(null);
  const [showMap, setShowMap] = useState(false);
  const still = Math.floor(scan.stills / 2);
  const id = scan.identity;
  const findings = scan.look.findings ?? [];

  const tap = (e: React.MouseEvent) => {
    if (drawing === false || !img.current) return;
    const r = img.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    if (drawing === null) return setDrawing({ x, y });
    const b = {
      x: Math.min(x, drawing.x),
      y: Math.min(y, drawing.y),
      w: Math.abs(x - drawing.x),
      h: Math.abs(y - drawing.y),
    };
    if (b.w > 0.04 && b.h > 0.04) setBox(b);
    setDrawing(false);
  };

  const run = () => {
    const speed = Number(rpm);
    if (!(speed > 0)) return setError("Enter the shaft speed first (rpm).");
    setBusy(true);
    setError(null);
    analyse(scan.id, speed, box, bearing)
      .then((a) => {
        setResult(a);
        onChange({ ...scan, analysis: a, box });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <section className="l-card">
        <h2>{scan.machine}</h2>
        <div className="l-still" ref={img} onClick={tap} data-drawing={drawing !== false}>
          <img src={stillUrl(scan.id, still)} alt={`Still from the video of ${scan.machine}`} />
          {showMap && scan.shake_area && scan.shake?.length ? (
            <Heat grid={scan.shake} area={scan.shake_area} />
          ) : null}
          <div
            className="l-box"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
            }}
          >
            <span>measuring here</span>
          </div>
          {!showMap && <Seen findings={findings} />}
          {drawing && (
            <div
              className="l-dot"
              style={{
                left: `${drawing.x * 100}%`,
                top: `${drawing.y * 100}%`,
              }}
            />
          )}
        </div>
        <div className="l-row">
          <button
            className="l-btn quiet"
            onClick={() => setDrawing(drawing === false ? null : false)}
          >
            {drawing === false
              ? "Move the box"
              : drawing === null
                ? "Tap one corner…"
                : "…now the opposite corner"}
          </button>
          {(scan.shake?.length ?? 0) > 0 && (
            <button className="l-btn quiet" onClick={() => setShowMap(!showMap)}>
              {showMap ? "Hide where it shakes" : "Show where it shakes"}
            </button>
          )}
          <span className="l-dim">
            {scan.duration_s.toFixed(1)} s at {Math.round(scan.fps)} fps
            {scan.audio_fs ? ", with sound" : ", no sound"}
            {scan.box_source && <>. Box placed by {scan.box_source}</>}
          </span>
        </div>

        <div className="l-ai">
          <p className="l-ai-head">
            What the model saw{" "}
            <span className="l-dim">
              ({id.by === "nobody" ? "no model on" : id.by}; unconfirmed: check before acting)
            </span>
          </p>
          {scan.look.retake && (
            <p className="l-warn">Take the photo again: {scan.look.retake}.</p>
          )}
          {id.by === "nobody" ? (
            <p>{id.note}</p>
          ) : (
            <>
              <p>
                Looks like: <strong>{id.machine_type || "not sure"}</strong>
                {id.box_label && <> · box on the {id.box_label.toLowerCase()}</>}
              </p>
              <p>
                Nameplate: {id.nameplate_text ? <code>{id.nameplate_text}</code> : "none legible"}
              </p>
              {id.note && <p className="l-dim">{id.note}</p>}
              {findings.length ? (
                <ul>
                  {findings.map((f, i) => (
                    <li key={i} className={f.hazard ? "hazard" : ""}>
                      {f.hazard && "Hazard: "}
                      {f.what}: {f.evidence || f.where}
                      {f.severity && f.severity !== "none" && ` (${f.severity})`}
                      {f.new_since_reference === "yes" && ", new since the normal scan"}
                    </li>
                  ))}
                </ul>
              ) : (
                !scan.look.retake && <p>Nothing plainly wrong in view.</p>
              )}
              {scan.look.note && !scan.look.retake && <p className="l-dim">{scan.look.note}</p>}
              {scan.look.reference && (
                <p className="l-dim">Looked at beside the {scan.look.reference}.</p>
              )}
            </>
          )}
        </div>

        {(scan.notes ?? []).map((n) => (
          <p key={n} className="l-warn">
            {n}
          </p>
        ))}

        <div className="l-confirm">
          <label className="l-field">
            Shaft speed (rpm), as you know it
            <input
              inputMode="decimal"
              value={rpm}
              onChange={(e) => setRpm(e.target.value)}
              placeholder="e.g. 1480"
            />
          </label>
          {(scan.candidates?.length ?? 0) > 0 && (
            <div className="l-chips">
              <span className="l-dim">Strongest shaking in the video:</span>
              {scan.candidates.map((c) => (
                <button key={c.hz} onClick={() => setRpm(String(Math.round(c.rpm_if_1x)))}>
                  {c.hz.toFixed(1)} Hz → {Math.round(c.rpm_if_1x).toLocaleString()} rpm if it's the
                  shaft
                </button>
              ))}
            </div>
          )}
          <label className="l-field">
            Bearing part number, if known
            <input
              value={bearing}
              onChange={(e) => setBearing(e.target.value)}
              placeholder="e.g. 6205"
            />
          </label>
          <button className="l-btn" onClick={run} disabled={busy}>
            {busy ? "Measuring…" : "Analyse"}
          </button>
          {error && <p className="l-error">{error}</p>}
        </div>
      </section>

      {result && <Result scan={scan} a={result} onNormal={onChange} />}
    </>
  );
}

/** Boxes around what the photo check kept, on the still it looked at. */
function Seen({ findings }: { findings: Finding[] }) {
  return (
    <>
      {findings
        .filter((f) => f.box)
        .map((f, i) => {
          const [y0, x0, y1, x1] = f.box as [number, number, number, number];
          return (
            <div
              key={`${f.item ?? f.what}-${i}`}
              className={`l-find${f.hazard ? " hazard" : ""}`}
              style={{
                left: `${x0 / 10}%`,
                top: `${y0 / 10}%`,
                width: `${(x1 - x0) / 10}%`,
                height: `${(y1 - y0) / 10}%`,
              }}
            >
              <span>{f.what}?</span>
            </div>
          );
        })}
    </>
  );
}

/** The shake map: each cell tinted by how much more it shakes than a typical cell. */
function Heat({ grid, area }: { grid: number[][]; area: Box }) {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  // Log scale from 1x (no tint) to 30x (full tint): shaking spans orders of magnitude.
  const tint = (r: number) => Math.max(0, Math.min(1, Math.log(r) / Math.log(30)));
  return (
    <div
      className="l-heat"
      style={{
        left: `${area.x * 100}%`,
        top: `${area.y * 100}%`,
        width: `${area.w * 100}%`,
        height: `${area.h * 100}%`,
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
      aria-hidden
    >
      {grid.flat().map((r, i) => (
        <span key={i} style={{ opacity: 0.75 * tint(r) }} title={`${r.toFixed(1)}x`} />
      ))}
    </div>
  );
}

function Result({ scan, a, onNormal }: { scan: Scan; a: Analysis; onNormal: (s: Scan) => void }) {
  const [normal, setNormal] = useState(scan.normal);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="l-card">
      <h2>What Crux found</h2>
      <ul className="l-summary">
        {a.summary.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>

      {a.next_check && (
        <div className="l-check">
          <p className="l-check-head">The check that settles it: {a.next_check.name}</p>
          <ol>
            {a.next_check.procedure.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
        </div>
      )}

      <h3>How the housing moved</h3>
      <Spectrum a={a} />
      <p className="l-dim">
        Shaking mostly{" "}
        {a.direction_deg > 60
          ? "up and down"
          : a.direction_deg < 30
            ? "side to side"
            : "diagonally"}
        , {a.rms_px.toFixed(3)} px rms in the video.{" "}
        {a.speed_note.charAt(0).toUpperCase() + a.speed_note.slice(1)}.
        {!a.shake_removed && " Camera shake was not removed: no still patch beside the machine."}
      </p>

      <h3>Virtual experiments on the motion</h3>
      <Bars scores={a.camera} />
      {a.change && a.change.scores.length > 0 && (
        <>
          <h3>Change since the normal scan</h3>
          <p className="l-dim">
            {Object.entries(a.change.growth)
              .filter(([o]) => ["1", "1.0", "2", "2.0", "3", "3.0"].includes(o))
              .map(([o, g]) => `${ORDER(Number(o))}: ${Number.isFinite(g) ? g.toFixed(1) : "new"}×`)
              .join(" · ")}
          </p>
          <Bars scores={a.change.scores} />
        </>
      )}
      <h3>Sound</h3>
      {a.sound.length ? <Bars scores={a.sound} /> : <p className="l-dim">{a.sound_note}.</p>}

      <div className="l-row">
        {normal ? (
          <span className="l-tag">This is the normal scan for {scan.machine}</span>
        ) : (
          <button
            className="l-btn quiet"
            onClick={() =>
              markNormal(scan.id)
                .then((s) => {
                  setNormal(true);
                  onNormal(s);
                })
                .catch((e) => setError(e instanceof Error ? e.message : String(e)))
            }
          >
            This machine is running normally: keep as its normal scan
          </button>
        )}
      </div>
      {error && <p className="l-error">{error}</p>}
    </section>
  );
}

function Bars({ scores }: { scores: { kind: string; label: string; score: number }[] }) {
  const best = Math.max(...scores.map((s) => s.score));
  return (
    <ul className="l-bars">
      {scores.map((s) => (
        <li key={s.kind} className={s.score >= best - 0.05 ? "lead" : ""}>
          <span>{s.label}</span>
          <span className="l-bar">
            <span style={{ width: `${Math.max(2, s.score * 100)}%` }} />
          </span>
          <span className="l-num">{s.score.toFixed(2)}</span>
        </li>
      ))}
    </ul>
  );
}

function Spectrum({ a }: { a: Analysis }) {
  const W = 640;
  const H = 180;
  const pad = { l: 8, r: 8, t: 22, b: 24 };
  const fmax = a.fps / 2;
  const ymax = Math.max(...a.spectrum.px, 1e-6);
  const sx = (f: number) => pad.l + (f / fmax) * (W - pad.l - pad.r);
  const sy = (v: number) => H - pad.b - (v / ymax) * (H - pad.t - pad.b);
  const path = a.spectrum.hz
    .map((f, i) => `${i ? "L" : "M"}${sx(f).toFixed(1)},${sy(a.spectrum.px[i]).toFixed(1)}`)
    .join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => k * fmax);
  return (
    <svg
      className="l-spec"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Motion spectrum with shaft orders marked"
    >
      {a.lines
        .filter((l) => [0.5, 1, 2, 3].includes(l.order))
        .map((l) => (
          <g key={l.order} className={l.clear ? "mark" : "mark dim"}>
            <line x1={sx(l.seen_hz)} x2={sx(l.seen_hz)} y1={pad.t - 4} y2={H - pad.b} />
            <text x={sx(l.seen_hz)} y={pad.t - 8} textAnchor="middle">
              {ORDER(l.order)}
            </text>
          </g>
        ))}
      <path d={path} className="trace" />
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="axis" />
      {ticks.map((t) => (
        <text key={t} x={sx(t)} y={H - 6} textAnchor="middle" className="tick">
          {Math.round(t)} Hz
        </text>
      ))}
    </svg>
  );
}
