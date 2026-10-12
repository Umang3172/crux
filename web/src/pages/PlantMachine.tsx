// One machine in the plant: how it is looked after, where it stands along
// that workflow, the machine itself, and what has been done on it.

import { Link, useParams } from "react-router";
import { ChevronRight, Cog, Compass, FolderOpen, ListChecks, Play, Radio, ScanLine } from "lucide-react";
import { openLauncher } from "../app/Launcher";
import { modelOf } from "../lib/casemodel";
import { num, stamp } from "../lib/format";
import { useMachineModel } from "../lib/hooks";
import { fault } from "../lib/plain";
import { AREAS, MODE, OWNER, WORKFLOW, type MachineStatus, type PlantMachine } from "../lib/plant";
import { usePlant } from "../lib/useplant";
import { MachineTwin } from "../ui/MachineTwin";
import { Badge, Button, Card, Empty, LinkButton, PageHead, SourceTag, cx } from "../ui/kit";
import { CaseTable, rowsOf } from "./parts";
import "../styles/plant.css";
import "../styles/viz.css";
import "./pages.css";

function Steps({ m, st }: { m: PlantMachine; st: MachineStatus }) {
  return (
    <ol className="flow-steps">
      {WORKFLOW[m.mode].map((s, i) => (
        <li key={s} className={cx("flow-step", i < st.step && "done", i === st.step && "now")}>
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
          <Empty icon={<Compass size={18} />} title="No such machine in this plant" action={<LinkButton to="/plant">The plant</LinkButton>}>
            The link may be to a machine from another site.
          </Empty>
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
  const rpm = m.rpm ?? twin.data?.nominal_rpm ?? 0;

  return (
    <div className="page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/plant">Plant</Link>
        <ChevronRight size={12} aria-hidden />
        <span>{area?.name}</span>
        <ChevronRight size={12} aria-hidden />
        <span>{m.name}</span>
      </nav>
      <PageHead
        title={m.name}
        sub={`${m.type}${m.mode === "model" ? ` · ${num(rpm, 0)} rpm` : ""} · ${area?.name}`}
        actions={
          <>
            <SourceTag source={MODE[m.mode].source} />
            {m.mode === "model" && (
              <Button variant="primary" icon={<Play size={14} />} onClick={() => openLauncher({ machine: m.id })}>
                Investigate it
              </Button>
            )}
            {m.mode === "camera" && (
              <LinkButton to={`/lens?machine=${encodeURIComponent(m.name)}`} variant="primary" icon={<ScanLine size={14} />}>
                Scan it with a phone
              </LinkButton>
            )}
          </>
        }
      />

      <Card title="Where it stands" icon={<ListChecks size={15} />} sub={MODE[m.mode].label} tone={st.tone === "warn" || st.tone === "danger" ? st.tone : undefined}>
        <div className="row row-wrap between">
          <div>
            <div className="row row-wrap">
              <Badge tone={st.tone} dot pulse={st.busy}>
                {st.label}
              </Badge>
              {st.owner && <span className={cx("owner", st.owner)}>next: {OWNER[st.owner]}</span>}
            </div>
            <p className="muted" style={{ marginTop: 6 }}>
              {st.detail}
            </p>
          </div>
          {st.caseId && (
            <LinkButton to={`/cases/${st.caseId}`} variant={st.owner && st.owner !== "crux" ? "primary" : "default"}>
              Open the investigation
            </LinkButton>
          )}
        </div>
        <div style={{ margin: "18px 0 6px" }}>
          <Steps m={m} st={st} />
        </div>
        <p className="small dim" style={{ marginTop: 10 }}>
          {MODE[m.mode].care}
        </p>
      </Card>

      {m.mode === "model" && twin.data && (
        <Card title="The machine" icon={<Cog size={15} />} sub="its parts turning at their real ratios to the shaft">
          <MachineTwin model={twin.data} kind={m.kind === "fan" ? "fan" : "pump"} rpm={rpm} part={named} sensor={latestModel?.status === "waiting" ? "asked" : "idle"} />
          <dl className="defs" style={{ marginTop: 12 }}>
            <dt>Modelled as</dt>
            <dd>
              One shaft on an {twin.data.bearing.label} bearing ({twin.data.bearing.rolling_elements} balls) with a {twin.data.blade_count}-blade rotor, at {num(rpm, 0)} rpm.
            </dd>
            <dt>What that means</dt>
            <dd className="muted">The engine has one machine model. The modelled machines in this plant share it and differ in speed only; the drawing of a {m.kind === "fan" ? "fan" : "pump"} is a drawing. Faults are fed in, and every reading is synthetic.</dd>
          </dl>
        </Card>
      )}

      {m.mode === "live" && (
        <Card title="Its sensor" icon={<Radio size={15} />} foot="A sensor posts readings with a device token. This console reads its status only.">
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
              <dd>{data.sensor.normal_captures > 0 ? `${data.sensor.normal_captures} healthy captures on file` : "not recorded yet"}</dd>
              <dt>Ready to investigate</dt>
              <dd>{data.sensor.ready ? "yes" : "no: it needs a full capture first"}</dd>
            </dl>
          ) : (
            <p className="muted">This server has no live-sensor route.</p>
          )}
        </Card>
      )}

      {m.mode === "camera" && (
        <Card title="Phone scans of this machine" icon={<ScanLine size={15} />} flush>
          {scans.length === 0 ? (
            <Empty left title="Not scanned yet">
              Nothing is fitted to this machine. A ten-second phone video is the only reading there is.
            </Empty>
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
        <Card title="Investigations on this machine" icon={<FolderOpen size={15} />} sub={mine.length ? "newest first" : undefined} flush>
          {mine.length === 0 ? (
            <Empty left title="None yet">
              Investigate it, or simulate a shift from the plant page.
            </Empty>
          ) : (
            <CaseTable rows={rowsOf(mine)} brief />
          )}
        </Card>
      )}
    </div>
  );
}
