// Lens: a phone video of a machine, read for motion and sound. The camera
// sees slow motion only, so its result is a screen, and it says what to
// measure next.

import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ChevronRight, ScanLine, Star, Upload } from "lucide-react";
import { ApiError } from "../api/client";
import { LENS_MAX_BYTES, analyseScan, markNormalScan, scan as fetchScan, scanStillUrl, scans as fetchScans, uploadScan } from "../api/crux";
import type { Scan, ScanAnalysis } from "../api/types";
import { num, stamp } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { fault } from "../lib/plain";
import { SpectrumChart } from "../ui/charts";
import { Badge, Button, Callout, Card, Empty, ErrorState, PageHead, SkeletonRows, Stat } from "../ui/kit";
import "./pages.css";

export function Lens() {
  const navigate = useNavigate();
  const list = useAsync(() => fetchScans(), []);
  const file = useRef<HTMLInputElement>(null);
  const [machine, setMachine] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(f: File | undefined) {
    if (!f) return;
    setError(null);
    if (f.size > LENS_MAX_BYTES) return setError("Keep the clip under 32 MB: about ten seconds at 1080p.");
    setProgress(0);
    try {
      const s = await uploadScan(f, machine.trim(), setProgress);
      navigate(`/lens/${s.id}`);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 501 ? "Video support is not installed on this server." : (e as Error).message);
    } finally {
      setProgress(null);
      if (file.current) file.current.value = "";
    }
  }

  return (
    <div className="page">
      <PageHead title="Lens scans" sub="Point a phone at a machine nobody has a sensor on. Crux reads how it shakes and how it sounds, says which faults a camera could and could not see, and names the measurement to take next." />

      <div className="split-even">
        <Card title="Scans on this server" icon={<ScanLine size={15} />} sub="shared by everyone using it" flush>
          {list.error ? (
            <ErrorState error={list.error} onRetry={list.reload} />
          ) : !list.data ? (
            <SkeletonRows />
          ) : list.data.length === 0 ? (
            <Empty icon={<ScanLine size={18} />} title="No scan yet">
              Upload a short clip of a running machine to see what a camera can tell.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>State</th>
                    <th>What it found</th>
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
                          {s.normal && <Badge tone="accent">this machine's normal</Badge>}
                        </span>
                      </td>
                      <td className="muted">{s.summary[0] ?? "–"}</td>
                      <td className="t-num dim-cell">{stamp(s.created)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="New scan" icon={<Upload size={15} />}>
          <div className="col gap-3">
            <div className="field">
              <label className="label" htmlFor="lens-machine">
                Which machine
              </label>
              <input id="lens-machine" className="input" placeholder="For example: exhaust fan F-3" value={machine} onChange={(e) => setMachine(e.target.value)} />
            </div>
            <input ref={file} type="file" accept="video/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
            <Button variant="primary" icon={<Upload size={14} />} busy={progress !== null} onClick={() => file.current?.click()}>
              {progress !== null ? `Uploading ${Math.round(progress * 100)}%` : "Choose a video"}
            </Button>
            <span className="small dim">Hold the phone still for about ten seconds, with the machine filling the frame. Up to 32 MB.</span>
            {error && <Callout tone="danger">{error}</Callout>}
          </div>
        </Card>
      </div>
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

  if (got.error) {
    return (
      <div className="page">
        <ErrorState error={got.error} onRetry={got.reload} />
      </div>
    );
  }
  if (!got.data) {
    return (
      <div className="page">
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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/lens">Lens scans</Link>
        <ChevronRight size={12} aria-hidden />
        <span className="mono">{s.id}</span>
      </nav>
      <PageHead
        title={s.machine || "Unnamed machine"}
        sub={`A ${num(s.duration_s, 1)} s phone clip, taken ${stamp(s.created)}.`}
        actions={
          <>
            {isNormal && <Badge tone="accent">this machine's normal</Badge>}
            <Button icon={<Star size={14} />} busy={busy === "normal"} disabled={isNormal || !a} onClick={markNormal}>
              Keep as this machine's normal
            </Button>
          </>
        }
      />

      <div className="stats">
        <Stat label="Frame rate" value={num(s.fps, 0)} unit="frames/s" sub={`the camera sees motion below ${num(s.fps / 2, 0)} Hz`} />
        <Stat label="Clip" value={num(s.duration_s, 1)} unit="s" sub={`${s.size[0]}×${s.size[1]}`} />
        <Stat label="Shaft speed" value={a ? num(a.rpm, 0) : "–"} unit={a ? "rpm" : undefined} sub={a ? a.speed_note || "as confirmed" : "not confirmed yet"} />
        <Stat label="Sound" value={<span style={{ fontSize: "1.25rem" }}>{s.audio_fs > 0 ? "recorded" : "none"}</span>} sub={s.audio_fs > 0 ? `${num(s.audio_fs / 1000, 1)} kHz` : "the clip has no audio track"} />
      </div>

      {error && <Callout tone="danger">{error}</Callout>}

      <div className="split">
        <div className="col" style={{ gap: "var(--s-5)" }}>
          {!a ? (
            <Card title="Confirm the shaft speed" icon={<ScanLine size={15} />} tone="warn">
              <p className="muted">Crux needs the shaft speed to know which motion is which. It found these rhythms in the picture; choose the one that is the shaft turning once, or type the speed.</p>
              <div className="row row-wrap" style={{ marginTop: 12 }}>
                {s.candidates.map((c) => (
                  <Button key={c.hz} busy={busy === "analyse"} onClick={() => analyse(c.rpm_if_1x)}>
                    {num(c.rpm_if_1x, 0)} rpm <span className="dim">· {num(c.hz, 1)} Hz</span>
                  </Button>
                ))}
                <input className="input num" style={{ width: 120 }} placeholder="or rpm" value={rpm} onChange={(e) => setRpm(e.target.value)} aria-label="Shaft speed in rpm" />
                <Button variant="primary" disabled={!(Number(rpm) > 0)} busy={busy === "analyse"} onClick={() => analyse(Number(rpm))}>
                  Analyse
                </Button>
              </div>
            </Card>
          ) : (
            <>
              <Card title="What Crux found" icon={<ScanLine size={15} />} actions={<Badge tone="accent">the engine's words</Badge>}>
                <ul className="col gap-3">
                  {a.summary.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
                {a.camera_blind && (
                  <div style={{ marginTop: 12 }}>
                    <Callout tone="warn">In this clip the camera cannot tell the once-per-turn line from the twice-per-turn line, or the once-per-turn line is not clear. Motion therefore rules nothing out here.</Callout>
                  </div>
                )}
                {a.next_check && (
                  <div style={{ marginTop: 14 }}>
                    <Callout tone="accent">
                      <b>Measure next: {a.next_check.name}.</b> {a.next_check.procedure.join(" ")}
                    </Callout>
                  </div>
                )}
              </Card>

              <Card title="Motion the camera saw" icon={<ScanLine size={15} />} sub={`${num(a.rms_px, 2)} px rms${a.shake_removed ? ", hand shake removed" : ""}`}>
                <SpectrumChart freq={a.spectrum.hz} series={[{ id: "px", label: "Motion in the picture (px)", values: a.spectrum.px, tone: "text", fill: true }]} markers={a.lines.filter((l) => l.clear).map((l) => ({ hz: l.seen_hz, label: `${l.order}×` }))} height={200} />
                <table className="table compact" style={{ marginTop: 12 }}>
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th className="t-num">Real frequency</th>
                      <th className="t-num">Where the camera sees it</th>
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
              </Card>

              <div className="grid-2">
                <Scores title="By motion" rows={a.camera} note="How well each fault's simulated motion agrees with the picture." />
                <Scores title="By sound" rows={a.sound} note={a.sound_note} />
              </div>

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
            </>
          )}
        </div>

        <aside className="col rail" style={{ gap: "var(--s-5)" }}>
          <Card title="The clip" flush>
            <div className="col" style={{ padding: 12 }}>
              {Array.from({ length: Math.min(3, s.stills) }, (_, i) => (
                <img key={i} className="still" src={scanStillUrl(s.id, i)} alt={`Still ${i + 1} from the clip`} loading="lazy" />
              ))}
              {s.stills === 0 && <span className="dim">No still was kept.</span>}
            </div>
          </Card>

          <Card title="What the model saw" sub="unconfirmed">
            <dl className="defs">
              <dt>Machine</dt>
              <dd>{s.identity.machine_type || "not named"}</dd>
              <dt>Nameplate</dt>
              <dd>{s.identity.nameplate_text || "not read"}</dd>
              <dt>Found by</dt>
              <dd>{s.identity.by && s.identity.by !== "nobody" ? s.identity.by : `no model; the box is ${s.box_source}`}</dd>
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

          {s.notes.length > 0 && (
            <Card title="Notes on the clip" flush>
              <ul className="list">
                {s.notes.map((n, i) => (
                  <li key={i} className="muted">
                    {n}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function Scores({ title, rows, note }: { title: string; rows: { kind: string; label: string; score: number }[]; note: string }) {
  return (
    <Card title={title} flush foot={note || undefined}>
      {rows.length === 0 ? (
        <Empty left title="Nothing to score">
          This clip gave nothing to compare.
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
