"""The CWRU loader, filename parser and benchmark — without the dataset.

Nothing here downloads anything. The .mat files are built in a tmp_path with
the variable names CWRU actually uses, so the awkward cases (no RPM scalar, no
drive-end channel, a two-column array) are exercised on every run, on a laptop
with no data and in CI with no network. The handful of assertions that need the
real recordings are skipped when `data/cwru/` is empty.
"""

from __future__ import annotations

import numpy as np
import pytest
from scipy.io import savemat
from typer.testing import CliRunner

from hypothesis_engine.cli import app
from hypothesis_engine.data import cwru
from hypothesis_engine.models import FaultKind

FS = 12_000.0

needs_dataset = pytest.mark.skipif(
    not cwru.available(),
    reason="needs real CWRU files in data/cwru/ — see scripts/fetch_cwru.py",
)


def _write_mat(path, *, de=True, fe=False, rpm=None, columns=1, prefix="X097") -> None:
    """A .mat shaped like CWRU's, with whichever variables we want to test."""
    n = int(FS * 0.5)
    payload: dict[str, np.ndarray] = {}
    signal = np.sin(2 * np.pi * 29.95 * np.arange(n) / FS).reshape(-1, 1)
    if de:
        payload[f"{prefix}_DE_time"] = np.repeat(signal, columns, axis=1)
    if fe:
        payload[f"{prefix}_FE_time"] = signal * 0.5
    if rpm is not None:
        payload[f"{prefix}RPM"] = np.array([[rpm]])
    savemat(str(path), payload)


# --------------------------------------------------------------------- loader


def test_loads_the_drive_end_channel_and_the_speed_in_the_file(tmp_path):
    path = tmp_path / "IR007_1.mat"
    _write_mat(path, de=True, fe=True, rpm=1748)

    obs = cwru.load_capture(path)

    assert obs.waveform.ndim == 1
    assert obs.sample_rate_hz == FS
    assert obs.rpm == pytest.approx(1748.0)  # the file wins over the load table's 1772
    assert obs.source == "cwru:IR007_1.mat"


def test_falls_back_to_the_fan_end_channel_and_says_so(tmp_path):
    path = tmp_path / "IR007_0.mat"
    _write_mat(path, de=False, fe=True, rpm=1797)

    obs = cwru.load_capture(path)

    assert obs.waveform.ndim == 1
    assert "fan-end" in obs.source, "a weaker channel must be visible in the ledger"


def test_missing_rpm_falls_back_to_the_motor_load_table(tmp_path):
    path = tmp_path / "OR021@6_3.mat"
    _write_mat(path, rpm=None)

    obs = cwru.load_capture(path)

    assert obs.rpm == pytest.approx(cwru.LOAD_TO_RPM[3])
    assert "load table" in obs.source


def test_unparseable_name_without_rpm_falls_back_to_nominal(tmp_path):
    path = tmp_path / "mystery.mat"
    _write_mat(path, rpm=None)

    assert cwru.load_capture(path).rpm == pytest.approx(cwru.CWRU_DRIVE_END.nominal_rpm)


def test_multi_column_array_becomes_one_channel(tmp_path):
    path = tmp_path / "IR014_0.mat"
    _write_mat(path, columns=2)

    obs = cwru.load_capture(path)

    assert obs.waveform.ndim == 1
    assert len(obs.waveform) == int(FS * 0.5)


def test_explicit_rpm_overrides_everything(tmp_path):
    path = tmp_path / "IR007_0.mat"
    _write_mat(path, rpm=1797)

    assert cwru.load_capture(path, rpm=1200.0).rpm == pytest.approx(1200.0)


def test_duration_trims_the_capture(tmp_path):
    path = tmp_path / "IR007_0.mat"
    _write_mat(path)

    obs = cwru.load_capture(path, duration_s=0.25)

    assert len(obs.waveform) == int(FS * 0.25)


def test_an_offset_gives_the_stretch_after_the_first(tmp_path):
    path = tmp_path / "IR007_0.mat"
    _write_mat(path)

    whole = cwru.load_capture(path)
    later = cwru.load_capture(path, duration_s=0.2, offset_s=0.2)

    assert np.array_equal(later.waveform, whole.waveform[int(FS * 0.2) : int(FS * 0.4)])
    with pytest.raises(ValueError, match="empty from 5 s"):
        cwru.load_capture(path, offset_s=5.0)


def test_a_file_with_no_acceleration_channel_is_an_error(tmp_path):
    path = tmp_path / "IR007_0.mat"
    savemat(str(path), {"X097RPM": np.array([[1797]])})

    with pytest.raises(ValueError, match="no drive-end or fan-end channel"):
        cwru.load_capture(path)


# ------------------------------------------------------------- filename parser

