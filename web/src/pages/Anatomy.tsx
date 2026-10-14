// Anatomy: Crux explained as small machines you can watch. Each figure is built
// from the engine's own numbers, so what moves on screen is what the engine
// computes. Below them, the figures the same kit could draw next, each with the
// idea it explains, where it would sit and what it would read.

import { useRef, useState, type ReactNode } from "react";
import { Box, Download, Gauge, Hourglass, Scale, Ruler, Wrench } from "lucide-react";
import { useCatalogue, useMachineModel } from "../lib/hooks";
import type { Async } from "../lib/hooks";
import { BearingFigure } from "../figures/bearing/BearingFigure";
import { SensorFigure } from "../figures/sensor/SensorFigure";
import { downloadSvg } from "../figures/exportSvg";
import { Badge, Button, Card, ErrorState, PageHead, SkeletonRows, Tabs } from "../ui/kit";
import "./pages.css";
import "./anatomy.css";

function Loaded<T>({ a, empty, children }: { a: Async<T>; empty: string; children: (d: NonNullable<T>) => ReactNode }) {
  if (a.error) return <ErrorState error={a.error} onRetry={a.reload} />;
  if (a.loading) return <SkeletonRows rows={6} />;
  if (!a.data) return <p className="muted">{empty}</p>;
  return <>{children(a.data as NonNullable<T>)}</>;
}

function FigureCard({ title, icon, file, uses, children }: { title: string; icon: ReactNode; file: string; uses: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <Card
      title={title}
      icon={icon}
      actions={
        <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={() => ref.current && downloadSvg(ref.current, file)} title="This instant, in the theme on screen, as an SVG for slides">
          SVG
        </Button>
      }
      foot={<span className="small muted">{uses}</span>}
    >
      <div ref={ref}>{children}</div>
    </Card>
  );
}

type Idea = { icon: ReactNode; title: string; object: string; shows: string; goes: string; reads: string };

const IDEAS: Idea[] = [
  {
    icon: <Gauge size={15} />,
    title: "Six suspects on one bench",
    object: "Six copies of the rig on a long bench, each with one fault fitted: a loose foot, an offset coupling, a weight on the fan, a pitted outer race, a pitted inner race, and none. Each drives a pen recorder with its simulated trace; the real capture runs on a seventh, and the copies whose trace does not match go dim.",
    shows: "How the virtual experiments narrow the suspects before anyone is asked for anything.",
    goes: "A case's experiments stage, and the opening of the video.",
    reads: "Each suspect's simulated trace and its score in the case.",
  },
  {
    icon: <Scale size={15} />,
    title: "The balance behind glass",
    object: "A beam balance in a glass case. The engine sets each measured reading on the pans; the AI investigator can point at the weights through the glass but has no way in.",
    shows: "That an AI never moves a belief: only simulation and measurements do.",
    goes: "How Crux works, and the trust slide in the deck.",
    reads: "The case's evidence log and the belief in each suspect.",
  },
  {
    icon: <Ruler size={15} />,
    title: "Gauge blocks for the next check",
    object: "A row of gauge blocks on a surface plate, one per check: each as tall as its answer would split the suspects and as wide as the minutes it takes. The block that stands tallest per minute is lifted out.",
    shows: "Why Crux asks for one check, and which one.",
    goes: "A case's one-check stage, and the work order that carries it.",
    reads: "The engine's expected gain per minute for every check in that case.",
  },
  {
    icon: <Hourglass size={15} />,
    title: "A float in a sight glass",
    object: "A tall sight glass on the machine with a float rising toward a red line, and a shaded band around it for the forecast's range.",
    shows: "How long until the vibration reaches the danger line, and how sure that is.",
    goes: "The maintenance view and Trends.",
    reads: "The time-left forecast and its calibrated range.",
  },
  {
    icon: <Wrench size={15} />,
    title: "Before and after the repair",
    object: "Figure 1 twice, side by side: the pitted ring knocking on the dial, then the new ring quiet, with the same pickup and the same dial.",
    shows: "That a case closes on a measurement, not on a promise.",
    goes: "A work order's close-out.",
    reads: "The repair check's capture against the machine's own normal.",
  },
];

type Tab = "bearing" | "sensor" | "next";

export default function Anatomy() {
  const [tab, setTab] = useState<Tab>("bearing");
  const machine = useMachineModel();
  const catalogue = useCatalogue();
  return (
    <div className="page an-page">
      <PageHead title="Anatomy" sub="Crux, drawn as machines you can watch. Every figure is built from the engine's own numbers." />

      <Tabs
        value={tab}
        onChange={setTab}
        label="Anatomy"
        tabs={[
          { id: "bearing", label: "The bearing" },
          { id: "sensor", label: "Where the sensor goes" },
          { id: "next", label: "Coming next" },
        ]}
      />

      {tab === "bearing" && (
        <FigureCard title="The bearing the engine listens to" icon={<Box size={15} />} file="crux-bearing" uses="Could also sit on a case's reading stage, with the part a verdict names lit, and open the video.">
          <Loaded a={machine} empty="The engine did not send its machine model, so there is nothing true to draw.">
            {(m) => <BearingFigure model={m} />}
          </Loaded>
        </FigureCard>
      )}

      {tab === "sensor" && (
        <FigureCard title="Where to put the sensor" icon={<Ruler size={15} />} file="crux-checks" uses="Could also sit on a work order and the phone check, as the picture beside each step.">
          <Loaded a={catalogue} empty="The engine sent no catalogue of checks.">
            {(tests) => (
              <Loaded a={machine} empty="The engine did not send its machine model.">
                {(m) => <SensorFigure tests={tests} blades={m.blade_count} />}
              </Loaded>
            )}
          </Loaded>
        </FigureCard>
      )}

      {tab === "next" && (
        <section className="col gap-3">
          <div className="col gap-1">
            <h2 className="an-h2">More the same kit can draw</h2>
            <p className="muted small">Each is one idea in Crux turned into a machine whose working is the idea, read from data the server already sends.</p>
          </div>
          <div className="an-ideas">
            {IDEAS.map((i) => (
              <article className="an-idea" key={i.title}>
                <header className="row gap-3">
                  <span className="an-idea-ico">{i.icon}</span>
                  <h3 className="grow">{i.title}</h3>
                  <Badge plain>Not built</Badge>
                </header>
                <p>{i.object}</p>
                <dl>
                  <dt>Explains</dt>
                  <dd>{i.shows}</dd>
                  <dt>Goes on</dt>
                  <dd>{i.goes}</dd>
                  <dt>Reads</dt>
                  <dd>{i.reads}</dd>
                </dl>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
