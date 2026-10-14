"""Views saved as JSON, and the catalog of what can be shown.

`data/series/snapshots/<engine>/<source>/<preset>/<view>.json`. A request is
answered from a BigQuery snapshot when one exists, else from an offline one,
else the stand-in is computed now and saved (as `forecast.replay` does). So a
server never calls Google on a page view, and a server with no Google run still
shows the tab, labelled as a stand-in.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np

from . import ask, offline, settings, sources, summary, views

VIEWS: dict[str, tuple[str, ...]] = {
    "metro": (
        "forecast-hour",
        "forecast-day",
        "forecast-2w",
        "anomalies",
        "breakdown",
        "changes",
        "summary",
    ),
    "ims": ("anomalies", "summary"),
}

ENGINES = ("bigquery", "offline")


class NotAvailable(LookupError):
    """The view cannot be shown here: the data is missing, or it does not apply."""


def _dir(engine: str, source: str, preset_id: str) -> Path:
    return settings.SNAPSHOT_DIR / engine / source / preset_id.replace("/", "__")


def path(engine: str, source: str, preset_id: str, view: str) -> Path:
    return _dir(engine, source, preset_id) / f"{view}.json"


def save(engine: str, data: dict[str, Any]) -> Path:
    p = path(engine, data["source"], data["preset"], data["view"])
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")))
    tmp.replace(p)
    return p


def read(engine: str, source: str, preset_id: str, view: str) -> dict[str, Any] | None:
    p = path(engine, source, preset_id, view)
    if not p.is_file():
        return None
    return json.loads(p.read_text())


def examples_path() -> Path:
    return settings.SNAPSHOT_DIR / "bigquery" / "ask_examples.json"


def save_examples(answers: list[dict[str, Any]]) -> Path:
    p = examples_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"answers": answers}, separators=(",", ":"), default=str))
    return p


def examples() -> list[dict[str, Any]]:
    p = examples_path()
    return json.loads(p.read_text())["answers"] if p.is_file() else []


def check(source: str, preset_id: str, view: str) -> settings.Preset:
    if source not in VIEWS:
        raise NotAvailable(f"no source {source!r}")
    if view not in VIEWS[source]:
        raise NotAvailable(f"{view} is not offered for {source}")
    try:
        return settings.preset(source, preset_id)
    except KeyError:
        raise NotAvailable(f"no moment {preset_id!r} for {source}") from None


def load(source: str, preset_id: str, view: str) -> dict[str, Any]:
    """The best saved view, or the stand-in computed now."""
    p = check(source, preset_id, view)
    for engine in ENGINES:
        found = read(engine, source, preset_id, view)
        if found is not None:
            return found
    data = build_offline(source, p, view)
    try:
        save("offline", data)
    except OSError:  # a read-only data folder still serves the view
        pass
    return data


def build_offline(source: str, p: settings.Preset, view: str) -> dict[str, Any]:
    try:
        if source == "ims":
            if p.id not in sources.ims_runs():
                raise NotAvailable("the bearing health table is not on this server")
            if view == "anomalies":
                return offline.anomalies("ims", p)
            return summary.summarise(
                "ims", p.id, _getter("ims", p.id), views.OFFLINE, None, "template"
            )
        if view.startswith("forecast-"):
            return offline.forecast(p, settings.span(view.removeprefix("forecast-")))
        if view == "anomalies":
            return offline.anomalies("metro", p)
        if view == "breakdown":
            return offline.breakdown(p)
        if view == "changes":
            if p.id == settings.CONTROL_PRESET:
                raise NotAvailable("this is the normal week the others are compared with")
            return offline.changes(p)
        if view == "summary":
            return summary.summarise(
                "metro", p.id, _getter("metro", p.id), views.OFFLINE, None, "template"
            )
    except FileNotFoundError as exc:
        raise NotAvailable(f"the compressor history is not on this server ({exc})") from None
    raise NotAvailable(view)


def _getter(source: str, preset_id: str) -> Callable[[str], dict[str, Any] | None]:
    def get(view: str) -> dict[str, Any] | None:
        try:
            return load(source, preset_id, view)
        except NotAvailable:
            return None

    return get


def engines(source: str, preset_id: str) -> dict[str, str | None]:
    """Which engine each view would be served from right now (None: computed on request)."""
    out: dict[str, str | None] = {}
    for view in VIEWS[source]:
        out[view] = next((e for e in ENGINES if path(e, source, preset_id, view).is_file()), None)
    return out


def _epoch(iso: str) -> int:
    return views.epoch(np.array([np.datetime64(iso, "m")]))[0]


def _signal(s: settings.Signal) -> dict[str, str]:
    return {"id": s.id, "name": s.name, "unit": s.unit}


def catalog() -> dict[str, Any]:
    metro_ready = (
        sources.metro_path(1).is_file()
        or settings.SNAPSHOT_DIR.joinpath("bigquery", "metro").is_dir()
    )
    ims = sources.ims_runs()
    ims_ready = bool(ims) or settings.SNAPSHOT_DIR.joinpath("bigquery", "ims").is_dir()
    return {
        "sources": [
            {
                "id": "metro",
                "name": "Metro train air compressor",
                "kind": "compressor",
                "dataset": "MetroPT-3 (UCI dataset 791, CC BY 4.0): a metro train's air compressor, sampled every 10 s, 1 Feb to 1 Sep 2020",
                "available": metro_ready,
                "signals": [_signal(s) for s in settings.METRO_TARGETS],
                "helpers": {
                    "past": [_signal(s) for s in settings.METRO_PAST],
                    "future": list(settings.FUTURE_COVARIATES),
                },
                "presets": [
                    {
                        "id": p.id,
                        "label": p.label,
                        "as_of": _epoch(p.as_of),
                        "note": p.note,
                        "engines": engines("metro", p.id),
                    }
                    for p in settings.METRO_PRESETS
                ],
                "spans": [
                    {
                        "id": s.id,
                        "label": s.label,
                        "cadence_min": s.cadence_min,
                        "horizon": s.horizon,
                        "model": s.model,
                        "product": s.product,
                    }
                    for s in settings.SPANS
                ],
                "views": list(VIEWS["metro"]),
                "failures": [
                    {"start": _epoch(f["start"]), "end": _epoch(f["end"]), "label": f["label"]}
                    for f in sources.metro_failures()
                ],
                "note": None,
            },
            {
                "id": "ims",
                "name": "Bearing test rig",
                "kind": "bearing",
                "dataset": "NASA IMS bearing run-to-failure tests, a snapshot every 10 minutes",
                "available": ims_ready,
                "signals": [_signal(s) for s in settings.IMS_SIGNALS],
                "helpers": {"past": [], "future": []},
                "presets": [
                    {
                        "id": p.id,
                        "label": p.label,
                        "as_of": None,
                        "note": p.note,
                        "engines": engines("ims", p.id),
                        "machine": p.id.rsplit("/", 1)[0],
                    }
                    for p in settings.IMS_PRESETS
                ],
                "spans": [],
                "views": list(VIEWS["ims"]),
                "failures": [],
                "note": "Time left for a bearing comes from our own model, not TimesFM: on held-out bearings TimesFM levels a growing fault off (tested 13 Oct 2026).",
            },
        ],
        "products": PRODUCTS,
        "ask": {"live": ask.enabled(), "examples": len(examples())},
    }


#: Which Google product does which job, for the tab's "How this was made".
PRODUCTS = [
    {
        "job": "Next hour and next day, three signals at once",
        "product": "TimesFM 3.0 in BigQuery (AI.FORECAST)",
    },
    {
        "job": "Readings outside the expected band",
        "product": "TimesFM 3.0 in BigQuery (AI.DETECT_ANOMALIES)",
    },
    {
        "job": "Next two weeks, and the parts of a signal",
        "product": "BigQuery ML ARIMA_PLUS (ML.EXPLAIN_FORECAST)",
    },
    {
        "job": "What changed against a normal week",
        "product": "BigQuery ML contribution analysis (ML.GET_INSIGHTS)",
    },
    {"job": "Summary in plain words", "product": "Gemini on Vertex AI"},
    {
        "job": "Ask the data",
        "product": "Conversational Analytics API (Gemini data agent over BigQuery)",
    },
]
