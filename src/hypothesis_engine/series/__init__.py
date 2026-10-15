"""Trends: Google's time-series tools on the plant's sensor history.

Forecasts and analyses for the Trends tab, computed by BigQuery (TimesFM 3.0
through `AI.FORECAST` and `AI.DETECT_ANOMALIES`, `ARIMA_PLUS`, contribution
analysis) and summed up by Gemini, then saved as snapshots the API serves.
Offline stand-ins give the same shapes without Google Cloud, labelled as such.

Nothing here imports the investigation or the physics, and nothing here moves
a belief: it describes signals, it never diagnoses (docs/SERIES.md).
"""
