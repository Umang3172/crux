// Run the same AI case again. The server hands an AI run back once and keeps
// nothing, so "again" means a new run with the same settings; the dead entry
// is dropped from this browser once the new one has opened.

import { useState } from "react";
import { useNavigate } from "react-router";
import { openAiCase } from "../../../demo/launch";
import { update, type CaseEntry } from "../../../demo/world";

export function useRerun(entry: CaseEntry | undefined) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!entry) return;
    setBusy(true);
    setError(null);
    try {
      const id = await openAiCase(entry.params, { machine: entry.machine, story: entry.story, hidden: entry.hidden });
      navigate(`/case/${id}`, { replace: true });
      // After the page has moved on, so the old one never flashes as missing.
      window.setTimeout(() => {
        update((w) => {
          const { [entry.id]: _gone, ...runs } = w.runs;
          return { ...w, cases: w.cases.filter((x) => x.id !== entry.id), runs };
        });
      }, 400);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The AI run could not start.");
      setBusy(false);
    }
  }

  return { run, busy, error };
}
