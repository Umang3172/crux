// A scan of the machine running well becomes its normal one; later scans with
// the same name are compared with it. Only one is kept per name, so keeping a
// new one replaces the old.

import { useState } from "react";
import { markNormalScan } from "../../api/crux";
import type { Scan } from "../../api/types";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { lensFailure } from "./words";
import s from "./KeepNormal.module.css";

export function KeepNormal({ scan, onKept }: { scan: Pick<Scan, "id" | "machine" | "normal">; onKept: (s: Scan) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (scan.normal) {
    return (
      <p className={s.kept} role="status">
        <Icon name="check" size={18} />
        This is the normal scan of “{scan.machine}”. Later scans with that name are compared with it.
      </p>
    );
  }

  async function keep() {
    setBusy(true);
    setError(null);
    try {
      onKept(await markNormalScan(scan.id));
    } catch (e) {
      setError(lensFailure(e, "The server could not keep this scan as normal."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.wrap}>
      <div>
        <Button kind="secondary" busy={busy} disabled={busy} onClick={keep}>
          Keep as this machine's normal scan
        </Button>
      </div>
      <p className={s.hint}>
        Only do this when “{scan.machine}” is running well. It replaces any earlier normal scan with that name.
      </p>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
