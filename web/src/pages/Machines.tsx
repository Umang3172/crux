import { Link } from "react-router";
import { ArrowRight, Factory, Play, Radio } from "lucide-react";
import { machines as fetchMachines, streamStatus } from "../api/crux";
import { openLauncher } from "../app/Launcher";
import { num } from "../lib/format";
import { useAsync, useMachineModel } from "../lib/hooks";
import { LIVE_SENSOR, PUMP } from "../lib/scenarios";
import { useSession } from "../lib/session";
import { Badge, Button, Callout, Card, ErrorState, LinkButton, PageHead, SkeletonRows, SourceTag } from "../ui/kit";
import { MachineTwin } from "../ui/MachineTwin";
import { rowsOf } from "./parts";
import "../styles/viz.css";
import "./pages.css";

export default function Machines() {
  const fleet = useAsync(() => fetchMachines(), []);
  const sensor = useAsync(() => streamStatus(LIVE_SENSOR).catch(() => null), []);
  const session = useSession();
  const rows = rowsOf(session.cases);
  const open = rows.filter((r) => r.model.status === "waiting").length;
  const twin = useMachineModel();

  return (
    <div className="page">
      <PageHead title="Machines" sub="Three kinds of machine reach Crux: a physics model that can be given a fault, whole lives replayed from a recording or a simulation, and a live sensor." />

      <Card
        title={PUMP.name}
        icon={<Factory size={15} />}
        sub={PUMP.type}
        actions={
          <>
            <SourceTag source={PUMP.source} />
            <LinkButton to="/cases" variant="ghost" size="sm">
              Its cases <ArrowRight size={13} />
            </LinkButton>
            <Button variant="primary" size="sm" icon={<Play size={13} />} onClick={() => openLauncher()}>
              Investigate it
            </Button>
          </>
        }
        foot="The engine's own model of the pump: a fault is fed in and its readings are simulated. Each part in the drawing turns at the ratio to the shaft that the engine computes from the bearing's geometry."
      >
        {twin.data ? (
          <>
            <MachineTwin model={twin.data} rpm={twin.data.nominal_rpm} sensor={open > 0 ? "asked" : "idle"} />
            <dl className="defs" style={{ marginTop: 12 }}>
              <dt>Bearing</dt>
              <dd>
                {twin.data.bearing.label}: {twin.data.bearing.rolling_elements} balls of {twin.data.bearing.ball_diameter_mm} mm on a {twin.data.bearing.pitch_diameter_mm} mm pitch circle
              </dd>
              <dt>Sampled at</dt>
              <dd className="num">{num(twin.data.sample_rate_hz, 0)} Hz</dd>
              <dt>Cases</dt>
              <dd>
                {rows.length} in this session{open > 0 && `, ${open} waiting for a measurement`}
              </dd>
            </dl>
          </>
        ) : twin.loading ? (
          <SkeletonRows rows={5} />
        ) : (
          <p className="muted">This server does not describe the machine's parts, so there is no drawing of it.</p>
        )}
      </Card>

      <div className="grid-2">
        <Card title="Bench motor M-1" icon={<Radio size={15} />} foot="A sensor posts readings with a device token. This console reads its status only.">
          {!sensor.data ? (
            sensor.loading ? (
              <SkeletonRows rows={3} />
            ) : (
              <p className="muted">This server has no live-sensor route.</p>
            )
          ) : (
            <div className="col gap-3">
              <div className="row row-wrap">
                {sensor.data.seconds > 0 ? (
                  <Badge tone="ok" dot pulse>
                    sending
                  </Badge>
                ) : (
                  <Badge>no sensor is sending</Badge>
                )}
                <Badge plain>live sensor</Badge>
              </div>
              <dl className="defs">
                <dt>Sensor</dt>
                <dd>{sensor.data.name}</dd>
                <dt>Sample rate</dt>
                <dd className="num">{num(sensor.data.sample_rate_hz, 0)} Hz</dd>
                <dt>Buffered</dt>
                <dd className="num">
                  {num(sensor.data.seconds, 1)} s in {sensor.data.batches} batches
                </dd>
                <dt>Its own normal</dt>
                <dd>{sensor.data.normal_captures > 0 ? `${sensor.data.normal_captures} healthy captures on file` : "not recorded yet"}</dd>
                <dt>Ready to investigate</dt>
                <dd>{sensor.data.ready ? "yes" : "no: it needs a full capture first"}</dd>
              </dl>
            </div>
          )}
        </Card>

        <Card title="What a machine's own normal is for" icon={<Factory size={15} />}>
          <p className="muted">
            A case is scored on how the machine has changed from its own healthy recordings, not against a textbook machine. Where a recorded life is on file, its early hours are that normal. The machine pages show the difference it makes.
          </p>
        </Card>
      </div>

      <Card title="Lives on file" icon={<Factory size={15} />} sub="a part's health from new to failure, replayed against a clock" flush>
        {fleet.error ? (
          <ErrorState error={fleet.error} onRetry={fleet.reload} />
        ) : !fleet.data ? (
          <SkeletonRows />
        ) : (
          <>
            {fleet.data.note && (
              <div style={{ padding: 16, borderBottom: "1px solid var(--line)" }}>
                <Callout tone={fleet.data.synthetic ? "warn" : "neutral"}>{fleet.data.note}</Callout>
              </div>
            )}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Source</th>
                    <th className="t-num">Parts tracked</th>
                    <th className="t-num">Hours on file</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {fleet.data.machines.map((m) => (
                    <tr key={m.machine} className="hover">
                      <td>
                        <Link to={`/machines/${m.machine}`} className="strong">
                          {m.name}
                        </Link>
                        <div className="tiny dim mono">{m.machine}</div>
                      </td>
                      <td className="muted">{m.source}</td>
                      <td className="t-num">{m.parts}</td>
                      <td className="t-num">{num(m.end_h, 1)}</td>
                      <td style={{ textAlign: "right" }}>
                        <LinkButton to={`/machines/${m.machine}`} size="sm">
                          Open <ArrowRight size={13} />
                        </LinkButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
