// The virtual experiment, drawn: the measured spectrum against what one
// suspect's simulation predicts. A picture of the fit; no belief depends on it.

import { AudioWaveform } from "lucide-react";
import { capture, spectrum } from "../../api/crux";
import type { Capture, FaultKind, RunParams, Spectrum } from "../../api/types";
import type { CaseModel } from "../../lib/casemodel";
import { num, rpm } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { fault } from "../../lib/plain";
import { isOnList } from "../../lib/scenarios";
import type { CaseEntry } from "../../lib/session";
import { SpectrumChart, Waveform, type Marker } from "../../ui/charts";
import { Card, Empty, Hint, Seg, SkeletonRows, SourceTag } from "../../ui/kit";

// The same request always draws the same picture, so a tab opened again does not ask twice.
const spectra = new Map<string, Promise<Spectrum | null>>();
const captures = new Map<string, Promise<Capture | null>>();
const once = <T,>(store: Map<string, Promise<T>>, key: string, load: () => Promise<T>) => {
  let p = store.get(key);
  if (!p) {
    p = load();
    p.catch(() => store.delete(key));
    store.set(key, p);
  }
  return p;
};
type SpecParams = RunParams & { fault: FaultKind; hypothesis: FaultKind; band: "raw" | "envelope" };
export const spectrumOf = (p: SpecParams) => once(spectra, JSON.stringify(p), () => spectrum(p));
const captureOf = (p: RunParams & { fault: FaultKind }) => once(captures, JSON.stringify(p), () => capture(p));

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
  const run = { fault: p.fault as FaultKind, severity: p.severity, seed: p.seed, extra_noise: p.extra_noise, rpm: p.rpm };

  const spec = useAsync(() => (drawable ? spectrumOf({ ...run, hypothesis: hypothesis as FaultKind, band }) : Promise.resolve(null)), [entry.id, hypothesis, band, drawable]);
  const cap = useAsync(() => (drawable ? captureOf(run) : Promise.resolve(null)), [entry.id, drawable]);

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
          <Hint label="About this chart">
            Pick a suspect above to simulate another. Each trace is peak-held in 2 Hz bins and log-scaled to its own peak. Dashed lines are the frequencies the physics predicts at {rpm(model.rpm)}.
          </Hint>
        </>
      }
      foot={drawable && spec.data ? "Shape, not level: each trace is scaled to its own peak." : undefined}
    >
      {!drawable ? (
        <Empty left title="No picture for this reading" />
      ) : spec.loading && !spec.data ? (
        <SkeletonRows rows={5} />
      ) : !spec.data ? (
        <Empty left title="No spectrum on this server" />
      ) : (
        <SpectrumChart
          freq={spec.data.freq_hz}
          markers={markers(model)}
          series={[
            { id: "real", label: "Measured", values: spec.data.real, tone: "text", fill: true },
            { id: "sim", label: `Simulated: ${fault(hypothesis).name.toLowerCase()}`, values: spec.data.simulated, tone: "sim" },
          ]}
        />
      )}
      {cap.data && (
        <div className="signal-wave">
          <div className="row between small">
            <span className="muted">The capture, first {num(cap.data.waveform.length / cap.data.sample_rate_hz, 2)} s</span>
            <span className="dim num">
              {num(cap.data.rms, 2)} rms{cap.data.temperature_c !== null ? ` · housing ${num(cap.data.temperature_c, 1)} °C` : ""}
            </span>
          </div>
          <Waveform values={cap.data.waveform} />
        </div>
      )}
    </Card>
  );
}
