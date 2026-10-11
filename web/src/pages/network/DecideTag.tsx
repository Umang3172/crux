// The decision is a person's: they type a name and install, or roll back. There
// is no login and nothing here installs by itself.

import { useId, useState } from "react";
import { Button } from "../../ui/Button";
import { Field, Fields, Tag } from "../../ui/Tag";
import type { Doing } from "./useFleet";
import { verdictOf, type Staged } from "./words";
import s from "./Tags.module.css";

export function DecideTag({
  staged,
  rollbackTo,
  doing,
  onInstall,
  onRollback,
}: {
  staged: Staged | null;
  /** What a roll back returns to, or undefined when there is nothing to roll back. */
  rollbackTo?: { version: number | null };
  doing: Doing;
  onInstall: (by: string) => void;
  onRollback: (by: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const by = name.trim();
  const failed = staged !== null && verdictOf(staged.report) === "failed";
  const installable = staged !== null && !failed ? staged : null;
  const busy = doing === "install" || doing === "rollback";

  if (!staged && !rollbackTo) {
    return (
      <Tag tone="stock" head="Decision" as="div">
        <Fields columns={1}>
          <Field label="Nothing waiting">No update is staged and none has been installed here.</Field>
        </Fields>
      </Tag>
    );
  }

  return (
    <Tag tone={installable ? "measure" : failed ? "void" : "stock"} head="Decision" as="div">
      <Fields columns={1}>
        <Field label="What happens">
          {installable && <span>Installing version {installable.version} changes the model for everyone using this demo.</span>}
          {failed && <span>This update did not pass its test, so it can't be installed.</span>}
          {!staged && <span>Nothing is waiting. The last install can be rolled back.</span>}
        </Field>
        {(installable || rollbackTo) && (
          <Field label="Your name">
            <form
              className={s.stack}
              onSubmit={(e) => {
                e.preventDefault();
                if (installable && by && !busy) onInstall(by);
              }}
            >
              <label className="visually-hidden" htmlFor={id}>
                Your name
              </label>
              <input
                id={id}
                className={s.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="Type your name"
              />
              <div className={s.actions}>
                {installable && (
                  <Button type="submit" kind="primary" busy={doing === "install"} disabled={!by || busy}>
                    Install version {installable.version}
                  </Button>
                )}
                {rollbackTo && (
                  <Button kind="secondary" busy={doing === "rollback"} disabled={!by || busy} onClick={() => onRollback(by)}>
                    {rollbackTo.version === null ? "Roll back to the trend line" : `Roll back to version ${rollbackTo.version}`}
                  </Button>
                )}
              </div>
            </form>
          </Field>
        )}
      </Fields>
    </Tag>
  );
}
