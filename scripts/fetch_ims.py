#!/usr/bin/env python3
"""Fetch the IMS run-to-failure bearing data into data/ims/.

    uv run python scripts/fetch_ims.py            # show the plan, then ask
    uv run python scripts/fetch_ims.py --dry-run  # show the plan and stop
    uv run python scripts/fetch_ims.py --yes      # no prompt

**A human runs this, not an agent**, like scripts/fetch_cwru.py. Nothing imports
it and no test calls it.

Attribution
-----------
Data: Center for Intelligent Maintenance Systems (IMS), University of
Cincinnati, distributed by the NASA Prognostics Center of Excellence
(data.nasa.gov/dataset/ims-bearings). Licence: U.S. Government Works
(catalog.data.gov/dataset/ims-bearings, read 3 Oct 2026). Not redistributed in
this repository; each person fetches their own copy.

What it fetches
---------------
One file, IMS.zip, 1,061,902,801 bytes (size read 3 Oct 2026). It unpacks it
into data/ims/. If the zip holds further archives (.rar or .7z), it lists them
and stops: extract those yourself (for example `unar <file>`), keeping the
`1st_test`, `2nd_test` and `3rd_test` (or `4th_test`) folder names, which
forecast/runs.py uses to tell the tests apart.
"""

from __future__ import annotations

import argparse
import sys
import urllib.request
import zipfile
from pathlib import Path

URL = "https://data.nasa.gov/docs/legacy/IMS.zip"
SIZE_BYTES = 1_061_902_801
DEST = Path(__file__).resolve().parents[1] / "data" / "ims"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Fetch IMS bearing data into data/ims/")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--yes", action="store_true")
    args = ap.parse_args(argv)

    target = DEST / "IMS.zip"
    print(
        f"Will download {URL}\n  {SIZE_BYTES / 1e9:.2f} GB -> {target}\n  then unpack into {DEST}"
    )
    if args.dry_run:
        return 0
    if not args.yes and input("Proceed? [y/N] ").strip().lower() != "y":
        return 1

    DEST.mkdir(parents=True, exist_ok=True)
    if not target.exists() or target.stat().st_size != SIZE_BYTES:
        urllib.request.urlretrieve(URL, target)
    if target.stat().st_size != SIZE_BYTES:
        print(f"size mismatch: got {target.stat().st_size} bytes", file=sys.stderr)
        return 1
    with zipfile.ZipFile(target) as z:
        z.extractall(DEST)
    nested = [
        p for p in DEST.rglob("*") if p.suffix.lower() in (".rar", ".7z", ".zip") and p != target
    ]
    if nested:
        print("Extract these yourself, in place, then run `scripts/forecast.py table`:")
        for p in nested:
            print(f"  {p}")
    else:
        print("Done. Next: uv run python scripts/forecast.py table --dataset ims")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
