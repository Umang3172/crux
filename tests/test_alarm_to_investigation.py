"""From the watcher's alarm to an investigation, on files shaped like a recorded run.

The whole path a run-to-failure recording takes: snapshot files on disk, the
bridge that turns them into observations, the bearing's own early minutes as its
normal, the engine, and the sentence the maintenance tab and the ticket show.

The files hold a made-up bearing rig with its own quirks (a 2x taller than its
1x, noise that rises with frequency), not the public dataset, which is not in
the repository. What is checked is the path, and that a rig's quirks do not
become its diagnosis.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from scipy.signal import butter, sosfilt

from hypothesis_engine.api import maintenance
from hypothesis_engine.data import xjtu
from hypothesis_engine.forecast import runs
from hypothesis_engine.investigation.recorded import NORMAL_SNAPSHOTS, investigate_recording
from hypothesis_engine.models import FaultKind, MachineSpec
from hypothesis_engine.physics.frequencies import shaft_hz
from hypothesis_engine.physics.signatures import Signature, Tone, predicted_signature
from hypothesis_engine.physics.synth import synthesize

CONDITION = "35Hz12kN"
FS = runs.XJTU_FS_HZ
SAMPLES = 32_768  # one snapshot: 1.28 s at 25.6 kHz
FAILS_FROM = 8  # snapshots from here on carry an outer-race fault
RIG = MachineSpec("made-up", "made-up rig", runs.XJTU_BEARING, xjtu.rpm_of(CONDITION), FS)


def _snapshot(index: int) -> np.ndarray:
    """One snapshot of the made-up rig, in g: its own tones, and a fault late in life."""
    fr = shaft_hz(RIG.nominal_rpm)
    fault = FaultKind.OUTER_RACE if index >= FAILS_FROM else FaultKind.HEALTHY
    impacts = predicted_signature(fault, RIG, RIG.nominal_rpm).impacts
    own = {1.0: 0.25, 2.0: 0.40, 3.0: 0.15, 4.0: 0.08}
    clean = Signature(fault, tuple(Tone(o * fr, a) for o, a in own.items()), impacts, noise=0.0)
    x = synthesize(clean, FS, SAMPLES / FS, seed=100 + index)
    rng = np.random.default_rng(index)
    hiss = sosfilt(
        butter(1, 1000.0, btype="highpass", fs=FS, output="sos"), rng.normal(0, 0.15, len(x))
    )
    return 0.02 * (x + 1.3 * hiss + rng.normal(0.0, 0.012, len(x)))


@pytest.fixture(scope="module")
def run(tmp_path_factory) -> runs.Run:
    root: Path = tmp_path_factory.mktemp("recorded")
    folder = root / CONDITION / "Bearing1_1"
    folder.mkdir(parents=True)
    for index in range(FAILS_FROM + 3):
        table = np.column_stack([_snapshot(index), np.zeros(SAMPLES)])
        np.savetxt(folder / f"{index + 1}.csv", table, delimiter=",", header="H,V", comments="")
    (found,) = runs.xjtu_runs(root)
    assert len(found) == FAILS_FROM + 3
    return found


@pytest.fixture
def served(run, monkeypatch):
    """The maintenance API with this one run on file."""
    monkeypatch.setattr(maintenance, "_xjtu_runs", lambda: {run.run_id: run})
    maintenance._investigate.cache_clear()
    yield run
    maintenance._investigate.cache_clear()


def _investigate(run: runs.Run, start: int, **how):
    return investigate_recording(
        xjtu.machine(run), lambda i: xjtu.observation(run, i), start, len(run), **how
    )


def test_without_its_own_normal_a_healthy_minute_of_this_rig_reads_as_a_fault(run):
    # The premise: the textbook machine is fooled by the rig's quirks. It no
    # longer concludes on it (the leader cannot explain the rig's own
    # harmonics), but it cannot call the bearing healthy either.
    state = _investigate(run, FAILS_FROM - 1, normal=())
    assert state.leader().kind is FaultKind.MISALIGNMENT and state.leader().posterior > 0.8
    assert state.outcome == "unresolved" and "does not explain" in state.unresolved_reason


def test_the_early_minutes_are_the_bearings_own_normal(run):
    state = _investigate(run, FAILS_FROM - 1)
    assert state.extra["own_normal"]["captures"] == len(NORMAL_SNAPSHOTS)
    assert state.leader().kind is FaultKind.HEALTHY
    assert state.conclusion is None or state.conclusion.root_cause is FaultKind.HEALTHY


def test_the_failing_minute_is_named_and_the_tab_is_told_how(served):
    found = maintenance._investigate(served.run_id, FAILS_FROM)
    assert found["confident"] is True and found["outcome"] == "concluded"
    assert found["leader"]["kind"] == "outer_race"
    assert found["statement"].startswith("Crux's investigation points to outer race")
    assert found["own_normal"]["captures"] == len(NORMAL_SNAPSHOTS)
    assert "own early recordings" in found["reading"]


def test_a_healthy_minute_is_not_given_a_fault_on_the_tab(served):
    found = maintenance._investigate(served.run_id, FAILS_FROM - 1)
    assert found["leader"]["kind"] == "healthy"
    assert "points to" not in found["statement"]
    assert found["statement"].startswith("Crux")


def test_a_minute_before_any_normal_falls_back_and_says_so(served):
    found = maintenance._investigate(served.run_id, 0)
    assert found["own_normal"] is None
    assert "textbook machine stands in" in found["reading"]
