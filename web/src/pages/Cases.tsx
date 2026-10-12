import { useState } from "react";
import { FolderOpen, Plus, RotateCcw } from "lucide-react";
import { openLauncher } from "../app/Launcher";
import type { CaseStatus } from "../lib/casemodel";
import { resetSession, useSession } from "../lib/session";
import { Button, Card, Empty, PageHead, Seg } from "../ui/kit";
import { CaseTable, rowsOf } from "./parts";
import "./pages.css";

type Filter = "all" | CaseStatus;
type Who = "all" | "agents" | "engine";

export default function Cases() {
  const session = useSession();
  const [filter, setFilter] = useState<Filter>("all");
  const [who, setWho] = useState<Who>("all");
  const all = rowsOf(session.cases);
  const rows = all.filter((r) => (filter === "all" || r.model.status === filter) && (who === "all" || r.entry.kind === who));
  const n = (s: CaseStatus) => all.filter((r) => r.model.status === s).length;

  return (
    <div className="page">
      <PageHead
        title="Cases"
        sub="Every case this browser opened. The server keeps cases in memory, so each one's last known state is kept here as well."
        actions={
          <>
            {all.length > 0 && (
              <Button
                variant="ghost"
                icon={<RotateCcw size={14} />}
                onClick={() => window.confirm("Start a fresh session? This browser forgets its cases.") && resetSession()}
              >
                Reset session
              </Button>
            )}
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => openLauncher()}>
              New case
            </Button>
          </>
        }
      />
      <Card
        flush
        title={`${rows.length} case${rows.length === 1 ? "" : "s"}`}
        icon={<FolderOpen size={15} />}
        actions={
          <>
            <Seg
              value={who}
              onChange={setWho}
              label="Investigated by"
              options={[
                { id: "all", label: "Anyone" },
                { id: "agents", label: "Agents" },
                { id: "engine", label: "Engine + person" },
              ]}
            />
            <Seg
              value={filter}
              onChange={setFilter}
              label="State"
              options={[
                { id: "all", label: `All ${all.length}` },
                { id: "waiting", label: `Waiting ${n("waiting")}` },
                { id: "concluded", label: `Cause named ${n("concluded")}` },
                { id: "unresolved", label: `No cause ${n("unresolved")}` },
              ]}
            />
          </>
        }
      >
        {rows.length === 0 ? (
          <Empty icon={<FolderOpen size={18} />} title={all.length === 0 ? "No case yet" : "No case matches this filter"}>
            {all.length === 0 ? "Open one from the overview, or with New case." : "Change the filters above to see the others."}
          </Empty>
        ) : (
          <CaseTable rows={rows} />
        )}
      </Card>
    </div>
  );
}
