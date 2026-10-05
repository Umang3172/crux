"""Fix now, or wait for the next planned stop?

A time-left range (p10, p50, p90) becomes the chance the part reaches the danger
line before a planned stop `stop_h` hours away. The range is read as a
log-normal: times to failure are positive and skewed late, and a log-normal is
pinned down by a median and one spread, which p50 and the p10-p90 width give.
That shape is an assumption, not something the data showed; the answer is a
planning aid, and the range itself stays on screen beside it.
"""

from __future__ import annotations

import math

from .models import Z90, Forecast


def risk_before(f: Forecast, stop_h: float) -> float:
    """Chance, 0..1, that the danger line comes before a stop `stop_h` hours from now."""
    if stop_h <= 0:
        return 0.0
    p10, p50, p90 = f.p10 / 60.0, f.p50 / 60.0, f.p90 / 60.0
    if p50 <= 0:
        return 1.0  # already at the line
    lo, hi = max(p10, 1e-6), max(p90, 1e-6)
    sigma = (math.log(hi) - math.log(lo)) / (2 * Z90)
    if sigma <= 0:
        return 1.0 if stop_h >= p50 else 0.0
    z = (math.log(stop_h) - math.log(p50)) / sigma
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def risk_before_hours(p10_h: float, p50_h: float, p90_h: float, stop_h: float) -> float:
    """`risk_before` for a range given in hours, as the replays store it."""
    return risk_before(Forecast(p10_h * 60.0, p50_h * 60.0, p90_h * 60.0, "range"), stop_h)
