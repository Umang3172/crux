// The plant's side rail: who is needed and for what, and the guided
// investigations a visitor can start.

import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, BellRing, LoaderCircle, Play } from "lucide-react";
import { usePresence } from "../../lib/glide";
import { launchScenario } from "../../lib/launch";
import { OWNER, machineById, machinePath, standingOf, type MachineStatus } from "../../lib/plant";
import { SCENARIOS, type Scenario } from "../../lib/scenarios";
import type { PlantRow } from "../../lib/useplant";
import { Callout, Card, CountUp, Empty, cx } from "../../ui/kit";

const INBOX: Partial<Record<Exclude<MachineStatus["owner"], null>, { to: string; label: string }>> = {
  crew: { to: "/crew", label: "My work" },
  manager: { to: "/manager", label: "Summary" },
};

/** What needs someone, grouped by who, soonest first. */
export function Attention({ rows, only }: { rows: PlantRow[]; only?: MachineStatus["owner"] }) {
  const list = rows.filter((r) => standingOf(r.st) === "person" && (!only || r.st.owner === only)).sort((a, b) => b.st.rank - a.st.rank);
  const shown = usePresence(list, (r) => r.m.id);
  const owners = [...new Set(shown.map((p) => p.item.st.owner))].filter((o): o is Exclude<MachineStatus["owner"], null> => !!o);
  return (
    <Card
      title="Needs someone"
      icon={<BellRing size={15} />}
      sub={list.length > 0 ? <CountUp value={list.length} /> : undefined}
      flush
      tone={list.some((r) => r.st.tone === "danger") ? "danger" : undefined}
    >
      {shown.length === 0 ? (
        <Empty left title="No one is needed" />
      ) : (
        <div className="needs" data-tour="plant-needs">
          {owners.map((o) => {
            const mine = shown.filter((p) => p.item.st.owner === o);
            const inbox = INBOX[o];
            return (
              <div key={o} className="needs-group">
                {!only && (
                  <div className="needs-head">
                    <span className={cx("owner", o)}>{OWNER[o]}</span>
                    <b className="num">{mine.filter((p) => !p.leaving).length}</b>
                    {inbox && (
                      <Link to={inbox.to} className="push needs-inbox">
                        {inbox.label}
                        <ArrowRight size={12} aria-hidden />
                      </Link>
                    )}
                  </div>
                )}
                <ul>
                  {mine.map(({ item: { m, st }, key, leaving }) => (
                    <li key={key} className={cx("needs-row", leaving && "leaving")}>
                      <Link to={st.next?.to ?? (st.caseId ? `/cases/${st.caseId}` : machinePath(m))} title={st.detail}>
                        <span className="needs-name truncate">{m.name}</span>
                        <span className={cx("needs-what truncate", st.tone === "danger" ? "t-danger" : "t-warn")}>{st.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** Four pinned investigations, each showing one thing Crux does. */
export function Guided() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(s: Scenario) {
    setBusy(s.id);
    setError(null);
    try {
      navigate(`/cases/${await launchScenario(s)}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <Card title="Guided investigations" icon={<Play size={15} />} sub={`on ${machineById("p2")?.short}`} flush>
      <ul className="guided" data-tour="plant-guided">
        {SCENARIOS.map((s) => (
          <li key={s.id}>
            <button type="button" disabled={busy !== null} onClick={() => start(s)} title={s.line}>
              <span className="guided-title">{s.title}</span>
              <span className="guided-shows">{s.shows}</span>
              {busy === s.id ? <LoaderCircle size={13} className="spin" aria-hidden /> : <ArrowRight size={13} aria-hidden />}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <div className="guided-error">
          <Callout tone="danger">{error}</Callout>
        </div>
      )}
    </Card>
  );
}
