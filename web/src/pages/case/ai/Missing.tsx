// An AI case this browser has no run for: another browser opened it, or the
// demo was reset. The server returns a run once and keeps none, so the page
// says so and offers to run it again.

import type { CaseEntry } from "../../../demo/world";
import { Button, ButtonLink } from "../../../ui/Button";
import { Empty } from "../../../ui/States";
import { useRerun } from "./useRerun";
import s from "./Missing.module.css";

export function Missing({ entry }: { entry: CaseEntry | undefined }) {
  const rerun = useRerun(entry);
  return (
    <Empty title="This AI run isn't here">
      <p>This AI run was returned once and kept only in the browser that ran it.</p>
      <p>
        The server hands an AI run back a single time and does not store it, so another browser, or a demo that was reset, cannot show it.
      </p>
      <div className={s.row}>
        {entry && (
          <Button kind="primary" onClick={rerun.run} busy={rerun.busy} disabled={rerun.busy}>
            {rerun.busy ? "Running it again…" : "Run it again"}
          </Button>
        )}
        <ButtonLink to="/try">Investigate another fault</ButtonLink>
      </div>
      {rerun.error && (
        <p className={s.error} role="alert">
          {rerun.error}
        </p>
      )}
    </Empty>
  );
}
