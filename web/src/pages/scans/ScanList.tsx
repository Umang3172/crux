// Every scan on this server, newest first. A scan marked as its machine's
// normal one wears the green tag; the line beside it is the physics' first
// sentence about the clip, or says the physics hasn't run yet.

import { Link } from "react-router";
import { scans } from "../../api/crux";
import type { ScanRow } from "../../api/types";
import { useDataNote } from "../../app/DataNote";
import { stamp } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { Empty, ErrorState, Loading } from "../../ui/States";
import { Tag } from "../../ui/Tag";
import { ScanCta } from "./ScanCta";
import { isFromLook } from "./words";
import s from "./ScanList.module.css";

export function ScanList() {
  useDataNote(
    "Scans are stored on this server and shared by everyone using this demo. What a model saw in a clip is unconfirmed; the motion and sound readings are the physics model's.",
  );
  const list = useAsync(() => scans(), []);

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>Lens scans</h1>
        <p className={s.lead}>
          A phone video of a machine that has no sensor. The physics reads how its housing shakes; a model may name the machine and look for
          trouble, and what it says is never treated as fact.
        </p>
        <p className={s.shared}>Shared by everyone using this demo: every scan on this server is listed here.</p>
      </header>

      <div className={s.grid}>
        <div className={s.main}>
          {list.loading && !list.data ? (
            <Loading>Reading the scans…</Loading>
          ) : list.error && !list.data ? (
            <ErrorState error={list.error} onRetry={list.reload} />
          ) : list.data && list.data.length === 0 ? (
            <Empty title="No scans yet">A phone scan of a machine with no sensor lands here.</Empty>
          ) : (
            <Rows rows={list.data ?? []} />
          )}
        </div>
        <div className={s.side}>
          <ScanCta />
        </div>
      </div>
    </div>
  );
}

function Rows({ rows }: { rows: ScanRow[] }) {
  return (
    <table className={s.table}>
      <caption className="visually-hidden">Scans on this server, newest first</caption>
      <thead>
        <tr>
          <th scope="col">Machine</th>
          <th scope="col">Normal</th>
          <th scope="col">Scanned</th>
          <th scope="col">What the physics found</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <th scope="row">
              <Link to={`/scans/${r.id}`} className={s.machine}>
                {r.machine}
              </Link>
              <span className={s.id}>{r.id}</span>
            </th>
            <td>{r.normal && <Tag tone="safety" head="Normal" size="rack" as="div" />}</td>
            <td className={s.when}>{stamp(r.created)}</td>
            <td>
              {r.summary[0] && isFromLook(r.summary[0]) ? (
                // The server's first line can be the camera look's, which is a model's and not the physics'.
                <span className={s.quiet}>A model's look came first. Open the scan for the physics.</span>
              ) : r.summary[0] ? (
                r.summary[0]
              ) : (
                <span className={s.quiet}>{r.analysed ? "No summary." : "Not analysed yet: the shaft speed hasn't been confirmed."}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
