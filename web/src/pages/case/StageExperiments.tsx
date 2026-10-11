import { useEffect, useState } from "react";
import { spectrum } from "../../api/crux";
import type { FaultKind, Investigation } from "../../api/types";
import type { CaseEntry } from "../../demo/world";
import { pct } from "../../lib/format";
import { useAsync, useReducedMotion } from "../../lib/hooks";
import { CONCLUDE_AT, fault } from "../../lib/plain";
import { Button } from "../../ui/Button";
import { Section } from "../../ui/Section";
import { SuspectRack } from "../../ui/SuspectRack";
import { beliefsAt, experimentCount, isCatalogue, rackOrder } from "./model";
import { SpectrumPlot, type Marker } from "./Signals";
import s from "./Case.module.css";

export function StageExperiments({
  inv,
  entry,
  evidence,
  onNext,
}: {
  inv: Investigation;
  entry: CaseEntry | undefined;
  evidence: boolean;
  onNext: () => void;
}) {
  const reduce = useReducedMotion();
  const after = beliefsAt(inv, entry?.snapshots, 0);
  const even = 1 / after.length;
  // Start at even odds, then let the experiments move them: the change is the story.
  const [settled, setSettled] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const t = window.setTimeout(() => setSettled(true), 450);
    return () => window.clearTimeout(t);
  }, [reduce]);
  const shown = after.map((b) => ({
    kind: b.kind,
    label: b.label,
    origin: b.origin,
    belief: settled ? b.posterior : even,
    ruledOut: settled && b.rejected,
  }));
  const lead = [...after].sort((a, b) => b.posterior - a.posterior)[0];
  const count = experimentCount(inv);
  const fits = inv.ledger.filter((e) => e.source === "virtual_experiment");

  return (
    <div className={s.stage}>
      <h2 className={s.h2}>Every suspect tested on a virtual copy</h2>
      <p className={s.lead}>
        {count
          ? `Crux simulated this pump with each fault and compared ${count.captures} simulated captures with the real one, across ${count.lines} lines each fault predicts.`
          : "Crux simulated this pump with each fault and compared the simulations with the real reading."}{" "}
        A suspect whose simulation can't explain the reading drops away; it stays on the rack in case a later reading brings it back.
      </p>
      <SuspectRack suspects={shown} order={rackOrder(inv, entry?.snapshots)} caption={`Crux needs ${pct(CONCLUDE_AT)} to name a cause.`} />
      {lead && (
        <p className={s.lead}>
          Most likely so far: <b>{fault(lead.kind).name}</b> at {pct(lead.posterior)}.{" "}
          {lead.posterior < CONCLUDE_AT ? "Not enough to name a cause." : "Enough to name it."}
        </p>
      )}
      {evidence && (
        <>
          <Section title="How well each simulation fits" aside="relative to the best fit; nearer zero is better">
            <div className={s.tableWrap}>
            <table className={s.table}>
              <tbody>
                {fits.map((e) => (
                  <tr key={e.id}>
                    <td className={s.num}>{e.id}</td>
                    <td>{e.statement}</td>
                    <td className={s.num}>
                      {String(e.value)} {e.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Section>
          {entry && isCatalogue(entry.params.fault) && <Spectra inv={inv} entry={entry} kinds={[...after].sort((a, b) => b.posterior - a.posterior).slice(0, 2).map((b) => b.kind)} />}
        </>
      )}
      <div className={s.next}>
        <Button kind="primary" size="l" onClick={onNext}>
          See what Crux does next
        </Button>
      </div>
    </div>
  );
}

/** The real reading against the leading suspects' simulations, envelope band. */
export function Spectra({ inv, entry, kinds }: { inv: Investigation; entry: CaseEntry; kinds: string[] }) {
  const [band, setBand] = useState<"envelope" | "raw">("envelope");
  const catalogue = kinds.filter(isCatalogue);
  const data = useAsync(
    () =>
      Promise.all(
        catalogue.map((k) =>
          spectrum({ ...entry.params, fault: entry.params.fault as FaultKind, hypothesis: k as FaultKind, band }),
        ),
      ),
    [entry.id, band, catalogue.join()],
  );
  const markers: Marker[] = inv.ledger
    .filter((e) => /predicted BPF|shaft frequency/.test(e.statement))
    .map((e) => ({ hz: Number(e.value), label: e.statement.replace("predicted ", "").replace("shaft frequency (1x)", "1×") }));
  const real = data.data?.find(Boolean);
  return (
    <Section
      title="Real against simulated"
      aside={
        <span role="group" aria-label="Band">
          <Button kind={band === "envelope" ? "secondary" : "quiet"} onClick={() => setBand("envelope")}>
            Envelope
          </Button>
          <Button kind={band === "raw" ? "secondary" : "quiet"} onClick={() => setBand("raw")}>
            Raw
          </Button>
        </span>
      }
    >
      {data.loading && <p className={s.muted}>Drawing the simulations…</p>}
      {!data.loading && !real && <p className={s.muted}>This server can't draw the spectra (they need the deployed server's drawing routes).</p>}
      {real && (
        <SpectrumPlot
          real={real}
          markers={markers.filter((m) => m.hz <= real.f_max_hz)}
          sims={catalogue
            .map((k, i) => ({ name: fault(k).name, tone: (k === "healthy" ? "ok" : "attention") as "ok" | "attention", spectrum: data.data?.[i] }))
            .filter((x): x is { name: string; tone: "ok" | "attention"; spectrum: NonNullable<typeof real> } => !!x.spectrum)}
          label={`The ${band} spectrum of this reading against the simulations of the leading suspects`}
        />
      )}
    </Section>
  );
}
