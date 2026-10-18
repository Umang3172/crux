"""The Trends tab's backend, offline: SQL that says what it claims, stand-ins that
never look past "as of", the spend guard, the number check on Gemini's words,
and the API serving snapshots. Nothing here calls Google."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from hypothesis_engine.api.app import app
from hypothesis_engine.series import ask as ask_data
from hypothesis_engine.series import bigquery as bq
from hypothesis_engine.series import offline, settings, snapshot, sources, summary, views

WHERE = bq.Where("my-project-1", "crux_ts")


# SQL


def test_forecast_sql_asks_timesfm_3_for_three_targets_with_both_kinds_of_helper() -> None:
    sql = bq.forecast_sql(WHERE, settings.span("day"))
    assert "model => 'TimesFM 3.0'" in sql
    assert "target_cols => ['loaded', 'motor_current', 'oil_temp']" in sql
    assert "past_covariate_cols => ['reservoirs']" in sql
    assert "future_covariate_cols => ['hour_sin', 'hour_cos']" in sql
    assert "id_cols => ['preset']" in sql
    assert "horizon => 96" in sql and "context_window => 2048" in sql
    assert "`my-project-1.crux_ts.metro_15min`" in sql
    # the step at "as of" is forecast, never history
    assert "m.ts < p.as_of" in sql
    for p in settings.METRO_PRESETS:
        assert f"'{p.id}' AS preset" in sql


def test_forecast_sql_refuses_what_timesfm_3_cannot_take() -> None:
    with pytest.raises(ValueError):
        bq.forecast_sql(WHERE, settings.span("2w"))  # an ARIMA_PLUS span
    with pytest.raises(ValueError):
        bq.forecast_sql(WHERE, settings.span("day"), context=100)  # not a multiple of 32
    assert (
        len(settings.METRO_TARGETS) + len(settings.METRO_PAST) + len(settings.FUTURE_COVARIATES)
        <= bq.MAX_COLUMNS
    )


def test_names_are_checked_before_they_reach_sql() -> None:
    with pytest.raises(ValueError):
        bq.Where("x; DROP TABLE t", "crux_ts")
    with pytest.raises(ValueError):
        bq.Where("my-project-1", "crux-ts`")
    with pytest.raises(ValueError):
        WHERE.table("metro`; --")
    with pytest.raises(ValueError):
        bq.ims_anomalies_sql(WHERE, "x'; --", [np.datetime64("2000-01-01T00:00")])


def test_anomaly_sql_checks_each_moment_and_signal_from_history_before_its_week() -> None:
    sql = bq.anomalies_sql(WHERE)
    assert "AI.DETECT_ANOMALIES" in sql and "model => 'TimesFM 3.0'" in sql
    assert "id_cols => ['preset', 'signal', 'day']" in sql
    assert "GENERATE_ARRAY(0, 6)" in sql  # a week, a day at a time
    assert f"anomaly_prob_threshold => {settings.ANOMALY_PROB}" in sql
    assert "WHERE NOT checked" in sql and "WHERE checked" in sql


def test_arima_and_contribution_sql() -> None:
    create = bq.arima_create_sql(WHERE)
    assert "model_type = 'ARIMA_PLUS'" in create and "time_series_id_col = 'series'" in create
    assert "NOT m.filled" in create and "m.ts < p.as_of" in create
    assert "ML.EXPLAIN_FORECAST" in bq.explain_sql(WHERE)
    leak = settings.preset("metro", "leak2")
    ca = bq.changes_create_sql(WHERE, leak)
    assert "model_type = 'CONTRIBUTION_ANALYSIS'" in ca
    assert "contribution_metric = 'SUM(loaded_min)/SUM(running_min)'" in ca
    assert "is_test_col = 'is_test'" in ca
    with pytest.raises(ValueError):
        bq.changes_create_sql(WHERE, settings.preset("metro", settings.CONTROL_PRESET))


# The spend guard


class _Job:
    def __init__(self, n: int, rows: list[dict] | None = None) -> None:
        self.total_bytes_processed = n
        self.total_bytes_billed = n
        self.job_id = "job-1"
        self._rows = rows or []

    def result(self) -> list[SimpleNamespace]:
        return [SimpleNamespace(items=lambda r=r: r.items()) for r in self._rows]


class _Client:
    def __init__(self, n: int) -> None:
        self.n = n
        self.ran: list[str] = []

    def query(self, sql: str, job_config: SimpleNamespace) -> _Job:
        if not job_config.dry_run:
            self.ran.append(sql)
        return _Job(self.n, [{"x": 1}])


def _runner(tmp_path, n: int, budget: float, dry: bool = False) -> bq.Runner:
    r = object.__new__(bq.Runner)
    r.bq = SimpleNamespace(QueryJobConfig=lambda **kw: SimpleNamespace(**{"dry_run": False, **kw}))
    r.client = _Client(n)
    r.where = WHERE
    r.location = "asia-south1"
    r.ledger = bq.Ledger(tmp_path / "ledger.json")
    r.budget = budget
    r.dry_only = dry
    r.planned = 0.0
    return r


def test_a_job_past_the_budget_is_refused_before_it_runs(tmp_path) -> None:
    r = _runner(tmp_path, n=1 << 40, budget=5.0)  # 1 TiB at $7.50 per TiB
    with pytest.raises(bq.BudgetExceeded):
        r.query("SELECT 1", "big")
    assert r.client.ran == [] and r.ledger.entries() == []


def test_a_job_within_the_budget_runs_capped_and_lands_in_the_ledger(tmp_path) -> None:
    r = _runner(tmp_path, n=20 << 20, budget=5.0)
    assert r.query("SELECT 1", "small") == [{"x": 1}]
    (entry,) = r.ledger.entries()
    assert entry["label"] == "small" and entry["billed_bytes"] == 20 << 20
    assert entry["usd"] == pytest.approx((20 << 20) / bq.TIB * settings.QUERY_USD_PER_TIB)


def test_a_dry_run_runs_nothing_and_adds_up_what_it_would_cost(tmp_path) -> None:
    r = _runner(tmp_path, n=1 << 20, budget=5.0, dry=True)
    r.query("SELECT 1", "a")
    r.query("CREATE MODEL m OPTIONS (model_type = 'ARIMA_PLUS') AS SELECT 1", "b", kind="model")
    assert r.client.ran == [] and r.ledger.entries() == []
    expected = bq.usd(bq.MIN_BILLED, "query") + bq.usd(bq.MIN_BILLED * bq.ARIMA_CANDIDATES, "model")
    assert r.planned == pytest.approx(expected)


# Parsing BigQuery's answer


def _utc(iso: str) -> datetime:
    return datetime.fromisoformat(iso).replace(tzinfo=UTC)


def test_forecast_rows_become_bands_from_as_of_on() -> None:
    p = settings.preset("metro", "leak2")
    rows = []
    for k, ts in enumerate(["2020-05-29T07:45", "2020-05-29T08:00", "2020-05-29T08:15"]):
        cell = {
            "value": float(k),
            "prediction_interval_lower_bound": k - 1.0,
            "prediction_interval_upper_bound": k + 1.0,
        }
        rows.append(
            {
                "preset": "leak2",
                "ts": _utc(ts),
                "loaded": cell,
                "motor_current": cell,
                "oil_temp": cell,
                "ai_forecast_status": "",
            }
        )
    bands = bq.parse_forecast(rows, [p])["leak2"]
    assert bands["loaded"].mid.tolist() == [1.0, 2.0]  # the 07:45 row is history, dropped
    rows[1]["ai_forecast_status"] = "series too short"
    with pytest.raises(RuntimeError):
        bq.parse_forecast(rows, [p])


# The prepared tables and the stand-ins


def test_a_missing_step_takes_the_day_before_and_is_marked() -> None:
    v = np.array([1.0, 2.0, np.nan, 4.0, np.nan, np.nan])
    assert bq.np.allclose(sources.fill_from_day_before(v, period=2), [1, 2, 1, 4, 1, 4])


def test_coarsen_means_whole_blocks() -> None:
    t = np.datetime64("2020-02-01T00:00") + np.arange(6).astype("timedelta64[m]")
    table = sources.Table(1, t, {"x": np.arange(6.0)}, np.array([1, 1, 0, 0, 0, 1], dtype=bool))
    out = sources.coarsen(table, 3)
    assert out.cols["x"].tolist() == [1.0, 4.0]
    assert out.filled.tolist() == [True, False]


def _synthetic(cadence: int) -> sources.Table:
    """Five and a half months of a daily rhythm from 1 Feb 2020, every column the stand-ins read."""
    n = 170 * 24 * 60 // cadence
    t = np.datetime64("2020-02-01T00:00") + (np.arange(n) * cadence).astype("timedelta64[m]")
    day = np.sin(2 * np.pi * np.arange(n) * cadence / 1440)
    rng = np.random.default_rng(0)
    cols = {
        "loaded": 30 + 20 * day + rng.normal(0, 2, n),
        "motor_current": 3 + 2 * day + rng.normal(0, 0.2, n),
        "oil_temp": 60 + 5 * day,
        "tp3": np.full(n, 9.0),
        "reservoirs": np.full(n, 9.0),
        "towers": np.ones(n),
    }
    return sources.Table(cadence, t, cols, np.zeros(n, dtype=bool))


@pytest.fixture
def synthetic(monkeypatch, tmp_path):
    tables = {c: _synthetic(c) for c in sources.CADENCES}
    monkeypatch.setattr(sources, "metro", lambda c: tables[c])
    monkeypatch.setattr(sources, "ims_runs", lambda: {})
    monkeypatch.setattr(settings, "SNAPSHOT_DIR", tmp_path / "snapshots")
    return tables


def test_stand_in_forecasts_never_look_past_as_of(synthetic) -> None:
    p = settings.preset("metro", "normal")
    for sp in settings.SPANS:
        before = offline.forecast(p, sp)
        table = synthetic[sp.cadence_min]
        i0 = table.index(views.as_of(p))
        for col in table.cols.values():
            col[i0:] += 1000.0  # change everything from "as of" on
        after = offline.forecast(p, sp)
        for b, a in zip(before["signals"], after["signals"], strict=True):
            assert b["forecast"] == a["forecast"]
            assert b["actual"] != a["actual"]  # the replay does see it


def test_stand_in_anomalies_flag_a_jump_in_the_checked_week(synthetic) -> None:
    p = settings.preset("metro", "normal")
    table = synthetic[settings.WINDOW_CADENCE_MIN]
    i = table.index(views.as_of(p))
    table.cols["oil_temp"][i : i + 4] += 50.0
    view = offline.anomalies("metro", p)
    oil = next(s for s in view["signals"] if s["id"] == "oil_temp")
    flagged_t = {oil["t"][k] for k in oil["flagged"]}
    assert set(views.epoch(table.t[i : i + 4])) <= flagged_t
    assert view["made"]["engine"] == views.OFFLINE


def test_every_offline_view_builds_and_says_it_is_a_stand_in(synthetic) -> None:
    p = settings.preset("metro", "leak1")
    for view in snapshot.VIEWS["metro"]:
        data = snapshot.build_offline("metro", p, view)
        assert data["made"]["engine"] == views.OFFLINE
    with pytest.raises(snapshot.NotAvailable):
        snapshot.build_offline("metro", settings.preset("metro", "normal"), "changes")


def test_a_reading_outside_the_band_counts_only_while_the_motor_ran(synthetic) -> None:
    p = settings.preset("metro", "normal")
    table = synthetic[settings.WINDOW_CADENCE_MIN]
    minute = synthetic[1]
    i = table.index(views.as_of(p))
    table.cols["oil_temp"][i : i + 4] += 50.0  # four steps far outside any band
    m = minute.index(table.t[i])
    minute.cols["motor_current"][m : m + 2 * settings.WINDOW_CADENCE_MIN] = 0.04  # parked for two
    view = offline.anomalies("metro", p)
    oil = next(s for s in view["signals"] if s["id"] == "oil_temp")
    flagged = {oil["t"][k] for k in oil["flagged"]}
    counted = {oil["t"][k] for k in oil["counted"]}
    off, on = views.epoch(table.t[i : i + 2]), views.epoch(table.t[i + 2 : i + 4])
    assert set(off + on) <= flagged
    assert not set(off) & counted
    assert set(on) <= counted
    assert view["not_counted_off"] == view["flagged"] - view["counted"] >= 2


def test_a_leak_week_is_served_beside_the_normal_weeks_count(synthetic) -> None:
    leak = snapshot.load("metro", "leak1", "anomalies")
    normal = snapshot.load("metro", "normal", "anomalies")
    assert "normal" not in normal
    assert leak["normal"]["before"] == views.tally(normal)["before"]
    assert leak["normal"]["after"] == normal["counted_after_as_of"]


def test_saved_weeks_are_counted_again_without_any_model(synthetic) -> None:
    original = offline.anomalies("metro", settings.preset("metro", "leak2"))
    stale = {k: v for k, v in original.items() if not k.startswith(("counted", "not_counted"))}
    stale["signals"] = [
        {k: v for k, v in s.items() if not k.startswith("counted")} for s in original["signals"]
    ]
    snapshot.save("bigquery", stale)
    assert snapshot.recount("bigquery")
    again = snapshot.read("bigquery", "metro", "leak2", "anomalies")
    assert again["signals"] == original["signals"]
    assert (again["counted"], again["not_counted_off"]) == (
        original["counted"],
        original["not_counted_off"],
    )


def test_the_facts_set_a_leak_week_beside_the_normal_week(synthetic) -> None:
    lines = summary.facts(
        "metro", snapshot._getter("metro", "leak1"), snapshot._getter("metro", "normal")
    )
    assert any("in the normal week the same forecast expected" in f for f in lines)
    assert any(f.startswith("While the motor ran") and "in the normal week" in f for f in lines)
    assert any("reported an air leak 16 hours after the moment" in f for f in lines)
    alone = summary.facts("metro", snapshot._getter("metro", "normal"))
    assert not any("normal week" in f or "air leak" in f for f in alone)


# Gemini's words


def test_the_summary_keeps_only_numbers_the_facts_state() -> None:
    facts = ["It ran loaded 36.5% of the day against an expected 15.1%."]
    assert summary.checked("It ran loaded 36.5%, not 15.1%.", facts)
    assert not summary.checked("It ran loaded 40% of the day.", facts)  # invented
    assert not summary.checked("It ran loaded 36.5% of the day and", facts)  # cut off

    def inventor(_: list[str]) -> str:
        return "Loaded share hit 99.9%."

    get = {"anomalies": None}.get
    out = summary.summarise("metro", "leak2", get, "bigquery", inventor, "gemini:test")
    assert out["writer"].startswith("template")


# The API


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "SNAPSHOT_DIR", tmp_path / "snapshots")
    monkeypatch.setattr(sources, "SERIES_DIR", tmp_path)
    monkeypatch.setattr(sources, "ims_runs", lambda: {})
    sources.metro.cache_clear()
    monkeypatch.delenv("CRUX_SERIES_ASK", raising=False)
    yield TestClient(app)
    sources.metro.cache_clear()


def _saved(engine: str, view: str, **extra) -> dict:
    data = {
        "source": "metro",
        "preset": "leak2",
        "view": view,
        "text": "saved",
        "sentences": ["saved"],
        "facts": [],
        "writer": "gemini:test",
        "made": {
            "engine": engine,
            "model": "m",
            "product": "p",
            "computed_at": "2026-10-14T00:00:00+00:00",
        },
        **extra,
    }
    snapshot.save(engine, data)
    return data


def test_a_bigquery_snapshot_is_served_before_an_offline_one(api) -> None:
    _saved("offline", "summary", text="offline")
    _saved("bigquery", "summary", text="from bigquery")
    r = api.get("/series/metro/summary", params={"preset": "leak2"})
    assert r.status_code == 200
    assert r.json()["text"] == "from bigquery"


def test_without_data_a_view_says_why_instead_of_failing(api) -> None:
    r = api.get("/series/metro/forecast", params={"preset": "leak2", "span": "day"})
    assert r.status_code == 404
    assert "not on this server" in r.json()["detail"]
    assert api.get("/series/pump/anomalies", params={"preset": "x"}).status_code == 404
    assert api.get("/series/metro/anomalies", params={"preset": "nope"}).status_code == 404
    assert (
        api.get("/series/ims/forecast", params={"preset": "ims/test2/bearing1"}).status_code == 404
    )


def test_the_catalog_lists_both_sources_and_the_bearing_note(api) -> None:
    c = api.get("/series/catalog").json()
    ids = [s["id"] for s in c["sources"]]
    assert ids == ["metro", "ims"]
    ims = c["sources"][1]
    assert "TimesFM" in ims["note"] and ims["views"] == ["anomalies", "summary"]
    assert c["ask"]["live"] is False


def test_the_tab_offers_only_the_forecasts_a_benchmark_has_scored(api) -> None:
    metro = api.get("/series/catalog").json()["sources"][0]
    offered = {s["id"]: s["model"] for s in metro["spans"]}
    assert offered == {"hour": "TimesFM 3.0", "day": "TimesFM 3.0"}
    # Still computed: the ARIMA_PLUS parts are what the summary is written from.
    assert "forecast-2w" in metro["views"] and "breakdown" in metro["views"]


def test_live_questions_are_off_unless_switched_on(api, tmp_path) -> None:
    assert api.post("/series/ask", json={"question": "How hot did the oil get?"}).status_code == 404
    ex = api.get("/series/ask/examples").json()
    assert ex == {"live": False, "answers": []}
    snapshot.save_examples([])
    assert json.loads(snapshot.examples_path().read_text()) == {"answers": []}


# The agent's stream, in the order Google sent it for one question on 14 Oct 2026:
# progress notes while it works, then the answer, the data and the chart together.
_SQL = "SELECT month, AVG(oil_temp) AS t\nFROM crux_ts.metro_60min\nGROUP BY month"
_STREAM = [
    {
        "text": {
            "parts": ["Analyzing context", "Retrieving context for 3 tables."],
            "textType": "THOUGHT",
        }
    },
    {
        "text": {
            "parts": ["Context retrieved", "Retrieved context for 3 tables."],
            "textType": "THOUGHT",
        }
    },
    {"text": {"parts": ["Running a query", _SQL], "textType": "THOUGHT"}},
    {
        "text": {
            "parts": ["Query execution completed", "Query returned 2 rows in 2.75s."],
            "textType": "THOUGHT",
        }
    },
    {"text": {"parts": ["Oil ran warmest in July."], "textType": "FINAL_RESPONSE"}},
    {"data": {"generatedSql": _SQL}},
    {"data": {"bigQueryJob": {"jobId": "job_1", "location": "asia-south1"}}},
    {
        "data": {
            "result": {
                "schema": {"fields": [{"name": "month"}, {"name": "t"}]},
                "data": [{"month": "2020-06", "t": 65.7}, {"month": "2020-07", "t": 67.1}],
            }
        }
    },
    {"chart": {"query": {"dataResultName": "monthly"}}},
    {"chart": {"result": {"vegaConfig": {"mark": "line"}}}},
    {"text": {"parts": ["And in August?"], "textType": "FOLLOWUP_QUESTIONS"}},
]


def test_the_agent_stream_reads_as_phases_each_opened_and_closed_once_in_order() -> None:
    seen: list[tuple[str, str]] = []
    got = ask_data.read(
        ({"systemMessage": m} for m in _STREAM), lambda s, st, d: seen.append((s, st))
    )
    assert seen == [
        ("tables", "start"),
        ("tables", "done"),
        ("sql", "start"),
        ("sql", "done"),
        ("query", "start"),
        ("query", "done"),
        ("answer", "start"),
        ("chart", "start"),
        ("chart", "done"),
        ("answer", "done"),
    ]
    assert got["answer"] == "Oil ran warmest in July."
    assert got["sql"] == _SQL and got["columns"] == ["month", "t"]
    assert got["rows"] == [["2020-06", 65.7], ["2020-07", 67.1]]
    assert got["chart"] == {"mark": "line"} and got["jobs"] == [("job_1", "asia-south1")]


def test_without_progress_notes_the_data_still_closes_each_phase() -> None:
    seen: list[tuple[str, str, dict]] = []
    ask_data.read(_STREAM[4:8], lambda s, st, d: seen.append((s, st, d)))
    assert [(s, st) for s, st, _ in seen] == [
        ("answer", "start"),
        ("sql", "start"),
        ("sql", "done"),
        ("query", "start"),
        ("query", "done"),
        ("answer", "done"),
    ]
    assert seen[2][2] == {"lines": 3} and seen[4][2] == {"rows": 2}


def test_a_live_question_streams_one_line_per_step_then_the_answer(api, monkeypatch) -> None:
    assert api.post("/series/ask/live", json={"question": "How hot?"}).status_code == 404
    monkeypatch.setenv("CRUX_SERIES_ASK", "1")

    def fake(question, ledger=None, on_step=None):
        on_step("tables", "start", {})
        on_step("query", "done", {"rows": 2})
        return {"question": question, "answer": "warm"}

    monkeypatch.setattr(ask_data, "ask", fake)
    r = api.post("/series/ask/live", json={"question": "How hot did the oil get?"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/x-ndjson")
    lines = [json.loads(x) for x in r.text.splitlines()]
    assert [(x["step"], x["state"]) for x in lines] == [
        ("tables", "start"),
        ("query", "done"),
        ("result", "done"),
    ]
    assert lines[-1]["answer"] == {"question": "How hot did the oil get?", "answer": "warm"}

    def limited(question, ledger=None, on_step=None):
        raise ask_data.AskLimited("this server answers at most 60 questions an hour")

    monkeypatch.setattr(ask_data, "ask", limited)
    last = json.loads(
        api.post("/series/ask/live", json={"question": "How hot?"}).text.splitlines()[-1]
    )
    assert last["step"] == "error" and "60 questions" in last["detail"]["message"]
    assert api.post("/series/ask/live", json={"question": "x"}).status_code == 422
