// One machine: the machine itself in 3D, one sentence on where it stands, one
// button for the next thing to do, and, once Crux has an answer, the answer
// and how it got there in four plain lines. Its past investigations, its
// sensor and its phone scans are a tab away each, beside the same figure.

import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft } from "lucide-react";
import { modelOf, type CaseModel } from "../lib/casemodel";
import { clock, num, stamp } from "../lib/format";
import { useCatalogue } from "../lib/hooks";
import { fault } from "../lib/plain";
import { machinePath, trendsPath, type PlantData, type PlantMachine } from "../lib/plant";
import type { CaseEntry } from "../lib/session";
import { usePlant } from "../lib/useplant";
import { finding, rowsOf } from "../pages/parts";
import { Tabs } from "../ui/kit";
import { MachineFigure } from "./Figure";
import { investigateMachine, takeMeasurement } from "./run";
import { keep, sayStatus, usable } from "./words";
import "./simple.css";

const pct = (x: number) => (x >= 0.995 ? "over 99%" : `${Math.round(x * 100)}%`);

/** What to do about it, in the engine's own words. */
function actionOf(entry: CaseEntry | undefined): string | null {
  const engine = entry?.inv?.conclusion?.recommended_action;
  if (engine) return engine;
  const line = [...(entry?.run?.case?.transcript ?? [])].reverse().find((l) => /^Conclusion:/i.test(l));
  const after = line?.replace(/^Conclusion:\s*/i, "").split(/%\.\s+/)[1];
  return after?.trim() || null;
}

function Trail({ model }: { model: CaseModel }) {
  const written = model.suspects.filter((s) => s.origin === "written").length;
  const asked = model.checks.filter((c) => c.status === "answered");
  const rows: { text: string; off?: boolean }[] = [
    { text: "Read how the machine shakes." },
    {
      text: `Tried ${model.suspects.length} possible causes on a virtual copy of the machine${written ? `, including ${written === 1 ? "one" : written} it wrote itself` : ""}.`,
    },
    asked.length
      ? { text: `Asked for ${asked.length === 1 ? "one measurement" : `${asked.length} measurements`}: ${asked.map((c) => c.name.toLowerCase()).join(", ")}.` }
      : { text: "Needed no extra measurement.", off: true },
    model.status === "concluded" && model.leader
      ? { text: model.leader.kind === "healthy" ? `Found nothing wrong, ${pct(model.leader.belief ?? 0)} sure.` : `Named the cause, ${pct(model.leader.belief ?? 0)} sure.` }
      : { text: "Could not name a cause, and said so." },
  ];
  return (
    <ol className="mn-trail" aria-label="How Crux got there">
      {rows.map((r, i) => (
        <li key={i} className={r.off ? "off" : undefined}>
          <span>{i + 1}</span>
          <span>{r.text}</span>
        </li>
      ))}
    </ol>
  );
}

type Tab = "now" | "history" | "sensor" | "scans";

