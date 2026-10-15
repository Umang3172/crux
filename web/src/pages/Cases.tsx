// Every investigation this browser has opened: what it found, where it stands.

import { useState } from "react";
import { useNavigate } from "react-router";
import { FolderOpen, RotateCcw, Sunrise } from "lucide-react";
import { modelOf, type CaseStatus } from "../lib/casemodel";
import { MODELLED, machineOfCase } from "../lib/plant";
import { resetSession, useSession, type CaseEntry } from "../lib/session";
import { startShift } from "../lib/shift";
import { Button, Card, CountUp, Empty, Hint, PageHead, cx } from "../ui/kit";
import { CaseTable, isLiveRun, rowsOf } from "./parts";
import "./pages.css";

type Filter = "all" | CaseStatus;

const STATES: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "waiting", label: "Waiting" },
  { id: "open", label: "Investigating" },
  { id: "concluded", label: "Cause named" },
  { id: "unresolved", label: "No cause" },
];

export default function Cases() {
  const session = useSession();
  const navigate = useNavigate();
  const [state, setState] = useState<Filter>("all");
  const [machine, setMachine] = useState("all");

  const onMachine = (e: CaseEntry) => machine === "all" || machineOfCase(e).id === machine;
  const all = rowsOf(session.cases);
  // Runs of Crux's AI with no result yet are listed too: still arriving, or cut off.
  const pending = session.cases.filter((c) => !modelOf(c)).sort((a, b) => b.createdAt - a.createdAt);
  const count = (s: Filter) =>
    s === "all"
      ? all.filter((r) => onMachine(r.entry)).length + pending.filter(onMachine).length
      : all.filter((r) => r.model.status === s && onMachine(r.entry)).length + (s === "open" ? pending.filter((e) => onMachine(e) && isLiveRun(e)).length : 0);

  const rows = all.filter((r) => onMachine(r.entry) && (state === "all" || r.model.status === state));
  const extra = pending.filter((e) => onMachine(e) && (state === "all" || (state === "open" && isLiveRun(e))));
  const machines = MODELLED.filter((m) => session.cases.some((c) => machineOfCase(c).id === m.id));
  const total = all.length + pending.length;
  const clear = () => {
    setState("all");
    setMachine("all");
  };

  return (
    <div className="page">
      <PageHead
        title={
          <span className="row gap-1">
            Investigations
            <Hint label="Where these are kept">Kept in this browser. The server holds investigations in memory only.</Hint>
          </span>
        }
        actions={
          total > 0 && (
            <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={() => window.confirm("Start a fresh session? This browser forgets its investigations.") && resetSession()}>
              Reset session
            </Button>
          )
        }
      />

      <Card flush>
        {total === 0 ? (
          <Empty
            icon={<FolderOpen size={18} />}
            title="No investigations yet"
            action={
              <Button
                variant="primary"
                icon={<Sunrise size={15} />}
                onClick={() => {
                  void startShift();
                  navigate("/plant", { viewTransition: true });
                }}
              >
                Simulate a shift
              </Button>
            }
          >
            A shift sends a reading from every modelled machine.
          </Empty>
        ) : (
          <>
            <div className="list-bar">
              <div className="chips" role="group" aria-label="State">
                {STATES.filter((s) => s.id === "all" || s.id === state || count(s.id) > 0).map((s) => (
                  <button key={s.id} type="button" className={cx("chip-filter", state === s.id && "on")} aria-pressed={state === s.id} onClick={() => setState(s.id)}>
                    {s.label}
                    <span className="chip-count">
                      <CountUp value={count(s.id)} ms={300} />
                    </span>
                  </button>
                ))}
              </div>
              {machines.length > 1 && (
                <select className="select list-select" value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="Machine">
                  <option value="all">All machines</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {rows.length + extra.length === 0 ? (
              <Empty title="Nothing matches" action={<Button onClick={clear}>Clear filters</Button>} />
            ) : (
              <CaseTable rows={rows} pending={extra} />
            )}
          </>
        )}
      </Card>
    </div>
  );
}
