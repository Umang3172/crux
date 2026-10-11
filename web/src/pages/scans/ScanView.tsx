// One scan laid out wide. On the left, the picture and what a model saw in it
// (unconfirmed). On the right, what the physics found in the motion, and the
// one check that would settle what is left. A scan the physics hasn't run on
// asks a person for the shaft speed first.

import { useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client";
import { scan as getScan } from "../../api/crux";
import type { Box, Scan } from "../../api/types";
import { useDataNote } from "../../app/DataNote";
import { stamp } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { Section } from "../../ui/Section";
import { ErrorState, Loading } from "../../ui/States";
import { Tag } from "../../ui/Tag";
import { ConfirmSpeed } from "./ConfirmSpeed";
import { KeepNormal } from "./KeepNormal";
import { ModelLook } from "./ModelLook";
import { NextCheck } from "./NextCheck";
import { Physics } from "./Physics";
import { ScanFigure } from "./ScanFigure";
import { seconds, upperFirst } from "./words";
import s from "./ScanView.module.css";

export function ScanView({ id }: { id: string }) {
  useDataNote(
    "Scans are stored on this server and shared by everyone using this demo. What a model saw in a clip is unconfirmed; the motion and sound readings are the physics model's.",
  );
  const found = useAsync(() => getScan(id), [id]);

  if (found.error && !found.data) {
    const gone = found.error instanceof ApiError && found.error.status === 404;
    return gone ? (
      <ErrorState
        error={new Error("There is no scan with that id on this server. Scans live on the server, so one made on another server won't be here.")}
        title="No such scan"
      />
    ) : (
      <ErrorState error={found.error} onRetry={found.reload} />
    );
  }
  if (!found.data) return <Loading>Reading the scan…</Loading>;
  // Keyed by the scan's analysis, so the box a person placed starts again from the one the server holds.
  return <Laid key={`${found.data.id}-${found.data.analysis ? "analysed" : "open"}`} scan={found.data} reload={found.reload} />;
}

function Laid({ scan, reload }: { scan: Scan; reload: () => void }) {
  const [box, setBox] = useState<Box>(scan.box);
  const analysis = scan.analysis;
  const [w, h] = scan.size;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <Link to="/scans" className={s.back}>
          All scans
        </Link>
        <div className={s.titleRow}>
          <h1 className={s.title}>{scan.machine}</h1>
          {scan.normal && <Tag tone="safety" head="Normal scan" size="rack" as="div" />}
        </div>
        <p className={s.facts}>
          {scan.id} · scanned {stamp(scan.created)} · {seconds(scan.duration_s)} at {Math.round(scan.fps)} frames a second · {w} × {h} ·{" "}
          {scan.audio_fs > 0 ? "with sound" : "no sound track"}
        </p>
        {scan.notes.length > 0 && (
          <ul className={s.notes} aria-label="About this clip">
            {scan.notes.map((n) => (
              <li key={n}>{upperFirst(n)}.</li>
            ))}
          </ul>
        )}
      </header>

      <div className={s.grid}>
        <div className={s.left}>
          <ScanFigure scan={scan} box={analysis ? analysis.box : box} onBox={analysis ? undefined : setBox} />
          <Section id="look" title="What the camera look saw" aside="a model's reading: unconfirmed">
            <ModelLook scan={scan} />
          </Section>
        </div>

        <div className={s.right}>
          <Section id="physics" title="What the physics found" aside="the engine's own numbers">
            {analysis ? (
              <Physics analysis={analysis} />
            ) : (
              <div className={s.ask}>
                <p>
                  The physics hasn't run on this clip yet. It needs the shaft speed from a person, and it measures inside the blue box, which
                  you can move first.
                </p>
                <ConfirmSpeed scan={scan} box={box} onAnalysed={reload} />
              </div>
            )}
          </Section>

          {analysis?.next_check && <NextCheck analysis={analysis} />}

          {analysis && (
            <Section id="normal" title="Normal scan" aside="how this machine looks when it runs well">
              <KeepNormal scan={scan} onKept={reload} />
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
