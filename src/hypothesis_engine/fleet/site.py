"""A site's side: take updates from the hub, test them, install them only when a person agrees.

- Alerts (lessons only) go straight into the site's memory: knowledge, not a
  change to any number Crux computes.
- A monthly bundle is staged and tested first: its time-left model against the
  one in use, on this site's own failures that the bundle was not trained on.
  It can be approved only if it is no worse on both median error and "early
  end too late". Without such failures the report says so, and a person decides.
- Every installed version is kept, so a rollback is one step.
"""

from __future__ import annotations

import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

from ..forecast.evaluate import score_run, summarise
from ..forecast.health import RunHealth
from ..forecast.models import Forecaster, QuantileGBM, TrendExtrapolation
from . import bundle
from .hub import Hub
from .memory import SITE_DIR, Memory
from .packs import PACKS


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class Site:
    def __init__(self, site_id: str, root: Path | None = None) -> None:
        self.site_id = site_id
        self.root = root if root is not None else SITE_DIR
        self.memory = Memory(self.root / "memory.jsonl")
        self.active_dir = self.root / "active"
        self.kept = self.root / "versions"

    # ------------------------------------------------------------- state

    @property
    def _state_file(self) -> Path:
        return self.root / "state.json"

    def state(self) -> dict:
        if self._state_file.exists():
            return json.loads(self._state_file.read_text())
        return {
            "site_id": self.site_id,
            "active": None,
            "staged": None,
            "alerts": [],
            "history": [],
        }

    def _save(self, s: dict) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self._state_file.write_text(json.dumps(s, indent=2))

    def model_path(self, machine_type: str = "rolling bearing") -> Path | None:
        p = self.active_dir / PACKS[machine_type].model_file
        return p if p.exists() else None

    def forecaster(self, machine_type: str = "rolling bearing") -> Forecaster:
        p = self.model_path(machine_type)
        return QuantileGBM.load(p) if p is not None else TrendExtrapolation()

    # ------------------------------------------------------------- pulling

    def pull(self, hub: Hub, own_runs: list[RunHealth]) -> dict:
        """Apply new alerts, stage the newest monthly bundle with its test report."""
        s = self.state()
        seen = set(s["alerts"]) | {h["version"] for h in s["history"]}
        if s["staged"]:
            seen.add(s["staged"]["version"])
        key = hub.key()
        out: dict = {"alerts": [], "staged": None, "rejected": []}
        for v in hub.versions():
            if v in seen:
                continue
            folder = hub.folder(v)
            try:
                m = bundle.verify(folder, key)
            except bundle.BadBundle as e:
                out["rejected"].append({"version": v, "why": str(e)})
                continue
            if m.kind == "alert":
                added = self.memory.add(bundle.lessons_in(folder))
                s["alerts"].append(v)
                out["alerts"].append({"version": v, "lessons": [x.title for x in added]})
            elif m.kind == "monthly" and v > (s["active"] or 0):
                s["staged"] = {
                    "version": v,
                    "folder": str(folder),
                    "report": self.test(folder, m, own_runs),
                }
                out["staged"] = s["staged"]
        self._save(s)
        return out

    def test(self, folder: Path, m: bundle.Manifest, own_runs: list[RunHealth]) -> dict:
        """The staged model against the one in use, on own failures it never saw."""
        model_file = PACKS["rolling bearing"].model_file
        path = folder / "models" / model_file
        if not path.exists():
            return {"passes": True, "reason": "no model in this bundle: lessons only"}
        fresh = [h for h in own_runs if h.failed and h.run_id not in set(m.trained_on)]
        if not fresh:
            return {
                "passes": None,
                "reason": "no failures at this site that the update was not trained on: a person decides",
                "runs": 0,
            }
        current, candidate = self.forecaster(), QuantileGBM.load(path)
        now = summarise([score_run(current, h) for h in fresh])
        new = summarise([score_run(candidate, h) for h in fresh])
        better = (
            new.norm_error is not None
            and now.norm_error is not None
            and new.norm_error <= now.norm_error
            and (new.late or 0.0) <= (now.late or 0.0)
        )
        return {
            "passes": better,
            "reason": "no worse on error and on early end too late"
            if better
            else "worse than the model in use",
            "runs": len(fresh),
            "current": {
                "model": current.name,
                "error": now.norm_error,
                "late": now.late,
                "inside": now.coverage,
            },
            "candidate": {
                "model": candidate.name,
                "error": new.norm_error,
                "late": new.late,
                "inside": new.coverage,
            },
        }

    # ------------------------------------------------------------- installing

    def approve(self, by: str) -> dict:
        if not by.strip():
            raise ValueError("a person approves an update: give a name")
        s = self.state()
        staged = s["staged"]
        if not staged:
            raise ValueError("nothing staged")
        if staged["report"]["passes"] is False:
            raise ValueError("the update is worse than the model in use on this site's failures")
        folder = Path(staged["folder"])
        bundle.verify(folder, Hub(folder.parent.parent).key())  # check again: it may have changed
        if self.active_dir.exists() and s["active"] is not None:
            keep = self.kept / f"{s['active']:05d}"
            shutil.rmtree(keep, ignore_errors=True)
            shutil.copytree(self.active_dir, keep)
        shutil.rmtree(self.active_dir, ignore_errors=True)
        self.active_dir.mkdir(parents=True)
        if (folder / "models").exists():
            for f in (folder / "models").iterdir():
                shutil.copyfile(f, self.active_dir / f.name)
        added = self.memory.add(bundle.lessons_in(folder))
        s["history"].append(
            {
                "version": staged["version"],
                "approved_by": by,
                "at": _now(),
                "report": staged["report"],
                "previous": s["active"],
            }
        )
        s["active"], s["staged"] = staged["version"], None
        self._save(s)
        return {"active": s["active"], "lessons_added": len(added)}

    def rollback(self, by: str) -> dict:
        s = self.state()
        if not s["history"]:
            raise ValueError("nothing to roll back")
        last = s["history"][-1]
        prev = last["previous"]
        shutil.rmtree(self.active_dir, ignore_errors=True)
        if prev is not None and (self.kept / f"{prev:05d}").exists():
            shutil.copytree(self.kept / f"{prev:05d}", self.active_dir)
        s["history"].append(
            {
                "version": prev,
                "approved_by": by,
                "at": _now(),
                "report": {"rollback_of": last["version"]},
                "previous": last["version"],
            }
        )
        s["active"] = prev
        self._save(s)
        return {"active": prev}
