// "New case": feed a fault to the pump model and choose who investigates it.

import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { Bot, Dices, FlaskConical, Play, UserRound } from "lucide-react";
import type { RunParams } from "../api/types";
import { openAgentsCase, openEngineCase } from "../lib/launch";
import { fault as faultText } from "../lib/plain";
import { FLOOR, OFF_LIST, ON_LIST, SEVERITY, isOnList, type AnyFault, type Investigator } from "../lib/scenarios";
import { Button, Callout, Dialog, Seg, cx } from "../ui/kit";

type Preset = { investigator?: Investigator; fault?: AnyFault | "hidden" };

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

export function Launcher() {
  const { open, preset } = useSyncExternalStore(subscribe, () => state, () => state);
  const navigate = useNavigate();
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
    setWho(preset.investigator ?? "agents");
    setFault(preset.fault ?? "hidden");
    setError(null);
  }, [open, preset]);

  const close = () => !busy && set({ open: false, preset: {} });

  function chooseFault(f: AnyFault | "hidden") {
    setFault(f);
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
      const id =
        who === "agents"
          ? await openAgentsCase(params, { note: note.trim() || undefined, revealed: !hidden })
          : await openEngineCase(params, { revealed: !hidden });
      set({ open: false, preset: {} });
      navigate(`/cases/${id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const offListChosen = fault !== "hidden" && !isOnList(fault);

  return (
    <Dialog
      open={open}
      onClose={close}
      wide
      title="New case"
      sub="Feed a fault to the pump model and choose who investigates it."
      foot={
        <>
          <span className="small dim grow">The pump is a physics model, so its readings are synthetic.</span>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Play size={14} />} busy={busy} onClick={start}>
            {who === "agents" ? "Send to the agents" : "Open the case"}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <div className="field">
          <span className="label">Who investigates</span>
          <div className="choices" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <button type="button" className={cx("choice", who === "agents" && "on")} onClick={() => setWho("agents")}>
              <b className="row">
                <Bot size={15} /> The agents, on their own
              </b>
              <span>An investigator and a critic drive the engine's tools. The pump model's instrument answers any measurement they ask for.</span>
            </button>
            <button type="button" className={cx("choice", who === "engine" && "on")} disabled={offListChosen} onClick={() => setWho("engine")} style={offListChosen ? { opacity: 0.5 } : undefined}>
              <b className="row">
                <UserRound size={15} /> The engine, with you
              </b>
              <span>{offListChosen ? "A fault off the engine's list needs the agents: only they can write a new suspect." : "The engine runs the experiments. When it needs a measurement it asks you."}</span>
            </button>
          </div>
        </div>

        <div className="field">
          <span className="label">What is wrong with the pump</span>
          <div className="choices">
            <button type="button" className={cx("choice", fault === "hidden" && "on")} onClick={() => chooseFault("hidden")}>
              <b className="row">
                <Dices size={14} /> Hidden
              </b>
              <span>Picked at random; revealed when you ask</span>
            </button>
            {ON_LIST.map((f) => (
              <button key={f} type="button" className={cx("choice", fault === f && "on")} onClick={() => chooseFault(f)}>
                <b>{faultText(f).name}</b>
                <span>{faultText(f).technical}</span>
              </button>
            ))}
            {OFF_LIST.map((f) => (
              <button key={f} type="button" className={cx("choice", fault === f && "on")} onClick={() => chooseFault(f)}>
                <b>{faultText(f).name}</b>
                <span className="t-model">not on the engine's list</span>
              </button>
            ))}
          </div>
        </div>

        <div className="row row-wrap gap-4 row-top">
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
                  { id: "new", label: "New each time" },
                  { id: "pinned", label: "Pinned" },
                ]}
                label="Capture"
              />
              {seedMode === "pinned" && (
                <input className="input num" style={{ width: 84 }} type="number" min={1} value={seed} onChange={(e) => setSeed(Math.max(1, Number(e.target.value) || 1))} aria-label="Seed" />
              )}
            </div>
          </div>
        </div>

        {who === "agents" && (
          <div className="field">
            <label className="label" htmlFor="launch-note">
              A note for the case <span className="dim">(optional)</span>
            </label>
            <input id="launch-note" className="input" value={note} maxLength={600} onChange={(e) => setNote(e.target.value)} placeholder="What someone saw, heard or smelt. Kept on the case; never evidence." />
          </div>
        )}

        {error && (
          <Callout tone="danger" icon={<FlaskConical size={15} />}>
            {error}
          </Callout>
        )}
      </div>
    </Dialog>
  );
}
