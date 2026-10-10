"""Investigating a recorded run: checks come from the snapshots that follow."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from hypothesis_engine.api.app import app
from hypothesis_engine.data.rig import BENCH_RIG, synthetic_capture
from hypothesis_engine.forecast import runs
from hypothesis_engine.investigation.recorded import investigate_recording
from hypothesis_engine.models import FaultKind


def test_checks_are_answered_from_later_snapshots_only() -> None:
    seen: list[int] = []

    def snap(i: int):
        seen.append(i)
        return synthetic_capture(FaultKind.OUTER_RACE, BENCH_RIG, seed=i)

    st = investigate_recording(BENCH_RIG, snap, start=3, count=6, max_requests=5, normal=())
    assert seen[0] == 3 and all(i > 3 for i in seen[1:]) and max(seen) < 6
    assert len(seen) - 1 == len(st.outcomes)  # one later snapshot per answered check


def test_the_start_of_the_run_is_its_own_normal_and_nothing_else_from_the_past_is_read() -> None:
    seen: list[int] = []

    def snap(i: int):
        seen.append(i)
        fault = FaultKind.OUTER_RACE if i >= 8 else FaultKind.HEALTHY
        return synthetic_capture(fault, BENCH_RIG, seed=i)

    st = investigate_recording(BENCH_RIG, snap, start=9, count=12, normal=(1, 2, 3))
    assert seen[0] == 9 and set(seen[1:4]) == {1, 2, 3}
    assert all(i > 9 for i in seen[4:]), "after the normal, only later snapshots answer checks"
    assert st.extra["own_normal"]["captures"] == 3
    assert st.conclusion is not None and st.conclusion.root_cause is FaultKind.OUTER_RACE


def test_a_normal_snapshot_after_the_reading_is_never_used() -> None:
    seen: list[int] = []

    def snap(i: int):
        seen.append(i)
        return synthetic_capture(FaultKind.HEALTHY, BENCH_RIG, seed=i)

    investigate_recording(BENCH_RIG, snap, start=2, count=3, max_requests=0, normal=(1, 2, 3, 4))
    assert seen == [2, 1]


def test_a_rig_without_bearing_dimensions_is_not_investigated() -> None:
    c = TestClient(app)
    r = c.post("/maintenance/investigate", json={"machine": "nope", "part": "x", "at_h": 1})
    assert r.status_code == 404


@pytest.mark.skipif(not runs.xjtu_runs(), reason="needs the XJTU-SY download")
def test_real_xjtu_bearing_is_investigated_at_the_requested_minute() -> None:
    c = TestClient(app)
    machines = [m["machine"] for m in c.get("/maintenance/machines").json()["machines"]]
    if "xjtu/40Hz10kN/Bearing3_5" not in machines:
        pytest.skip("no replay for XJTU-SY on this machine")
    run_id = "xjtu/40Hz10kN/Bearing3_5"
    r = c.post(
        "/maintenance/investigate", json={"machine": run_id, "part": run_id, "at_h": 0.2}
    ).json()
    assert r["leader"]["kind"] in {k.value for k in FaultKind}
    assert r["statement"].startswith("Crux")
