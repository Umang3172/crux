// The hub: where lessons and updates come from. Checking is the page's one
// request to it, and what comes back is said in words under the button.

import { list } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Field, Fields, Tag } from "../../ui/Tag";
import type { Check } from "./useFleet";
import { plural } from "./words";
import s from "./Tags.module.css";

export function HubTag({
  versions,
  check,
  waiting,
  busy,
  onCheck,
}: {
  versions: number[];
  check: Check;
  /** An update is already waiting for a decision, so checking again is the quieter action. */
  waiting: boolean;
  busy: boolean;
  onCheck: () => void;
}) {
  const noHub = check.state === "nohub";
  return (
    <Tag tone={noHub ? "void" : "stock"} head={noHub ? "No hub" : "The hub"} as="div">
      <Fields columns={1}>
        <Field label="Holds">
          {versions.length > 0
            ? `${plural(versions.length, "bundle")}: ${versions.length === 1 ? "version" : "versions"} ${list(versions.map(String))}`
            : "No bundles reported"}
        </Field>
        <Field label="What travels">
          Lessons, and a time-left model trained on the failures other sites confirmed. Raw recordings never leave a site.
        </Field>
        <Field label="Check">
          <div className={s.stack}>
            <div>
              <Button kind={waiting ? "secondary" : "primary"} busy={busy} disabled={busy} onClick={onCheck}>
                Check for updates
              </Button>
            </div>
            <p className={s.live} role="status">
              {sayCheck(check)}
            </p>
          </div>
        </Field>
      </Fields>
    </Tag>
  );
}

function sayCheck(check: Check): string {
  switch (check.state) {
    case "idle":
      return "Pulls new alerts and stages the newest update, then tests it here.";
    case "busy":
      return "Checking the hub…";
    case "nohub":
      return "This server has no hub, so there are no updates to pull.";
    case "error":
      return check.message;
    case "done": {
      const parts: string[] = [];
      if (check.alerts.length > 0) parts.push(`${plural(check.alerts.length, "alert")} applied`);
      if (check.arrived !== null) parts.push(`version ${check.arrived} arrived and was tested here`);
      if (check.rejected.length > 0) parts.push(`${plural(check.rejected.length, "bundle")} refused`);
      if (parts.length === 0) return "Nothing new on the hub.";
      const text = parts.join(", ");
      return `${text[0].toUpperCase()}${text.slice(1)}.`;
    }
  }
}
