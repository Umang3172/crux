// Phone scans: a phone video of a machine with no sensor, read for motion and
// sound. A camera sees slow motion only, so its result is a screen, and it
// names the measurement to take next.

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ChevronRight, History, ScanLine, Star } from "lucide-react";
import { analyseScan, markNormalScan, scan as fetchScan, scanStillUrl, scans as fetchScans } from "../api/crux";
import type { Scan, ScanAnalysis } from "../api/types";
import { num, stamp } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { fault } from "../lib/plain";
import { SpectrumChart } from "../ui/charts";
import { Badge, Button, Callout, Card, Details, Dialog, Empty, ErrorState, Hint, PageHead, SkeletonRows, Stat, Tabs, toast } from "../ui/kit";
import { LensLive } from "./lens/LensLive";
import "./pages.css";
import "../styles/trust.css";

export function Lens() {
  const navigate = useNavigate();
  const list = useAsync(() => fetchScans(), []);
  const [history, setHistory] = useState(false);

  return (
    <div className="page tr-page ll-page">
      <PageHead
        title="Phone scans"
        actions={
          <Button size="sm" variant="ghost" icon={<History size={14} />} onClick={() => setHistory(true)}>
            Earlier scans{list.data?.length ? ` (${list.data.length})` : ""}
          </Button>
        }
      />

      <LensLive onScanned={() => list.reload()} />

      <Dialog open={history} onClose={() => setHistory(false)} title="Earlier scans" sub="Shared by everyone using this server." wide>
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <SkeletonRows />
        ) : list.data.length === 0 ? (
          <Empty icon={<ScanLine size={18} />} title="No scans yet">
            Record one, or upload a clip of a running machine.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Machine</th>
                  <th>State</th>
                  <th className="t-num">Taken</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((s) => (
                  <tr key={s.id} className="hover link" tabIndex={0} onClick={() => navigate(`/lens/${s.id}`)} onKeyDown={(e) => e.key === "Enter" && navigate(`/lens/${s.id}`)}>
                    <td>
                      <b>{s.machine || "unnamed machine"}</b>
                      <div className="tiny dim mono">{s.id}</div>
                    </td>
                    <td>
                      <span className="row gap-1 row-wrap">
                        <Badge tone={s.analysed ? "ok" : "warn"}>{s.analysed ? "analysed" : "speed not confirmed"}</Badge>
                        {s.normal && <Badge tone="accent">its normal</Badge>}
                      </span>
                    </td>
                    <td className="t-num dim-cell">{stamp(s.created)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Dialog>
    </div>
  );
}

export function LensScan() {
  const { id = "" } = useParams();
  const got = useAsync(() => fetchScan(id), [id]);
  const [analysis, setAnalysis] = useState<ScanAnalysis | null>(null);
  const [normal, setNormal] = useState<boolean | null>(null);
  const [rpm, setRpm] = useState("");
  const [busy, setBusy] = useState<"analyse" | "normal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"result" | "motion" | "clip">("result");

  if (got.error) {
    return (
      <div className="page tr-page">
        <ErrorState error={got.error} onRetry={got.reload} />
      </div>
    );
  }
  if (!got.data) {
    return (
      <div className="page tr-page">
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      </div>
    );
  }
  const s: Scan = got.data;
  const a = analysis ?? s.analysis;
  const isNormal = normal ?? s.normal;
  const look = "findings" in s.look ? s.look : null;
  const by = s.identity.by && s.identity.by !== "nobody" ? s.identity.by : null;
  // Motion and sound exist only once the speed is confirmed.
  const shown = tab === "motion" && !a ? "result" : tab;

  async function analyse(value: number) {
    setBusy("analyse");
    setError(null);
    try {
      setAnalysis(await analyseScan(id, { rpm: value }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function markNormal() {
    setBusy("normal");
    setError(null);
    try {
      setNormal((await markNormalScan(id)).normal);
      toast("Kept as this machine's normal");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page tr-page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/lens">Phone scans</Link>
        <ChevronRight size={12} aria-hidden />
        <span className="mono">{s.id}</span>
      </nav>
      <PageHead
        title={s.machine || "Unnamed machine"}
        sub={`${num(s.duration_s, 1)} s phone clip · ${stamp(s.created)}`}
        actions={
          isNormal ? (
            <Badge tone="accent">this machine's normal</Badge>
          ) : a ? (
            <span className="tr-with-hint">
              <Button icon={<Star size={14} />} busy={busy === "normal"} onClick={markNormal}>
                Keep as normal
              </Button>
              <Hint label="What keeping it as normal does">Later scans of this machine are compared with this one.</Hint>
            </span>
          ) : undefined
        }
      />

      {error && <Callout tone="danger">{error}</Callout>}

      <Tabs
        value={shown}
        onChange={setTab}
        label="Scan"
        tabs={[
          { id: "result", label: a ? "What Crux found" : "Confirm the speed" },
          ...(a ? [{ id: "motion" as const, label: "Motion and sound" }] : []),
          { id: "clip", label: "The clip" },
        ]}
      />

      {shown === "result" && !a && (
        <div className="narrow">
          <Card title="Confirm the shaft speed" icon={<ScanLine size={15} />} tone="warn">
            <p className="muted">Pick the rhythm that is one turn of the shaft, or type the speed.</p>
            <div className="row row-wrap" style={{ marginTop: 12 }}>
              {s.candidates.map((c) => (
                <Button key={c.hz} busy={busy === "analyse"} onClick={() => analyse(c.rpm_if_1x)}>
                  {num(c.rpm_if_1x, 0)} rpm <span className="dim">· {num(c.hz, 1)} Hz</span>
                </Button>
              ))}
              <input className="input num" style={{ width: 110 }} placeholder="or rpm" value={rpm} onChange={(e) => setRpm(e.target.value)} aria-label="Shaft speed in rpm" />
              <Button variant="primary" disabled={!(Number(rpm) > 0)} busy={busy === "analyse"} onClick={() => analyse(Number(rpm))}>
                Analyse clip
              </Button>
            </div>
          </Card>
        </div>
      )}
      {shown === "result" && a && (
        <div className="narrow col" style={{ gap: "var(--s-5)" }}>
          <Card title="What Crux found" icon={<ScanLine size={15} />} actions={<Badge tone="accent">the engine's words</Badge>}>
            <ul className="tr-lines">
              {a.summary.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
            {a.camera_blind && (
              <div style={{ marginTop: 12 }}>
                <Callout tone="warn">This clip cannot tell the once-per-turn line from the twice-per-turn line, so motion rules nothing out here.</Callout>
              </div>
            )}
            {a.next_check && (
              <div style={{ marginTop: 12 }}>
                <Callout tone="accent">
                  <b>Measure next: {a.next_check.name}.</b> {a.next_check.procedure.join(" ")}
                </Callout>
              </div>
            )}
          </Card>
          {a.change && (
            <Card title="Change since this machine's normal scan">
              <p className="muted">{a.change.note}</p>
              <div className="row row-wrap" style={{ marginTop: 10 }}>
                {Object.entries(a.change.growth).map(([k, v]) => (
                  <Badge key={k}>
                    {k}: {num(v, 1)}×
                  </Badge>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
      {shown === "motion" && a && (
        <>
          <Card title="Motion the camera saw" icon={<ScanLine size={15} />} sub={`${num(a.rms_px, 2)} px rms${a.shake_removed ? ", hand shake removed" : ""}`}>
            <SpectrumChart freq={a.spectrum.hz} series={[{ id: "px", label: "Motion in the picture (px)", values: a.spectrum.px, tone: "text", fill: true }]} markers={a.lines.filter((l) => l.clear).map((l) => ({ hz: l.seen_hz, label: `${l.order}×` }))} height={200} />
            <div style={{ marginTop: 12 }}>
              <Details summary={`Shaft lines · ${a.lines.length}`}>
                <div className="table-wrap">
                  <table className="table compact">
                    <thead>
                      <tr>
                        <th>Line</th>
                        <th className="t-num">Real frequency</th>
                        <th className="t-num">Seen by the camera at</th>
                        <th className="t-num">Size</th>
                        <th>Clear</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.lines.map((l) => (
                        <tr key={l.order}>
                          <td className="mono">{l.order}× shaft</td>
                          <td className="t-num">{num(l.true_hz, 1)} Hz</td>
                          <td className="t-num">{num(l.seen_hz, 1)} Hz</td>
                          <td className="t-num">{num(l.amp, 3)} px</td>
                          <td>{l.clear ? <Badge tone="ok">yes</Badge> : <span className="dim">no</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Details>
            </div>
          </Card>
          <div className="grid-2">
            <Scores title="By motion" rows={a.camera} note="How well each fault's simulated motion agrees with the picture." />
            <Scores title="By sound" rows={a.sound} note={a.sound_note} />
          </div>
        </>
      )}
      {shown === "clip" && (
        <>
          <div className="stats">
            <Stat label="Shaft speed" value={a ? num(a.rpm, 0) : "–"} unit={a ? "rpm" : undefined} sub={a ? a.speed_note || "as confirmed" : "not confirmed yet"} />
            <Stat
              label={
                <span className="tr-with-hint">
                  Frame rate<Hint label="Why the frame rate matters">A camera sees only motion slower than half its frame rate.</Hint>
                </span>
              }
              value={num(s.fps, 0)}
              unit="frames/s"
            />
            <Stat label="Clip" value={num(s.duration_s, 1)} unit="s" sub={`${s.size[0]}×${s.size[1]}`} />
            <Stat label="Sound" value={<span style={{ fontSize: "var(--fs-20)" }}>{s.audio_fs > 0 ? "recorded" : "none"}</span>} sub={s.audio_fs > 0 ? `${num(s.audio_fs / 1000, 1)} kHz` : "no audio track"} />
          </div>
          <div className="grid-2" style={{ alignItems: "start" }}>
            <Card title="The clip">
              {s.stills === 0 ? (
                <span className="dim">No still was kept.</span>
              ) : (
                <div className="tr-stills">
                  {Array.from({ length: Math.min(3, s.stills) }, (_, i) => (
                    <img key={i} className="still" src={scanStillUrl(s.id, i)} alt={`Still ${i + 1} from the clip`} loading="lazy" />
                  ))}
                </div>
              )}
            </Card>
            <Card title="Seen in the clip" actions={<Badge tone="warn">unconfirmed</Badge>}>
              <dl className="tr-defs" style={{ marginTop: 0 }}>
                <dt>Machine</dt>
                <dd>{s.identity.machine_type || "not named"}</dd>
                <dt>Nameplate</dt>
                <dd>{s.identity.nameplate_text || "not read"}</dd>
                <dt>Looked at by</dt>
                <dd>{by ?? "no model"}</dd>
                <dt>Box from</dt>
                <dd>{s.box_source}</dd>
              </dl>
              {s.identity.note && <p className="small dim" style={{ marginTop: 8 }}>{s.identity.note}</p>}
              {look && look.findings.length > 0 && (
                <ul className="col" style={{ marginTop: 10 }}>
                  {look.findings.map((f, i) => (
                    <li key={i}>
                      <Badge tone={f.hazard ? "danger" : "warn"}>{f.item}</Badge> {f.what} <span className="dim">· check before acting</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          {s.notes.length > 0 && (
            <Card title="Notes on the clip" flush>
              <ul className="tr-rows">
                {s.notes.map((n, i) => (
                  <li key={i} className="muted">
                    {n}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Scores({ title, rows, note }: { title: string; rows: { kind: string; label: string; score: number }[]; note: string }) {
  return (
    <Card title={title} flush actions={rows.length > 0 && note ? <Hint>{note}</Hint> : undefined}>
      {rows.length === 0 ? (
        <Empty left title="Nothing to score">
          {note || "This clip gave nothing to compare."}
        </Empty>
      ) : (
        <table className="table compact">
          <tbody>
            {rows.map((r) => (
              <tr key={r.kind}>
                <td className="strong">{fault(r.kind).name}</td>
                <td className="t-num">{num(r.score, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
