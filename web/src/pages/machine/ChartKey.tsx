// What each mark on the chart means, in words, under it.

import s from "./ChartKey.module.css";

export function ChartKey({ revealed }: { revealed: boolean }) {
  return (
    <ul className={s.key}>
      <li>
        <span className={`${s.mark} ${s.ink}`} aria-hidden="true" />
        Health, up to the clock. 100% vibrates as it did when new; 0% is the danger line.
      </li>
      <li>
        <span className={`${s.mark} ${s.alarm}`} aria-hidden="true" />
        The alarm: vibration stayed at least double its own healthy level for three readings in a row.
      </li>
      <li>
        <span className={`${s.mark} ${s.band}`} aria-hidden="true" />
        The forecast range for reaching the danger line.
      </li>
      {revealed && (
        <li>
          <span className={`${s.mark} ${s.ghost}`} aria-hidden="true" />
          What happened after the clock.
        </li>
      )}
    </ul>
  );
}
