"""MetroPT-3 mechanics on a hand-written CSV: the hourly fold, the causal window,
re-arming alarms and how a warning is credited. Says nothing about how well the
watcher does on the real compressor; `scripts/forecast.py metro` reports that."""

from __future__ import annotations

import numpy as np

from hypothesis_engine.forecast import metropt as m

HEAD = ",timestamp,TP2,TP3,H1,DV_pressure,Reservoirs,Oil_temperature,Motor_current,COMP,DV_eletric,Towers,MPG,LPS,Pressure_switch,Oil_level,Caudal_impulses\n"


def test_samples_fold_into_hours(tmp_path) -> None:
    rows = [
        "0,2020-02-01 00:00:00,0,9,9,0,9,50,0.0,1,0,1,1,0,1,1,1",
        "1,2020-02-01 00:30:00,0,9,9,0,9,52,7.0,0,1,1,1,0,1,1,1",
        "2,2020-02-01 01:10:00,0,9,9,0,9,54,7.0,0,1,1,1,0,1,1,1",
    ]
    path = tmp_path / "m.csv"
    path.write_text(HEAD + "\n".join(rows) + "\n")
    h = m.hourly(path)
    assert [str(x) for x in h.hour] == ["2020-02-01T00", "2020-02-01T01"]
    assert np.allclose(h.loaded, [0.5, 1.0])
    assert np.allclose(h.oil_temp, [51.0, 54.0])
    assert np.allclose(h.signal, [0.5, 0.75])  # trailing day: both hours


def test_trailing_window_forgets_old_hours_and_skips_gaps() -> None:
    hour = np.array(["2020-02-01T00", "2020-02-01T01", "2020-02-02T05"], dtype="datetime64[h]")
    out = m.trailing(hour, np.array([1.0, 0.0, 0.2]), window_h=24)
    assert np.allclose(out, [1.0, 0.5, 0.2])  # the first two are more than a day back


def test_alarms_fire_after_consecutive_hours_and_re_arm() -> None:
    s = np.array([0, 5, 5, 5, 5, 0, 5, 0, 5, 5, 5], dtype=float)
    assert m.alarms(s, line=1.0, consecutive=3) == [(3, 5), (10, 10)]


def test_a_warning_is_credited_only_within_reach_of_a_failure() -> None:
    hour = np.arange(np.datetime64("2020-02-01T00", "h"), np.datetime64("2020-07-20T00", "h"))
    signal = np.full(len(hour), 0.05)
    start = np.datetime64(m.FAILURES[1][0], "h")
    early = int(np.where(hour == start - np.timedelta64(10, "h"))[0][0])
    signal[early - 2 : early + 5] = 0.5  # fires 10 h before failure 2
    far = int(np.where(hour == np.datetime64("2020-03-15T00", "h"))[0][0])
    signal[far : far + 4] = 0.5  # nothing near it
    h = m.Hourly(hour, signal, signal, signal, signal)
    verdicts, false, _ = m.score(h, line=0.1)
    assert verdicts[1].warned and verdicts[1].lead_h == 10.0
    assert not verdicts[3].warned
    assert len(false) == 1 and false[0][0].startswith("2020-03-15")


def test_slow_drift_becomes_the_new_normal_but_a_leak_still_fires() -> None:
    hour = np.arange(np.datetime64("2020-02-01T00", "h"), np.datetime64("2020-07-01T00", "h"))
    rng = np.random.default_rng(0)
    s = 0.05 + 0.001 * rng.standard_normal(len(hour))
    start = int(np.where(hour == m.BASELINE_END)[0][0])
    s[start:] *= np.linspace(1.0, 3.0, len(hour) - start)  # use triples over four months
    leak = int(np.where(hour == np.datetime64("2020-06-20T00", "h"))[0][0])
    s[leak : leak + 12] *= 3.0  # a leak, half a day
    fixed = m.alarms(s, m.limit(s, hour))
    rolling = m.alarms(s, m.rolling_limits(s, hour))
    assert fixed and hour[fixed[0][0]] < hour[leak]  # the fixed line mistakes drift for a fault
    assert [hour[f] for f, _ in rolling] == [hour[leak + m.CONSECUTIVE - 1]]  # only the leak


def test_a_sudden_lasting_step_keeps_alarming_until_a_person_accepts_it() -> None:
    hour = np.arange(np.datetime64("2020-02-01T00", "h"), np.datetime64("2020-05-01T00", "h"))
    s = np.full(len(hour), 0.05)
    s[hour >= np.datetime64("2020-03-10T00", "h")] = 0.15  # three times the old level, for good
    lims = m.rolling_limits(s, hour)
    assert lims[-1] == lims[0]  # flagged hours never become normal on their own
