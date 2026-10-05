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

    st = investigate_recording(BENCH_RIG, snap, start=3, count=6, max_requests=5)
    assert seen[0] == 3 and all(i > 3 for i in seen[1:]) and max(seen) < 6
    assert len(seen) - 1 == len(st.outcomes)  # one later snapshot per answered check


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
