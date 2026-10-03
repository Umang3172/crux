"""When to fix: forecast how long until a degrading bearing crosses the danger line.

The investigation decides *what* is wrong; this package only estimates *when* it
becomes urgent, as a range. It never reads or writes the investigation's
beliefs, and it never runs before the watcher (onset.py) has seen the level
leave healthy. Without scikit-learn or a trained model file it falls back to
trend extrapolation, which needs only numpy. See docs/FORECAST.md.
"""

from .health import RunHealth, SnapshotHealth, snapshot_health
from .models import (
    AverageLife,
    Forecast,
    Forecaster,
    QuantileGBM,
    TrendExtrapolation,
    get_forecaster,
    when_to_fix,
)
from .onset import detect_onset

__all__ = [
    "AverageLife",
    "Forecast",
    "Forecaster",
    "QuantileGBM",
    "RunHealth",
    "SnapshotHealth",
    "TrendExtrapolation",
    "detect_onset",
    "get_forecaster",
    "snapshot_health",
    "when_to_fix",
]