PARSED = [
    ("97.mat", FaultKind.HEALTHY, None, 0, None),
    ("100.mat", FaultKind.HEALTHY, None, 3, None),
    ("normal_0.mat", FaultKind.HEALTHY, None, 0, None),
    ("Normal_2.mat", FaultKind.HEALTHY, None, 2, None),
    ("IR007_0.mat", FaultKind.INNER_RACE, 0.007, 0, None),
    ("IR014_1.mat", FaultKind.INNER_RACE, 0.014, 1, None),
    ("IR021_3.mat", FaultKind.INNER_RACE, 0.021, 3, None),
    ("IR028_0.mat", FaultKind.INNER_RACE, 0.028, 0, None),
    ("OR007@6_0.mat", FaultKind.OUTER_RACE, 0.007, 0, 6),
    ("OR007@3_1.mat", FaultKind.OUTER_RACE, 0.007, 1, 3),
    ("OR007@12_2.mat", FaultKind.OUTER_RACE, 0.007, 2, 12),
    ("OR021@6_2.mat", FaultKind.OUTER_RACE, 0.021, 2, 6),
    ("12k_Drive_End_IR007_0.mat", FaultKind.INNER_RACE, 0.007, 0, None),
]


@pytest.mark.parametrize(("name", "kind", "diameter", "load", "clock"), PARSED)
def test_filename_carries_the_ground_truth(name, kind, diameter, load, clock):
    case = cwru.parse_filename(name)

    assert case.kind is kind
    assert case.diameter_in == diameter
    assert case.load_hp == load
    assert case.clock_position == clock
    assert case.rpm == pytest.approx(cwru.LOAD_TO_RPM[load])


@pytest.mark.parametrize("name", ["B007_0.mat", "B021_2.mat"])
def test_ball_defects_are_refused_rather_than_relabelled(name):
    """We have no ball hypothesis; calling one an outer race would fake accuracy."""
    with pytest.raises(ValueError, match="ball defect"):
        cwru.parse_filename(name)


@pytest.mark.parametrize("name", ["105.mat", "233.mat", "readme.mat", "IR7_0.mat"])
def test_names_without_ground_truth_are_refused(name):
    with pytest.raises(ValueError):
        cwru.parse_filename(name)


# ------------------------------------------------------------------- benchmark


def test_available_is_empty_when_the_folder_is(tmp_path):
    assert cwru.available(tmp_path) == []
    assert cwru.available(tmp_path / "does-not-exist") == []


def test_benchmark_exits_cleanly_with_no_data(tmp_path):
    result = CliRunner().invoke(app, ["benchmark", "--data-dir", str(tmp_path)])

    assert result.exit_code == 0
    assert "fetch_cwru.py" in result.output, "an empty folder must say how to fill it"


def test_benchmark_reports_files_it_cannot_label(tmp_path):
    _write_mat(tmp_path / "B007_0.mat")

    result = CliRunner().invoke(app, ["benchmark", "--data-dir", str(tmp_path)])

    assert result.exit_code == 0
    assert "ball defect" in result.output


def test_benchmark_runs_a_real_investigation_on_a_synthetic_file(tmp_path):
    """The command's plumbing — load, investigate, tabulate — with no dataset.

    The waveform is a bare sine, so the diagnosis is meaningless; what matters
    is that a case runs end to end and the thesis counters are printed.
    """
    _write_mat(tmp_path / "IR007_0.mat", rpm=1797)

    result = CliRunner().invoke(app, ["benchmark", "--data-dir", str(tmp_path), "--seconds", "0.5"])

    assert result.exit_code == 0, result.output
    assert "settled by simulation alone" in result.output
    assert "technician-minutes" in result.output


def test_a_requested_capture_is_answered_by_the_next_stretch_of_the_recording(tmp_path):
    """An inner-race recording the first two seconds cannot place. The benchmark
    answers a requested capture from the two seconds that follow, and nothing
    else: not a value only a person could report, and not a stretch the
    recording does not have."""
    from hypothesis_engine.cli import _run_cwru_case
    from hypothesis_engine.data.rig import synthetic_capture

    recording = synthetic_capture(
        FaultKind.INNER_RACE,
        cwru.CWRU_DRIVE_END,
        rpm=1797.0,
        severity=0.75,
        extra_noise=0.6,
        duration_s=4.0,
        seed=555,
    )
    path = tmp_path / "IR007_0.mat"
    savemat(
        str(path),
        {"X105_DE_time": recording.waveform.reshape(-1, 1), "X105RPM": np.array([[1797]])},
    )
    case = cwru.parse_filename(path)

    result = _run_cwru_case(case, max_requests=2, seconds=2.0)
    assert "envelope" in result.answered, "the first two seconds should not settle this case"
    assert set(result.answered) <= {"vib_10s", "envelope", "half_order"}
    assert set(result.unanswerable) <= {"temperature", "coast_down"}
    assert result.minutes == 3.0, "only the capture that was taken costs technician time"

    # Opened on three of its four seconds, the recording has no second stretch.
    short = _run_cwru_case(case, max_requests=2, seconds=3.0)
    assert not short.answered


@needs_dataset
def test_every_real_file_loads_and_is_labelled():
    for path in cwru.available():
        case = cwru.parse_filename(path)  # raises if the name carries no truth
        obs = cwru.load_capture(path, duration_s=1.0)
        assert len(obs.waveform) > 0
        assert 1_500 < obs.rpm < 1_900, f"{path.name}: implausible shaft speed {obs.rpm}"
        assert case.kind in {FaultKind.HEALTHY, FaultKind.INNER_RACE, FaultKind.OUTER_RACE}
