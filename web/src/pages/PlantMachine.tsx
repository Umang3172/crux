// One machine in the plant: where it stands and what comes next, the machine
// itself, and what has been done on it.

import { Link, useParams } from "react-router";
import { ChevronRight, Cog, Compass, FolderOpen, Play, Radio, ScanLine } from "lucide-react";
import { openLauncher } from "../app/Launcher";
import { modelOf } from "../lib/casemodel";
import { num, stamp } from "../lib/format";
import { useMachineModel } from "../lib/hooks";
import { fault } from "../lib/plain";
import { AREAS, MODE, OWNER, WORKFLOW, standingOf, type MachineStatus, type PlantMachine } from "../lib/plant";
import { usePlant } from "../lib/useplant";
import { MachineGlyph, type GlyphFrame } from "../ui/MachineGlyph";
import { MachineTwin } from "../ui/MachineTwin";
import { Button, Card, Empty, Hint, LinkButton, SourceTag, cx, vt } from "../ui/kit";
import { CaseTable, rowsOf } from "./parts";
import "../styles/plant.css";
import "../styles/viz.css";
import "./pages.css";

function Steps({ m, st }: { m: PlantMachine; st: MachineStatus }) {
  const tone = st.busy ? "accent" : st.tone;
  return (
    <ol className="flow-steps" aria-label={MODE[m.mode].label}>
      {WORKFLOW[m.mode].map((s, i) => (
        <li key={s} className={cx("flow-step", i < st.step && "done", i === st.step && `now tone-${tone}`)}>
          <i>{i + 1}</i>
          {s}
        </li>
      ))}
    </ol>
  );
}

