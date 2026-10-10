#!/usr/bin/env python3
"""Set up a hub and its first updates, so one laptop can show learning across sites.

    uv run python scripts/fleet_demo.py

The hub plays the cloud. It holds lessons learned from the public datasets
(each says which), an alert about a quiet cage failure, and a monthly update
whose bearing time-left model is trained on every XJTU-SY failure. This laptop
then plays a second factory, the NASA IMS rig: start the API with

    CRUX_SITE=nasa-ims-rig CRUX_SITE_TABLES=health_ims.csv uv run hypengine serve

and press "Check for updates" on the Predictive maintenance tab. The update is
tested on the IMS failures it never saw before anyone can approve it.

Needs the health tables (`scripts/forecast.py table`). Writes data/hub/; never
touches a site's folder.
"""

from __future__ import annotations

import sys

from hypothesis_engine.fleet import Hub, Lesson
from hypothesis_engine.forecast import health
from hypothesis_engine.forecast.replay import FORECAST_DIR

BEARING, COMPRESSOR = "rolling bearing", "air compressor"

# What the datasets taught us, as lessons a site can use. Each says where it came from.
LESSONS = [
    Lesson(
        BEARING,
        "A restart is not wear",
        "after a stop and restart, every bearing on the shaft steps up 15 to 20% together",
        "wait for a bearing's level to double before calling it wear",
        avoid="alarming on a rise of a fifth after a restart",
        outcome="failure",
        source="NASA IMS test 1 (public data)",
    ),
    Lesson(
        BEARING,
        "Neighbours shake too",
        "a healthy bearing on the same shaft as a failing one loses health in the last hours",
        "find which bearing rose first; treat the later risers as shaken neighbours",
        avoid="replacing every bearing on the shaft",
        outcome="failure",
        source="NASA IMS tests 2 and 3 (public data)",
    ),
    Lesson(
        COMPRESSOR,
        "Use changes, so normal must move",
        "the compressor runs loaded more often for weeks after a change in timetable",
        "compare it with its own last four weeks, not with its first month",
        avoid="a fixed normal from the first month: 7 false alarms a month",
        outcome="failure",
        source="MetroPT-3 (public data)",
    ),
    Lesson(
        BEARING,
        "A photo cannot show loose bolts",
        "the camera check reports loose fasteners or wear on a machine that looks normal",
        "check bolts by hand; trust a photo only for leaks, smoke, guards and belts",
        avoid="sending someone for loose bolts a photo cannot show",
        outcome="failure",
        source="camera tests on rig photos (6 Oct 2026)",
    ),
]

ALERT = Lesson(
    BEARING,
    "Cage faults can stay quiet",
    "a bearing fails with no rise in overall vibration and no alarm",
    "watch spikiness (kurtosis) as well as overall vibration on bearings like this",
    avoid="reading no alarm as healthy",
    outcome="failure",
    source="XJTU-SY Bearing1_4, cage (public data)",
)


def main() -> int:
    table = FORECAST_DIR / "health_xjtu.csv"
    if not table.exists():
        print(
            "no XJTU-SY health table: run scripts/forecast.py table --dataset xjtu", file=sys.stderr
        )
        return 1
    hub = Hub().init()
    if hub.versions():
        print(f"{hub.root} already has bundles {hub.versions()}; delete it to start again")
        return 1
    hub.contribute("xjtu-lab", ALERT, major=True)
    for x in LESSONS:
        hub.contribute("public-datasets", x)
    training = [health.trim_stopped(h) for h in health.load(table)]
    folder = hub.monthly(
        training, note="trained on every XJTU-SY failure; lessons from the public datasets"
    )
    print(f"hub at {hub.root}: bundles {hub.versions()} (1 alert, then {folder.name} monthly)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
