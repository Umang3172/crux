"""Learning across sites: the lesson memory, signed bundles, and a site that
tests an update on its own failures before a person installs it. Offline."""

from __future__ import annotations

import json

import pytest

from hypothesis_engine.fleet import Hub, Lesson, Memory, Site, bundle, machine_type_of
from hypothesis_engine.fleet.learn import lesson_from_outcome
from test_forecast import _run  # tests/ is on the path, not a package

BEARING = "rolling bearing"


def _lesson(title: str, when: str, kind: str = BEARING, **kw) -> Lesson:
    return Lesson(machine_type=kind, title=title, when=when, do="check it", **kw)


# ---------------------------------------------------------------- memory


def test_recall_finds_the_lesson_for_this_situation_and_machine_type(tmp_path) -> None:
    mem = Memory(tmp_path / "m.jsonl")
    leak = _lesson(
        "Leak hides as wear", "compressor loads more often at night", kind="air compressor"
    )
    restart = _lesson("Restarts are not wear", "vibration steps up after a restart then stays flat")
    cage = _lesson("Cage faults stay quiet", "kurtosis rises while RMS stays flat")
    assert mem.add([leak, restart, cage]) == [leak, restart, cage]
    assert mem.add([restart]) == []  # held already
    assert mem.recall(BEARING, "RMS flat but kurtosis rising")[0] == cage
    assert mem.recall(BEARING, "a restart and the vibration stepped up")[0] == restart
    assert leak not in mem.recall(BEARING, "loads more often at night")  # another machine type
    assert mem.recall(BEARING, "zzz qqq") == []


def test_a_miss_becomes_a_pitfall_and_a_hit_a_strategy() -> None:
    args = dict(
        machine_type=BEARING,
        case_id="T-1",
        situation="health 40%, vibration 3x",
        confirmed_by="Asha",
    )
    hit = lesson_from_outcome(
        said="outer race", found="outer race spall", right=True, use_model=False, **args
    )
    miss = lesson_from_outcome(
        said="looseness", found="inner race crack", right=False, use_model=False, **args
    )
    assert hit.outcome == "success" and hit.avoid == "" and hit.cases == ("T-1",)
    assert miss.outcome == "failure" and "looseness" in miss.avoid and "inner race crack" in miss.do
    assert miss.confirmed_by == "Asha"


def test_machines_map_to_their_pack() -> None:
    assert machine_type_of("xjtu/35Hz12kN/Bearing1_1") == BEARING
    assert machine_type_of("ims/test2") == BEARING
    assert machine_type_of("metropt") == "air compressor"


# ---------------------------------------------------------------- bundles


def test_a_changed_or_unsigned_bundle_is_refused(tmp_path) -> None:
    key = b"k" * 32
    folder = bundle.write(
        tmp_path / "b", bundle.Manifest(1, "alert", "hub"), [_lesson("t", "w")], {}, key
    )
    assert bundle.verify(folder, key).version == 1
    with pytest.raises(bundle.BadBundle):
        bundle.verify(folder, b"other key")
    (folder / "lessons.jsonl").write_text((folder / "lessons.jsonl").read_text() + "\n")
    with pytest.raises(bundle.BadBundle):
        bundle.verify(folder, key)


def test_a_file_slipped_into_a_bundle_is_refused(tmp_path) -> None:
    key = b"k" * 32
    folder = bundle.write(tmp_path / "b", bundle.Manifest(1, "alert", "hub"), [], {}, key)
    (folder / "extra.py").write_text("print('hi')")
    with pytest.raises(bundle.BadBundle):
        bundle.verify(folder, key)


# ---------------------------------------------------------------- hub and site


def test_a_major_failure_elsewhere_reaches_this_site_at_once(tmp_path) -> None:
    hub = Hub(tmp_path / "hub").init()
    site = Site("site-a", tmp_path / "site")
    lesson = _lesson(
        "Cage faults stay quiet", "kurtosis rises while RMS stays flat", source="site-b"
    )
    assert hub.contribute("site-b", lesson, major=True) is not None
    out = site.pull(hub, own_runs=[])
    assert out["alerts"][0]["lessons"] == ["Cage faults stay quiet"]
    assert site.memory.recall(BEARING, "kurtosis rising") == [lesson]
    assert site.pull(hub, own_runs=[])["alerts"] == []  # applied once


def test_a_monthly_update_is_tested_on_unseen_failures_approved_and_rolled_back(tmp_path) -> None:
    hub = Hub(tmp_path / "hub").init()
    site = Site("site-a", tmp_path / "site")
    hub_runs = [_run(f"lab/b{k}", life=200, onset_at=120, seed=k) for k in range(6)]
    own = [_run(f"site-a/b{k}", life=220, onset_at=150, seed=10 + k) for k in range(3)]
    hub.monthly(hub_runs)
    report = site.pull(hub, own_runs=own)["staged"]["report"]
    assert report["runs"] == 3 and report["passes"] in (True, False)
    assert report["current"]["model"] == "trend"
    if report["passes"]:
        site.approve("Asha")
        assert site.model_path() is not None and site.state()["active"] == 1
        site.rollback("Asha")
        assert site.model_path() is None and site.state()["active"] is None
    else:
        with pytest.raises(ValueError):
            site.approve("Asha")


def test_without_unseen_failures_a_person_decides_and_must_give_a_name(tmp_path) -> None:
    hub = Hub(tmp_path / "hub").init()
    site = Site("site-a", tmp_path / "site")
    runs = [_run(f"lab/b{k}", life=200, onset_at=120, seed=k) for k in range(4)]
    hub.monthly(runs)
    staged = site.pull(hub, own_runs=runs)["staged"]  # every own failure was in training
    assert staged["report"]["passes"] is None
    with pytest.raises(ValueError):
        site.approve(" ")
    assert site.approve("Asha")["active"] == 1


def test_a_tampered_update_never_reaches_the_site(tmp_path) -> None:
    hub = Hub(tmp_path / "hub").init()
    site = Site("site-a", tmp_path / "site")
    folder = hub.publish_alert([_lesson("t", "w")])
    m = json.loads((folder / "manifest.json").read_text())
    m["note"] = "edited"
    (folder / "manifest.json").write_text(json.dumps(m))
    out = site.pull(hub, own_runs=[])
    assert out["alerts"] == [] and out["rejected"] and site.memory.all() == []