export default function PlantMachinePage() {
  const { id } = useParams();
  const { rows, session, data } = usePlant();
  const twin = useMachineModel();
  const row = rows.find((r) => r.m.id === id);

  if (!row) {
    return (
      <div className="page">
        <Card>
          <Empty icon={<Compass size={18} />} title="No such machine here" action={<LinkButton to="/plant">Open plant</LinkButton>} />
        </Card>
      </div>
    );
  }
  const { m, st } = row;
  const area = AREAS.find((a) => a.id === m.area);
  const mine = session.cases.filter((c) => (c.machine ?? "p2") === m.id);
  const latest = st.caseId ? session.cases.find((c) => c.id === st.caseId) : undefined;
  const latestModel = modelOf(latest);
  const named = latestModel?.status === "concluded" && latestModel.leader ? fault(latestModel.leader.kind).part : "none";
  const scans = (data.scans ?? []).filter((s) => s.machine === m.name);
  const rpm = m.rpm ?? twin.data?.nominal_rpm;
  const standing = standingOf(st);
  const frame: GlyphFrame = st.busy
    ? { value: null, tone: "accent" }
    : standing === "person"
      ? { value: 1, tone: st.tone === "danger" ? "danger" : "warn" }
      : standing === "ok"
        ? { value: 1, tone: "ok" }
        : { value: 0 };

  // One thing to do: a person's step if it is their turn, else what this machine can be given.
  const act =
    standing === "person" && st.next ? (
      <LinkButton to={st.next.to} variant="primary">
        {st.next.label}
      </LinkButton>
    ) : st.busy && st.caseId ? (
      <LinkButton to={`/cases/${st.caseId}`}>Open investigation</LinkButton>
    ) : m.mode === "model" ? (
      <Button variant="primary" icon={<Play size={14} />} onClick={() => openLauncher({ machine: m.id })}>
        {st.caseId ? "Investigate again" : "Investigate machine"}
      </Button>
    ) : m.mode === "camera" ? (
      <LinkButton to={`/lens?machine=${encodeURIComponent(m.name)}`} variant="primary" icon={<ScanLine size={14} />}>
        Scan with phone
      </LinkButton>
    ) : null;

  return (
    <div className="page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/plant">Plant</Link>
        <ChevronRight size={12} aria-hidden />
        <span>{area?.name}</span>
      </nav>
      <header className="page-head">
        <div className="col gap-1 grow">
          <h1 style={vt(`m-${m.id}`)}>{m.name}</h1>
          <div className="machine-sub">
            <span>
              {m.type}
              {m.mode === "model" && rpm ? ` · ${num(rpm, 0)} rpm` : ""}
            </span>
            {m.mode === "model" && <SourceTag source="synthetic" />}
          </div>
        </div>
      </header>

      <Card tone={standing === "person" ? (st.tone === "danger" ? "danger" : "warn") : st.busy ? "accent" : undefined}>
        <div className="machine-now" data-tour="machine-status">
          <MachineGlyph kind={m.kind} rpm={rpm} running={m.mode === "model" && st.tone !== "danger"} width={112} frame={frame} />
          <div>
            <div className={cx("machine-state", `tone-${st.busy ? "accent" : st.tone}`)}>{st.label}</div>
            <div className="machine-sub">
              <span>{st.detail}</span>
              {st.owner && <span className={cx("owner", st.owner)}>Next: {OWNER[st.owner]}</span>}
              {st.caseId && !(standing === "person" && st.next) && !st.busy && <Link to={`/cases/${st.caseId}`}>Latest investigation</Link>}
            </div>
          </div>
          {act}
        </div>
        <div className="machine-steps">
          <Steps m={m} st={st} />
        </div>
      </Card>

      {m.mode === "model" && twin.data && rpm && (
        <Card title="The machine" icon={<Cog size={15} />} id="machine-twin">
          <MachineTwin model={twin.data} kind={m.kind === "fan" ? "fan" : "pump"} rpm={rpm} part={named} sensor={latestModel?.status === "waiting" ? "asked" : "idle"} />
          <p className="honest">
            {m.kind === "fan" ? `A fan here is the pump model at ${num(rpm, 0)} rpm.` : `The engine's one machine model, at ${num(rpm, 0)} rpm.`} The drawing is a drawing.
            <Hint label="How this machine is modelled">
              One shaft on an {twin.data.bearing.label} bearing ({twin.data.bearing.rolling_elements} balls) with a {twin.data.blade_count}-blade rotor. The modelled machines in this plant share it and differ in speed only. Faults are fed in; every reading is synthetic.
            </Hint>
          </p>
        </Card>
      )}

      {m.mode === "live" && (
        <Card title="Its sensor" icon={<Radio size={15} />} foot="This console reads the sensor's status only.">
          {data.sensor ? (
            <dl className="defs">
              <dt>Sensor</dt>
              <dd>{data.sensor.name}</dd>
              <dt>Sample rate</dt>
              <dd className="num">{num(data.sensor.sample_rate_hz, 0)} Hz</dd>
              <dt>Buffered</dt>
              <dd className="num">
                {num(data.sensor.seconds, 1)} s in {data.sensor.batches} batches
              </dd>
              <dt>Its own normal</dt>
              <dd>{data.sensor.normal_captures > 0 ? `${data.sensor.normal_captures} healthy captures` : "not recorded yet"}</dd>
            </dl>
          ) : (
            <p className="muted">This server has no live-sensor route.</p>
          )}
        </Card>
      )}

      {m.mode === "camera" && (
        <Card title="Phone scans" icon={<ScanLine size={15} />} sub={scans.length || undefined} flush>
          {scans.length === 0 ? (
            <Empty left title="Not scanned yet" />
          ) : (
            <ul className="list">
              {scans.map((s) => (
                <li key={s.id}>
                  <Link to={`/lens/${s.id}`} className="strong">
                    {s.summary[0] ?? "A clip on file"}
                  </Link>
                  <div className="small dim">
                    {stamp(s.created)} · {s.analysed ? "analysed" : "speed not confirmed"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {m.mode === "model" && (
        <Card title="Investigations" icon={<FolderOpen size={15} />} sub={mine.length || undefined} flush>
          {mine.length === 0 ? <Empty left title="None yet" /> : <CaseTable rows={rowsOf(mine)} brief />}
        </Card>
      )}
    </div>
  );
}
