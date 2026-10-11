// The plant: which machine needs someone now, and the demo in one click. The
// line comes first, as tags hung on a rail: the pump carries the demo's case,
// the recorded bearings carry their health, unmonitored machines stay small.

import { lazy, Suspense, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useDataNote } from "../app/DataNote";
import { launchStory } from "../demo/launch";
import { STORIES, story as storyById } from "../demo/stories";
import { useWorld } from "../demo/world";
import { useReducedMotion } from "../lib/hooks";
import { Button } from "../ui/Button";
import { PumpDrawing } from "../ui/machine/PumpDrawing";
import { Section } from "../ui/Section";
import { ErrorState } from "../ui/States";
import { Tag } from "../ui/Tag";
import { usePlant, type Station, type Status } from "./plant/usePlant";
import p from "./Plant.module.css";

const MachineScene = lazy(() => import("../ui/machine/MachineScene").then((m) => ({ default: m.MachineScene })));

type Shown = Station & { status: Status };

export default function Plant() {
  const world = useWorld();
  const reduce = useReducedMotion();
  const { stations, error } = usePlant();
  const [busy, setBusy] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const navigate = useNavigate();
  useDataNote(
    "Demo plant, Line 2 is fictional. The pump is a physics model (synthetic); the test-bench bearings are real recorded runs (XJTU-SY, NASA IMS) replayed at the plant clock. This page shows only this browser's cases.",
  );

  const shown = stations.filter((x): x is Shown => x.status !== null);
  const needs = shown.filter((x) => x.status.rank <= 3).sort((a, b) => a.status.rank - b.status.rank);
  const waiting = world.workOrders.filter((o) => o.stage === "plan" && !o.approvedBy).length;
  const watched = shown.filter((x) => x.def.kind !== "unmonitored").length;

  async function start(id: string) {
    const s = storyById(id);
    if (!s) return;
    setBusy(id);
    setLaunchError(null);
    try {
      navigate(await launchStory(s));
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : "The story could not start.");
    } finally {
      setBusy(null);
    }
  }

  function act(st: Shown) {
    if (st.status.action.story) void start(st.status.action.story);
    else navigate(st.status.action.to ?? `/machine/${st.def.id}`);
  }

  const columns = shown.map((st) => (st.def.kind === "unmonitored" ? "minmax(120px, 0.55fr)" : st.def.kind === "physics" ? "minmax(0, 2.2fr)" : "minmax(0, 1fr)")).join(" ");

  return (
    <div className={p.page}>
      <header className={p.head}>
        <h1 className={p.pitch}>Crux tests every cause on a virtual copy of the machine, and asks for one measurement only when it can't tell.</h1>
        <p className={p.summary}>
          Demo plant, Line 2 · {watched} of {stations.length} machines watched · <b>{needs.length}</b> {needs.length === 1 ? "needs" : "need"} someone · {waiting}{" "}
          {waiting === 1 ? "work order" : "work orders"} waiting for approval
        </p>
      </header>

      {error && <ErrorState error={error} />}

      <section aria-label="The line" className={p.lineWrap}>
        <div className={p.rail} aria-hidden="true" />
        <ol className={p.line} style={{ gridTemplateColumns: columns }}>
          {shown.map((st) => {
            const feature = st.def.kind === "physics";
            const compact = st.def.kind === "unmonitored";
            const primary = feature || st.status.rank <= 1;
            return (
              <li key={st.def.id} className={[p.station, feature ? p.feature : "", compact ? p.compact : ""].join(" ")}>
                <span className={p.hook} aria-hidden="true" />
                <Tag tone={st.status.tone} head={compact ? "Not monitored" : st.status.label} size="rack" as="div" drop={st.status.rank <= 1}>
                  <Link to={`/machine/${st.def.id}`} className={p.name}>
                    {st.def.name}
                  </Link>
                  {compact ? (
                    <span className={p.note}>No sensor</span>
                  ) : (
                    <>
                      <span className={p.type}>{st.def.type}</span>
                      {feature && (
                        <div className={p.scene}>
                          <Suspense fallback={<PumpDrawing />}>
                            <MachineScene vibration={1} reduceMotion={reduce} className={p.canvas} fallback={<PumpDrawing />} />
                          </Suspense>
                        </div>
                      )}
                      {st.status.figure !== "–" ? (
                        <div className={p.reading}>
                          <span className={p.figure}>{st.status.figure}</span>
                          <span className={p.note}>{st.status.figureNote}</span>
                        </div>
                      ) : null}
                      <p className={p.what}>{st.status.what}</p>
                      <div className={p.act}>
                        <Button
                          kind={primary ? "primary" : "secondary"}
                          size={feature ? "l" : "m"}
                          onClick={() => act(st)}
                          busy={busy !== null && busy === st.status.action.story}
                          disabled={busy !== null}
                        >
                          {busy !== null && busy === st.status.action.story ? "Opening…" : st.status.action.label}
                        </Button>
                      </div>
                      <span className={p.source}>{st.def.source}</span>
                    </>
                  )}
                </Tag>
              </li>
            );
          })}
        </ol>
      </section>

      {needs.length > 0 && (
        <Section title="Needs someone now" aside="most urgent first">
          <ul className={p.needs}>
            {needs.map((st) => (
              <li key={st.def.id} className={p.need}>
                <span className={`${p.dot} ${p[st.status.tone]}`} aria-hidden="true" />
                <span className={p.needName}>{st.def.name}</span>
                <span className={p.needWhat}>
                  <b>{st.status.label}.</b> {st.status.what}
                </span>
                <Button kind={st.status.rank <= 1 ? "primary" : "secondary"} onClick={() => act(st)}>
                  {st.status.action.label}
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Demo stories" aside="each replays the same pinned run, so what you see is what the engine did">
        <div className={p.rail} aria-hidden="true" />
        <ol className={p.stories}>
          {STORIES.map((s, i) => (
            <li key={s.id} className={p.story}>
              <span className={p.hook} aria-hidden="true" />
              <Tag tone={i === 0 ? "measure" : "stock"} head={`Story ${i + 1} · about ${s.minutes} min`} size="rack" as="div">
                <h2 className={p.storyTitle}>{s.title}</h2>
                <p className={p.storyLine}>{s.line}</p>
                <div className={p.act}>
                  <Button kind={i === 0 ? "primary" : "secondary"} onClick={() => start(s.id)} busy={busy === s.id} disabled={busy !== null}>
                    {busy === s.id ? "Starting…" : "Start"}
                  </Button>
                </div>
              </Tag>
            </li>
          ))}
        </ol>
        {launchError && (
          <p className={p.error} role="alert">
            {launchError}
          </p>
        )}
        <p className={p.links}>
          <Link to="/try">Break the pump yourself</Link>
          <Link to="/proof">See the proof</Link>
          <Link to="/how">How it works</Link>
        </p>
      </Section>
    </div>
  );
}
