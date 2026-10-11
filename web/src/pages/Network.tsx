// How one plant learns from others without sending its recordings. What
// travels is a lesson, or a time-left model trained on failures other sites
// confirmed. A model is tested here, on this site's own past failures, before
// a named person can install it.

import { useDataNote } from "../app/DataNote";
import { Icon } from "../ui/Icon";
import { Section } from "../ui/Section";
import { ErrorState, Loading } from "../ui/States";
import { Alerts } from "./network/Alerts";
import { DecideTag } from "./network/DecideTag";
import { History } from "./network/History";
import { HubTag } from "./network/HubTag";
import { InUseTag } from "./network/InUseTag";
import { Lessons } from "./network/Lessons";
import { Rail, type Marker } from "./network/Rail";
import { TestTag } from "./network/TestTag";
import { STEP, useArrival } from "./network/useArrival";
import { useFleet } from "./network/useFleet";
import { rollbackOf, verdictOf } from "./network/words";
import s from "./network/Network.module.css";

export default function Network() {
  useDataNote(
    "Updates, alerts and lessons are this server's own site folder and hub, shared by everyone using this demo. Test numbers are measured on this site's recorded failures.",
  );
  const fleet = useFleet();
  const step = useArrival(fleet.arrival);
  const { status } = fleet;

  if (!status) {
    return fleet.error ? <ErrorState error={fleet.error} onRetry={() => void fleet.reload()} /> : <Loading>Reading this site's updates…</Loading>;
  }

  const staged = status.staged;
  const failed = staged !== null && verdictOf(staged.report) === "failed";
  const last = status.history[status.history.length - 1];
  // Only an install can be rolled back; rolling back a roll back would bring up a version whose files may be gone.
  const rollbackTo = last && rollbackOf(last) === null ? { version: last.previous } : undefined;

  // The marker is the update in motion: the staged one, or the one just installed in this visit.
  const marker: Marker | null = staged
    ? { label: `v${staged.version}`, at: markerAt(step, failed), tone: failed && step >= STEP.verdict ? "failed" : "waiting" }
    : fleet.installed !== null && fleet.installed === status.active
      ? { label: `v${fleet.installed}`, at: 3, tone: "installed" }
      : null;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>Network</h1>
        <p className={s.lead}>
          One plant can learn from others without handing over its recordings. A lesson is a few plain sentences; an update is a time-left
          model trained on the failures other sites confirmed. Each update is tested here, on this site's own past failures, and only a named
          person installs it.
        </p>
        <p className={s.shared}>
          Shared by everyone using this demo: the site, its updates and its lessons are one set for the whole server.
        </p>
      </header>

      <Section id="updates" title="Updates" aside="tested here first, installed by a person">
        <Rail
          marker={marker}
          stops={[
            <HubTag
              key="hub"
              versions={status.hub_versions}
              check={fleet.check}
              waiting={staged !== null}
              busy={fleet.doing === "check"}
              onCheck={() => void fleet.checkForUpdates()}
            />,
            <TestTag key="test" staged={staged} step={step} />,
            <DecideTag
              key="decide"
              staged={staged}
              rollbackTo={rollbackTo}
              doing={fleet.doing}
              onInstall={(by) => void fleet.install(by)}
              onRollback={(by) => void fleet.rollback(by)}
            />,
            <InUseTag key="use" status={status} />,
          ]}
        />
        {fleet.notice && (
          <p className={fleet.notice.tone === "error" ? s.error : s.ok} role={fleet.notice.tone === "error" ? "alert" : "status"}>
            <Icon name={fleet.notice.tone === "error" ? "close" : "check"} size={18} />
            {fleet.notice.text}
          </p>
        )}
      </Section>

      <div className={s.two}>
        <Section id="history" title="Installed so far" aside="the last five">
          <History entries={status.history} />
        </Section>
        <Section id="alerts" title="Alerts from other sites" aside="as the last check reported them">
          <Alerts check={fleet.check} />
        </Section>
      </div>

      <Section id="lessons" title="Lessons" aside="for rolling bearings · shared by everyone using this demo">
        <Lessons held={status.lessons} />
        <p className={s.quiet}>Lessons are knowledge, not evidence: they can point a technician at a check, but they never move a belief.</p>
      </Section>
    </div>
  );
}

/** Where the marker sits on the rail for each step of an arrival. */
function markerAt(step: number, failed: boolean): number {
  if (step === STEP.hub) return 0;
  if (step < STEP.onward) return 1;
  return failed ? 1 : 2;
}
