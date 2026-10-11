// Which brain runs each AI job, from the server's own report. A job that fell
// back says why and what runs instead.

import { useHealth } from "../lib/hooks";
import { AI_JOBS, brainOf, fallbackReason } from "./ai";
import { Dialog } from "./Dialog";
import s from "./AIStatusDrawer.module.css";

export function AIStatusDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const health = useHealth();
  const models = health.data?.models;
  return (
    <Dialog open={open} onClose={onClose} title="Who runs each AI job" side>
      <p className={s.lead}>
        Physics decides every belief. These jobs only propose, explain, draft or look. This is what the server is configured
        to use; it does not yet report when each one last answered.
      </p>
      {!models && <p className={s.lead}>{health.error ? "The engine could not be reached." : "Asking the server…"}</p>}
      {models && (
        <ul className={s.jobs}>
          {AI_JOBS.map((job) => {
            const configured = String(models[job.key] ?? "");
            const brain = brainOf(configured);
            const why = fallbackReason(models, String(job.key));
            return (
              <li key={job.key} className={s.job}>
                <div className={s.row}>
                  <span className={s.name}>{job.label}</span>
                  <span className={brain.live ? s.live : s.off}>{brain.name}</span>
                </div>
                <span className={s.config}>configured: {configured || "not reported"}</span>
                {!brain.live && <span className={s.instead}>{job.instead}</span>}
                {why && <span className={s.why}>Fell back: {why}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
