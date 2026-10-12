// The virtual experiment, drawn: the measured spectrum against what one
// suspect's simulation predicts. A picture of the fit; no belief depends on it.

import { AudioWaveform } from "lucide-react";
import { capture, spectrum } from "../../api/crux";
import type { FaultKind } from "../../api/types";
import type { CaseModel } from "../../lib/casemodel";
import { num, rpm } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { fault } from "../../lib/plain";
import { isOnList } from "../../lib/scenarios";
import type { CaseEntry } from "../../lib/session";
import { SpectrumChart, Waveform, type Marker } from "../../ui/charts";
import { Card, Empty, Seg, SkeletonRows, SourceTag } from "../../ui/kit";

/** The lines the engine predicted for this machine, read from its ledger. */
function markers(model: CaseModel): Marker[] {
  const find = (re: RegExp) => model.ledger.find((l) => re.test(l.statement) && typeof l.value === "number")?.value as number | undefined;
  const one = find(/shaft frequency \(1x\)/i);
  const out: Marker[] = [];
  if (one) out.push({ hz: one, label: "1×" }, { hz: one * 2, label: "2×" });
  const bpfo = find(/predicted BPFO/i);
  const bpfi = find(/predicted BPFI/i);
  if (bpfo) out.push({ hz: bpfo, label: "BPFO" });
  if (bpfi) out.push({ hz: bpfi, label: "BPFI" });
  return out;
}

export type Band = "raw" | "envelope";

export function SignalCard({ model, entry, picked, band, onBand }: { model: CaseModel; entry: CaseEntry; picked: string | null; band: Band; onBand: (b: Band) => void }) {
  const p = entry.params;
  const drawable = isOnList(p.fault);
  const hypothesis = picked && isOnList(picked) ? picked : "healthy";
  const run = { fault: p.fault as FaultKind, severity: p.severity, seed: p.seed, extra_noise: p.extra_noise };

  const spec = useAsync(() => (drawable ? spectrum({ ...run, hypothesis: hypothesis as FaultKind, band }) : Promise.resolve(null)), [entry.id, hypothesis, band, drawable]);
  const cap = useAsync(() => (drawable ? capture(run) : Promise.resolve(null)), [entry.id, drawable]);

  return (
    <Card
      title="Measured against simulated"
      icon={<AudioWaveform size={15} />}
      actions={
        <>
          <SourceTag source="physics model · synthetic" />
          <Seg
            value={band}
            onChange={onBand}
            options={[
              { id: "envelope", label: "Envelope", title: "The envelope spectrum: where bearing impacts show" },
              { id: "raw", label: "Raw", title: "The raw spectrum: shaft-speed lines" },
            ]}
            label="Spectrum"
          />
        </>
      }
    >
      {!drawable ? (
        <Empty left title="No picture for this case">
          The server draws this comparison only for a fault on the engine's own list. This case was given one that is not on it.
        </Empty>
      ) : spec.loading && !spec.data ? (
        <SkeletonRows rows={5} />
      ) : !spec.data ? (
        <Empty left title="This server does not draw spectra">
          The comparison needs the route the deployed server adds; the API alone does not have it.
        </Empty>
      ) : (
        <>
          <div className="row row-wrap between" style={{ marginBottom: 4 }}>
            <span className="muted">
              Simulated suspect: <b style={{ color: "var(--sim)" }}>{fault(hypothesis).name}</b> <span className="dim">· choose another above</span>
            </span>
          </div>
          <SpectrumChart
            freq={spec.data.freq_hz}
            markers={markers(model)}
            series={[
              { id: "real", label: "Measured", values: spec.data.real, tone: "text", fill: true },
              { id: "sim", label: `Simulated: ${fault(hypothesis).name.toLowerCase()}`, values: spec.data.simulated, tone: "sim" },
            ]}
          />
          <p className="small dim" style={{ marginTop: 8 }}>
            Each trace is peak-held in 2 Hz bins and log-scaled to its own peak, so the chart compares shape, not level. Dashed lines are the frequencies the physics predicts for this machine at {rpm(model.rpm)}.
          </p>
        </>
      )}
      {cap.data && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
          <div className="row between small" style={{ marginBottom: 4 }}>
            <span className="muted">The capture, first {num(cap.data.waveform.length / cap.data.sample_rate_hz, 2)} s</span>
            <span className="dim num">
              level {num(cap.data.rms, 2)} rms{cap.data.temperature_c !== null ? ` · housing ${num(cap.data.temperature_c, 1)} °C` : ""}
            </span>
          </div>
          <Waveform values={cap.data.waveform} />
        </div>
      )}
    </Card>
  );
}
