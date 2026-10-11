// Try it: feed a fault to the physics-model pump and watch Crux work it out.
// The visitor chooses what's wrong, how bad, where it runs and who
// investigates; "Break it" opens the case. Crux is never told the fault: the
// capture is made from it, and the engine sees only the capture.

import { useState } from "react";
import { AI_JOBS, brainOf, type Brain } from "../app/ai";
import { useDataNote } from "../app/DataNote";
import { useHealth } from "../lib/hooks";
import { Section } from "../ui/Section";
import { SourceTag } from "../ui/SourceTag";
import { ErrorState } from "../ui/States";
import { ChoiceGroup, type Group } from "./try/ChoiceGroup";
import { NoteField } from "./try/NoteField";
import {
  CAPTURE_GROUPS,
  FAULT_GROUPS,
  FLOOR_GROUPS,
  SEVERITY_GROUPS,
  START_SETUP,
  isOffList,
  type Setup,
  type Who,
} from "./try/options";
import { RunTag } from "./try/RunTag";
import { Specimen } from "./try/Specimen";
import { investigatorFor, useBreak } from "./try/useBreak";
import s from "./Try.module.css";

const NOTE =
  "The pump here is a physics model, so every capture is synthetic. Crux is never told the fault; the engine runs on this server and nothing here sends a command to a machine.";

function aiHint(loaded: boolean, brain: Brain): string {
  if (!loaded) return "An AI drives the same tools, and the physics still decides every belief.";
  return brain.live ? `${brain.name} drives the same tools, and the physics still decides every belief.` : AI_JOBS[0].instead;
}

export default function Try() {
  useDataNote(NOTE);
  const health = useHealth();
  const brain = brainOf(health.data?.models.investigator);
  const brainName = health.data ? brain.name : health.error ? "not reported" : "checking";
  const [setup, setSetup] = useState<Setup>(START_SETUP);
  const { busy, error, run } = useBreak();

  const set = (patch: Partial<Setup>) => setSetup((cur) => ({ ...cur, ...patch }));
  const who = investigatorFor(setup);
  const offList = isOffList(setup.choice);

  const whoGroups: Group<Who>[] = [
    {
      columns: 2,
      options: [
        {
          value: "engine",
          label: "Crux's engine, with you answering any check",
          hint: "The physics decides. If it needs a measurement, you take it here or on a phone.",
          disabled: offList,
        },
        { value: "ai", label: "The AI investigator", tag: brainName, hint: aiHint(!!health.data, brain) },
      ],
    },
  ];

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div className={s.titleRow}>
          <h1 className={s.title}>Break the pump</h1>
          <SourceTag>physics model · synthetic</SourceTag>
        </div>
        <p className={s.lead}>
          Choose a fault for the pump and watch Crux work out what it is. Crux is never told the fault. It sees only what a
          sensor on the pump would show.
        </p>
      </header>

      <div className={s.bench}>
        <div className={s.specimen}>
          <Specimen className={s.scene} choice={setup.choice} severity={setup.severity} floor={setup.floor} />
          <RunTag className={s.runTag} setup={setup} who={who} brain={brainName} busy={busy} onBreak={() => void run(setup)} />
          {error !== null && <ErrorState error={error} title="Couldn't start the case" onRetry={() => void run(setup)} />}
        </div>

        <div className={s.choices}>
          <Section title="What's wrong" id="try-fault">
            <ChoiceGroup name="fault" labelledBy="try-fault" value={setup.choice} onChange={(choice) => set({ choice })} groups={FAULT_GROUPS} />
          </Section>

          <div className={s.pair}>
            <Section title="How bad" id="try-severity">
              <ChoiceGroup
                name="severity"
                labelledBy="try-severity"
                value={setup.severity}
                onChange={(severity) => set({ severity })}
                groups={SEVERITY_GROUPS}
              />
            </Section>
            <Section title="Where it runs" id="try-floor">
              <ChoiceGroup name="floor" labelledBy="try-floor" value={setup.floor} onChange={(floor) => set({ floor })} groups={FLOOR_GROUPS} />
            </Section>
          </div>

          <Section title="Who investigates" id="try-who">
            <ChoiceGroup name="who" labelledBy="try-who" value={who} onChange={(next) => set({ who: next })} groups={whoGroups} />
            <div aria-live="polite">
              {offList && (
                <p className={s.why}>
                  This isn't one of Crux's six causes. Only the AI investigator can write a new suspect for the physics to
                  test, so it takes this case.
                </p>
              )}
            </div>
            {who === "ai" && <NoteField value={setup.note} onChange={(note) => set({ note })} />}
          </Section>

          <Section title="The capture" id="try-capture">
            <ChoiceGroup
              name="capture"
              labelledBy="try-capture"
              value={setup.pinned}
              onChange={(pinned) => set({ pinned })}
              groups={CAPTURE_GROUPS}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
