// Scan a machine from a phone: name it, film about ten seconds, confirm the
// shaft speed, read what Crux found. Reached from the scans page, not from the
// plant, and shared: the scan lands on the server for everyone using the demo.

import { useSearchParams } from "react-router";
import { Clip } from "./lens/Clip";
import { Result } from "./lens/Result";
import { Speed } from "./lens/Speed";
import { Steps } from "./lens/Steps";
import { useFlow } from "./lens/useFlow";
import s from "./lens/Lens.module.css";

export default function PhoneLens() {
  const [search] = useSearchParams();
  const flow = useFlow(search.get("machine") ?? "");
  const { scan, analysis } = flow;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>Scan a machine</h1>
        <p className={s.lead}>Film a machine that has no sensor. Crux measures how its housing shakes from the video.</p>
      </header>
      <Steps stage={flow.stage} />

      {flow.stage === "clip" && (
        <Clip machine={flow.machine} onMachine={flow.setMachine} progress={flow.progress} error={flow.error} onFile={(f) => void flow.send(f)} />
      )}
      {flow.stage === "speed" && scan && <Speed scan={scan} onAnalysed={flow.setAnalysis} />}
      {flow.stage === "found" && scan && analysis && <Result scan={scan} analysis={analysis} onKept={flow.setScan} onAgain={flow.again} />}
    </div>
  );
}
