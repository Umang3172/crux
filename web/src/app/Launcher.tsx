// "Investigate a machine": pick a modelled machine, say what is wrong with it,
// start. Everything else has a default and waits under "Options".

import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { Dices, FlaskConical, Play, Sparkles } from "lucide-react";
import type { RunParams } from "../api/types";
import { openAgentsCase, openEngineCase } from "../lib/launch";
import { fault as faultText } from "../lib/plain";
import { MODELLED } from "../lib/plant";
import { FLOOR, OFF_LIST, ON_LIST, SEVERITY, isOnList, type AnyFault, type Investigator } from "../lib/scenarios";
import { MachineGlyph } from "../ui/MachineGlyph";
import { Button, Callout, Details, Dialog, Seg, cx } from "../ui/kit";
import "../styles/viz.css";

type Preset = { investigator?: Investigator; fault?: AnyFault | "hidden"; machine?: string };

let state: { open: boolean; preset: Preset } = { open: false, preset: {} };
const listeners = new Set<() => void>();
const set = (next: typeof state) => {
  state = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const openLauncher = (preset: Preset = {}) => set({ open: true, preset });

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
const WHO: { id: Investigator; label: string }[] = [
  { id: "agents", label: "Crux's AI" },
  { id: "engine", label: "Engine + technician" },
];

export function Launcher() {
  const { open, preset } = useSyncExternalStore(subscribe, () => state, () => state);
  const navigate = useNavigate();
  const [machine, setMachine] = useState("p2");
  const [who, setWho] = useState<Investigator>("agents");
  const [fault, setFault] = useState<AnyFault | "hidden">("hidden");
  const [severity, setSeverity] = useState<(typeof SEVERITY)[number]["id"]>("severe");
  const [floor, setFloor] = useState<(typeof FLOOR)[number]["id"]>("quiet");
  const [seedMode, setSeedMode] = useState<"new" | "pinned">("new");
  const [seed, setSeed] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMachine(preset.machine ?? "p2");
    setWho(preset.investigator ?? "agents");
    setFault(preset.fault ?? "hidden");
    setError(null);
  }, [open, preset]);

  const close = () => !busy && set({ open: false, preset: {} });
  const offList = fault !== "hidden" && !isOnList(fault);

  function chooseFault(f: AnyFault | "hidden") {
    setFault(f);
    // Only Crux's AI can write a suspect the engine's list does not have.
    if (f !== "hidden" && !isOnList(f)) setWho("agents");
  }

  async function start() {
    setBusy(true);
    setError(null);
    const hidden = fault === "hidden";
    const chosen: AnyFault = hidden ? pick(who === "agents" ? [...ON_LIST, ...OFF_LIST] : ON_LIST) : fault;
    const params: RunParams = {
      fault: chosen,
      severity: SEVERITY.find((s) => s.id === severity)!.value,
      extra_noise: FLOOR.find((f) => f.id === floor)!.value,
      seed: seedMode === "pinned" ? seed : Math.floor(Math.random() * 9000) + 1,
    };
    try {
      // The fault fed in is an answer key: shown only when the person chose it.
      const id =
        who === "agents"
          ? await openAgentsCase(params, { machine, note: note.trim() || undefined, revealed: !hidden })
          : await openEngineCase(params, { machine, revealed: !hidden });
      set({ open: false, preset: {} });
      navigate(`/cases/${id}`, { viewTransition: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const summary = [
    WHO.find((w) => w.id === who)!.label,
    SEVERITY.find((s) => s.id === severity)!.label,
    FLOOR.find((f) => f.id === floor)!.label,
    seedMode === "pinned" ? `capture ${seed}` : "new capture",
  ].join(" · ");

  return (
    <Dialog
      open={open}
      onClose={close}
      wide
      title="Investigate a machine"
      foot={
        <>
          <span className="small dim grow">Modelled machines: readings are synthetic.</span>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Play size={14} />} busy={busy} onClick={start}>
            Start investigation
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <div className="field">
          <span className="label">Machine</span>
          <div className="pick-machines">
            {MODELLED.map((m) => (
              <button key={m.id} type="button" className={cx("pick-machine", machine === m.id && "on")} aria-pressed={machine === m.id} onClick={() => setMachine(m.id)} title={m.type}>
                <MachineGlyph kind={m.kind} tone={machine === m.id ? "accent" : "neutral"} />
                {m.name}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">What is wrong</span>
          <div className="pick-faults">
            <button type="button" className={cx("pick-fault", fault === "hidden" && "on")} aria-pressed={fault === "hidden"} onClick={() => chooseFault("hidden")} title="Picked at random and kept hidden until you reveal it">
              <Dices size={14} aria-hidden />
              Hidden
            </button>
            {[...ON_LIST, ...OFF_LIST].map((f) => (
              <button key={f} type="button" className={cx("pick-fault", fault === f && "on")} aria-pressed={fault === f} onClick={() => chooseFault(f)} title={isOnList(f) ? faultText(f).technical : "Not on the engine's list: only Crux's AI can take it"}>
                {faultText(f).name}
                {!isOnList(f) && <Sparkles size={13} className="t-model" aria-label="Crux's AI only" />}
              </button>
            ))}
          </div>
          <span className="small dim row gap-1">
            <Sparkles size={12} className="t-model" aria-hidden /> Not on the engine's list: Crux's AI only.
          </span>
        </div>

        <div className="launch-options">
          <Details
            summary={
              <>
                Options <span className="launch-sum">· {summary}</span>
              </>
            }
          >
            <div className="field">
              <span className="label">Who investigates</span>
              <div className="seg" role="group" aria-label="Who investigates">
                {WHO.map((w) => {
                  const barred = w.id === "engine" && offList;
                  return (
                    <button key={w.id} type="button" className={who === w.id ? "on" : undefined} aria-pressed={who === w.id} disabled={barred} title={barred ? "This fault needs Crux's AI" : undefined} onClick={() => setWho(w.id)}>
                      {w.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="field">
              <span className="label">How bad</span>
              <Seg value={severity} onChange={setSeverity} options={SEVERITY.map((s) => ({ id: s.id, label: s.label }))} label="How bad" />
            </div>
            <div className="field">
              <span className="label">Where it runs</span>
              <Seg value={floor} onChange={setFloor} options={FLOOR.map((s) => ({ id: s.id, label: s.label }))} label="Where it runs" />
            </div>
            <div className="field">
              <span className="label">Capture</span>
              <div className="row">
                <Seg
                  value={seedMode}
                  onChange={setSeedMode}
                  options={[
                    { id: "new", label: "New" },
                    { id: "pinned", label: "Pinned" },
                  ]}
                  label="Capture"
                />
                {seedMode === "pinned" && (
                  <input className="input num" style={{ width: 84 }} type="number" min={1} value={seed} onChange={(e) => setSeed(Math.max(1, Number(e.target.value) || 1))} aria-label="Seed" />
                )}
              </div>
            </div>
            {who === "agents" && (
              <div className="field wide">
                <label className="label" htmlFor="launch-note">
                  Note
                </label>
                <input id="launch-note" className="input" value={note} maxLength={600} onChange={(e) => setNote(e.target.value)} placeholder="What someone saw, heard or smelt. Kept with it; never evidence." />
              </div>
            )}
          </Details>
        </div>

        {error && (
          <Callout tone="danger" icon={<FlaskConical size={15} />}>
            {error}
          </Callout>
        )}
      </div>
    </Dialog>
  );
}
