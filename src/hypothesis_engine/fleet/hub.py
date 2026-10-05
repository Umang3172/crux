"""The cloud side of learning across sites, run as a folder for now.

Sites send it contributions: a lesson and, for a failure, the part's health
trend (derived numbers, never raw recordings). It answers with bundles:

- an **alert** the moment a site confirms a major failure: that lesson, to every
  site with the same machine type, like an antivirus update;
- a **monthly** bundle: every lesson so far, and the time-left model retrained on
  every failure the hub has, with the runs it was trained on listed so each
  site can test it only on failures it has never seen.

On Google Cloud this folder becomes a bucket and the monthly step a scheduled
job; the layout and the checks stay the same.
"""

from __future__ import annotations

import json
import os
import secrets
import tempfile
from dataclasses import asdict
from pathlib import Path

from ..forecast import health
from ..forecast.health import RunHealth
from ..forecast.models import QuantileGBM
from ..forecast.runs import DATA_ROOT
from . import bundle
from .memory import Lesson
from .packs import PACKS


def hub_dir() -> Path:
    return Path(os.getenv("CRUX_HUB", str(DATA_ROOT / "hub")))


class Hub:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root if root is not None else hub_dir()
        self.bundles = self.root / "bundles"
        self.inbox = self.root / "inbox"

    def init(self) -> Hub:
        self.bundles.mkdir(parents=True, exist_ok=True)
        self.inbox.mkdir(parents=True, exist_ok=True)
        keyfile = self.root / "hub.key"
        if not keyfile.exists():
            keyfile.write_text(secrets.token_hex(32))
        return self

    def key(self) -> bytes:
        return bundle.key_from(self.root / "hub.key")

    def versions(self) -> list[int]:
        if not self.bundles.exists():
            return []
        return sorted(int(p.name) for p in self.bundles.iterdir() if p.name.isdigit())

    def folder(self, version: int) -> Path:
        return self.bundles / f"{version:05d}"

    def _next(self) -> int:
        v = self.versions()
        return (v[-1] + 1) if v else 1

    # ------------------------------------------------------------- publishing

    def publish_alert(self, lessons: list[Lesson], note: str = "") -> Path:
        version = self._next()
        m = bundle.Manifest(
            version=version,
            kind="alert",
            hub=self.root.name,
            machine_types=sorted({x.machine_type for x in lessons}),
            note=note,
        )
        return bundle.write(self.folder(version), m, lessons, {}, self.key())

    def publish_monthly(
        self,
        lessons: list[Lesson],
        models: dict[str, Path],
        trained_on: list[str],
        note: str = "",
    ) -> Path:
        version = self._next()
        types = {x.machine_type for x in lessons} | {
            p.machine_type for p in PACKS.values() if p.model_file in models
        }
        m = bundle.Manifest(
            version=version,
            kind="monthly",
            hub=self.root.name,
            machine_types=sorted(types),
            trained_on=sorted(trained_on),
            note=note,
        )
        return bundle.write(self.folder(version), m, lessons, models, self.key())

    # ------------------------------------------------------------- contributions

    def contribute(
        self, site: str, lesson: Lesson, record: RunHealth | None = None, major: bool = False
    ) -> Path | None:
        """File a site's lesson (and failure trend). A major failure goes out at once."""
        box = self.inbox / site
        box.mkdir(parents=True, exist_ok=True)
        (box / f"{lesson.id}.json").write_text(json.dumps(asdict(lesson)))
        if record is not None:
            health.save([record], box / f"{lesson.id}.csv")
        if major:
            return self.publish_alert([lesson], note=f"major failure confirmed at {site}")
        return None

    def contributions(self) -> tuple[list[Lesson], list[RunHealth]]:
        lessons: list[Lesson] = []
        records: list[RunHealth] = []
        if not self.inbox.exists():
            return lessons, records
        for f in sorted(self.inbox.rglob("*.json")):
            d = json.loads(f.read_text())
            d["cases"] = tuple(d.get("cases", ()))
            lessons.append(Lesson(**d))
            csv = f.with_suffix(".csv")
            if csv.exists():
                records.extend(health.load(csv))
        return lessons, records

    def lessons(self) -> list[Lesson]:
        """Every lesson in every bundle so far, once each."""
        seen: dict[str, Lesson] = {}
        for v in self.versions():
            for x in bundle.lessons_in(self.folder(v)):
                seen.setdefault(x.id, x)
        return list(seen.values())

    # ------------------------------------------------------------- the monthly step

    def monthly(self, training: list[RunHealth], target: str = "residual", note: str = "") -> Path:
        """Retrain the bearing time-left model on every failure held, and ship it with all lessons."""
        contributed, records = self.contributions()
        pooled = [h for h in [*training, *records] if h.failed]
        model = QuantileGBM(target)
        model.fit(pooled)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "model.pkl"
            model.save(path)
            lessons = {x.id: x for x in [*self.lessons(), *contributed]}
            return self.publish_monthly(
                list(lessons.values()),
                {PACKS["rolling bearing"].model_file: path},
                [h.run_id for h in pooled],
                note or f"{len(pooled)} failed bearings, {len(lessons)} lessons",
            )