/** This machine's investigations, newest first, each one line that opens it. */
function History({ cases }: { cases: CaseEntry[] }) {
  const rows = rowsOf(cases);
  if (rows.length === 0) return <p className="mn-now-detail">Nothing investigated on this machine yet.</p>;
  const today = new Date().toDateString();
  return (
    <ul className="mn-list">
      {rows.map(({ entry, model }) => (
        <li key={entry.id}>
          <Link to={`/cases/${entry.id}`}>
            <span>{finding(model)}</span>
            <span className="mn-list-meta">
              {model.status === "concluded" && model.leader ? `${pct(model.leader.belief ?? 0)} sure · ` : ""}
              {new Date(entry.createdAt).toDateString() === today ? clock(entry.createdAt) : stamp(entry.createdAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Sensor({ data }: { data: PlantData }) {
  if (!data.sensor) return <p className="mn-now-detail">This server has no live-sensor route.</p>;
  const rows: [string, ReactNode][] = [
    ["Sensor", data.sensor.name],
    ["Sample rate", `${num(data.sensor.sample_rate_hz, 0)} Hz`],
    ["Buffered", `${num(data.sensor.seconds, 1)} s in ${data.sensor.batches} batches`],
    ["Its own normal", data.sensor.normal_captures > 0 ? `${data.sensor.normal_captures} healthy captures` : "not recorded yet"],
  ];
  return (
    <dl className="mn-kv">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Scans({ m, data }: { m: PlantMachine; data: PlantData }) {
  const scans = (data.scans ?? []).filter((s) => s.machine === m.name);
  if (scans.length === 0) return <p className="mn-now-detail">Not scanned yet.</p>;
  return (
    <ul className="mn-list">
      {scans.map((s) => (
        <li key={s.id}>
          <Link to={`/lens/${s.id}`}>
            <span>{s.summary[0] ?? "A clip on file"}</span>
            <span className="mn-list-meta">
              {stamp(s.created)} · {s.analysed ? "analysed" : "speed not confirmed"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Actions({ m, entry, model, busy, run, measure, onSensor }: { m: PlantMachine; entry?: CaseEntry; model: CaseModel | null; busy: boolean; run: () => void; measure: () => void; onSensor: () => void }) {
  if (m.mode === "life")
    return (
      <Link to={machinePath(m)} className="mn-btn">
        Open its health history
      </Link>
    );
  if (m.mode === "live")
    return (
      <button className="mn-btn" onClick={onSensor}>
        See the sensor
      </button>
    );
  if (m.mode === "camera")
    return (
      <Link to={`/lens?machine=${encodeURIComponent(m.name)}`} className="mn-btn">
        Scan it with a phone
      </Link>
    );
  if (m.mode === "history")
    return (
      <Link to={trendsPath(m)} className="mn-btn">
        Open its trends
      </Link>
    );

  if (busy)
    return (
      <button className="mn-btn" disabled>
        Investigating…
      </button>
    );
  if (model?.status === "waiting" && entry) {
    return entry.kind === "engine" && model.request ? (
      <button className="mn-btn" onClick={measure}>
        Take the measurement
      </button>
    ) : (
      <Link to={`/cases/${entry.id}`} className="mn-btn">
        Open the investigation
      </Link>
    );
  }
  if (!model)
    return (
      <button className="mn-btn" onClick={run}>
        Find the cause
      </button>
    );
  return (
    <>
      <Link to={`/cases/${entry!.id}`} className="mn-btn ghost">
        See the full investigation
      </Link>
      <button className="mn-link" onClick={run}>
        Send the next reading
      </button>
    </>
  );
}

export default function Machine() {
  const { id } = useParams();
  const { rows, session, data } = usePlant();
  const catalogue = useCatalogue();
  const [tab, setTab] = useState<Tab>("now");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const row = rows.find((r) => r.m.id === id);

  if (!row) {
    return (
      <div className="mn-page mn-wrap">
        <Link to="/" className="mn-back">
          <ArrowLeft size={15} /> All machines
        </Link>
        <p className="mn-lede">There is no machine called {id} in this plant.</p>
      </div>
    );
  }

  const { m, st } = row;
  const mine = session.cases.filter((c) => (c.machine ?? "p2") === m.id);
  const entry = [...mine].sort((a, b) => b.createdAt - a.createdAt)[0];
  const model = usable(entry, modelOf(entry, catalogue.data));
  const cleared = !!entry?.lost && !model;
  const working = busy || !!st.busy;
  const said = sayStatus(m, working ? { ...st, busy: true } : st, model);
  const leader = model?.status === "concluded" && model.leader && model.leader.kind !== "healthy" ? model.leader : null;
  const action = leader ? actionOf(entry) : null;

  async function act(job: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mn-page mn-wrap">
      <Link to="/" className="mn-back">
        <ArrowLeft size={15} /> All machines
      </Link>

      <div className="mn-machine">
        <div className="mn-stage">
          <MachineFigure m={m} model={model} />
        </div>

        <div className="mn-side">
          <div>
            <h1 className="mn-title">{keep(m.name)}</h1>
            <div className="mn-sub">
              {m.type}
              {m.rpm ? `, running at ${m.rpm.toLocaleString()} rpm` : ""}
            </div>
          </div>

          {m.mode !== "life" && (
            <Tabs
              value={tab}
              onChange={setTab}
              label={m.name}
              tabs={[
                { id: "now", label: "Now" },
                ...(m.mode === "model" ? [{ id: "history" as const, label: "History", count: rowsOf(mine).length || undefined }] : []),
                ...(m.mode === "live" ? [{ id: "sensor" as const, label: "Sensor" }] : []),
                ...(m.mode === "camera" ? [{ id: "scans" as const, label: "Phone scans" }] : []),
              ]}
            />
          )}

          {tab === "history" && <History cases={mine} />}
          {tab === "sensor" && <Sensor data={data} />}
          {tab === "scans" && <Scans m={m} data={data} />}

          {tab === "now" && (
            <section className="mn-now" aria-live="polite">
              <div className="mn-state">
                <i className={`mn-dot ${said.mood}`} aria-hidden />
                <span className="mn-now-label">{leader && !working ? "Problem found" : said.short}</span>
              </div>

              {leader && !working ? (
                <div className="mn-answer" aria-label="The answer">
                  <div className="mn-answer-name">{fault(leader.kind).name}</div>
                  <span className="mn-sure">Crux is {pct(leader.belief ?? 0)} sure</span>
                  {fault(leader.kind).story && <p>{fault(leader.kind).story}</p>}
                  <dl className="mn-kv">
                    <dt>Where</dt>
                    <dd>{fault(leader.kind).partName}</dd>
                    {action && (
                      <>
                        <dt>What to do</dt>
                        <dd>{action}</dd>
                      </>
                    )}
                  </dl>
                </div>
              ) : (
                <>
                  <div className="mn-now-text">{said.line}</div>
                  {said.detail && <p className="mn-now-detail">{said.detail}</p>}
                </>
              )}

              <div className="mn-actions">
                <Actions
                  m={m}
                  entry={entry}
                  model={model}
                  busy={working}
                  run={() => void act(() => investigateMachine(m.id))}
                  measure={() => entry && model?.request && void act(() => takeMeasurement(entry, model.request!.test_id))}
                  onSensor={() => setTab("sensor")}
                />
              </div>
              {model?.status === "waiting" && entry?.kind === "engine" && !working && (
                <p className="mn-now-detail" style={{ fontSize: 13.5 }}>
                  In this demo the machine's model takes the reading for you. On a real plant a technician would.
                </p>
              )}
              {cleared && !working && (
                <p className="mn-now-detail" style={{ fontSize: 13.5 }}>
                  The last check on this machine was cleared when the demo server restarted.
                </p>
              )}
              {error && <p className="mn-error">{error}</p>}
            </section>
          )}

          {tab === "now" && model && model.status !== "waiting" && !working && <Trail model={model} />}
        </div>
      </div>
    </div>
  );
}
