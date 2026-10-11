// What runs where, as of right now. The server's own report says which brain
// is behind each AI job; the host says where the engine runs. Nothing here
// describes a deployment that does not exist.

import { brainOf, AI_JOBS, fallbackReason } from "../../app/ai";
import { useHealth } from "../../lib/hooks";
import { ErrorState, Loading } from "../../ui/States";
import s from "./Where.module.css";

/** Google Cloud Run serves every service from a *.run.app host. */
const onCloudRun = (host: string) => /\.run\.app$/.test(host);

export function Where() {
  const health = useHealth();
  const host = window.location.host;
  const cloud = onCloudRun(window.location.hostname);
  const models = health.data?.models;
  return (
    <div className={s.where}>
      <div className={s.scroll}>
        <table className={s.table}>
          <caption className="visually-hidden">What runs where</caption>
          <thead>
            <tr>
              <th scope="col">Part</th>
              <th scope="col">Runs on</th>
              <th scope="col">What it is</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Physics engine</th>
              <td>
                <span className={s.host}>{host}</span>
                {cloud ? " · Google Cloud Run" : " · this server, not on Google Cloud Run at the moment"}
              </td>
              <td>Deterministic code: no model, no network call. The same case gives the same numbers.</td>
            </tr>
            <tr>
              <th scope="row">API and this web app</th>
              <td>
                <span className={s.host}>{host}</span>
                {health.data ? ` · answering (${health.data.status})` : health.error ? " · not reachable" : " · asking…"}
              </td>
              <td>One server serves the page and the API, so what you see here is what the engine returned.</td>
            </tr>
            {models &&
              AI_JOBS.map((job) => {
                const configured = String(models[job.key] ?? "");
                const brain = brainOf(configured);
                const why = fallbackReason(models, String(job.key));
                return (
                  <tr key={job.key} className={s.job}>
                    <th scope="row">
                      <span className={s.dashed}>{job.label}</span>
                    </th>
                    <td>
                      <span className={brain.live ? s.live : s.stand}>{brain.name}</span>
                      <span className={s.config}> configured: {configured || "not reported"}</span>
                    </td>
                    <td>
                      {brain.live ? "A language model writes this job's words, and says so wherever they appear." : job.instead}
                      {why && <span className={s.why}> Fell back: {why}</span>}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {!models && health.loading && <Loading>Asking the server which brain runs each AI job…</Loading>}
      {!models && health.error && <ErrorState error={health.error} onRetry={health.reload} title="The server's report can't be read" />}
      <p className={s.note}>
        An AI job being on or off never changes a belief: the physics decides either way. "Configured" is what the server was set up to use;
        it does not yet report when each job last answered.
      </p>
    </div>
  );
}
