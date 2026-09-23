#!/usr/bin/env python3
"""Fetch a subset of the CWRU bearing dataset into data/cwru/.

    uv run python scripts/fetch_cwru.py            # show the plan, then ask
    uv run python scripts/fetch_cwru.py --dry-run  # show the plan and stop
    uv run python scripts/fetch_cwru.py --yes      # no prompt (CI, scripted setup)

**A human runs this, not an agent.** It is the only thing in the repository that
touches the network, it is deliberately not imported by any module, and nothing
in the test suite calls it. `uv run hypengine benchmark` degrades to a clear
message when the folder is empty, so a checkout without the data still works.

Attribution
-----------
Data: Case Western Reserve University Bearing Data Center,
https://engineering.case.edu/bearingdatacenter — free to use with
acknowledgement of CWRU as the source. The files are not redistributed in this
repository (see `.gitignore`); each person fetches their own copy. Cite CWRU in
the submission, the slides and anywhere a number from this benchmark appears.

What it fetches
---------------
The 12 kHz drive-end subset only: four healthy baselines plus inner- and
outer-race defects at 0.007", 0.014" and 0.021", each at all four motor loads.
Twenty-eight files, roughly 100 MB. That is enough to show the investigator on
every race fault at every load without downloading the whole 48 kHz set, which
our loader would mislabel as 12 kHz anyway.

Ball-defect (B***) files are deliberately left out: this engine has no
ball-defect hypothesis, so it could only ever get them wrong. See docs/DATA.md.
"""

from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

# The Data Center serves every recording as <number>.mat under one directory.
# If they reorganise the site, this is the single line to change — the script
# prints every URL before fetching anything so a mismatch is obvious.
BASE_URL = "https://engineering.case.edu/sites/default/files"

# A 404 or a captive-portal page comes back as a few kB of HTML. The real
# recordings are megabytes, so anything small is a failed download, not data.
MIN_PLAUSIBLE_BYTES = 200_000

DEST = Path(__file__).resolve().parents[1] / "data" / "cwru"

# (CWRU file number, the name we save it as). The local names follow the
# dataset's own convention so `data/cwru.py` can read the ground truth straight
# out of the filename: fault code, diameter in thousandths of an inch, clock
# position for outer-race defects, then motor load in hp.
#
# File numbers are from the CWRU download tables: "Normal Baseline Data" and
# "12k Drive End Bearing Fault Data". Loads run 0, 1, 2, 3 hp in that order.
SUBSET: tuple[tuple[int, str], ...] = (
    # Healthy baselines, 0-3 hp.
    (97, "normal_0.mat"),
    (98, "normal_1.mat"),
    (99, "normal_2.mat"),
    (100, "normal_3.mat"),
    # Inner race, 0.007".
    (105, "IR007_0.mat"),
    (106, "IR007_1.mat"),
    (107, "IR007_2.mat"),
    (108, "IR007_3.mat"),
    # Inner race, 0.014".
    (169, "IR014_0.mat"),
    (170, "IR014_1.mat"),
    (171, "IR014_2.mat"),
    (172, "IR014_3.mat"),
    # Inner race, 0.021".
    (209, "IR021_0.mat"),
    (210, "IR021_1.mat"),
    (211, "IR021_2.mat"),
    (212, "IR021_3.mat"),
    # Outer race, 0.007", defect centred at 6 o'clock (in the load zone).
    (130, "OR007@6_0.mat"),
    (131, "OR007@6_1.mat"),
    (132, "OR007@6_2.mat"),
    (133, "OR007@6_3.mat"),
    # Outer race, 0.014", 6 o'clock.
    (197, "OR014@6_0.mat"),
    (198, "OR014@6_1.mat"),
    (199, "OR014@6_2.mat"),
    (200, "OR014@6_3.mat"),
    # Outer race, 0.021", 6 o'clock.
    (234, "OR021@6_0.mat"),
    (235, "OR021@6_1.mat"),
    (236, "OR021@6_2.mat"),
    (237, "OR021@6_3.mat"),
)


def plan(dest: Path) -> list[tuple[int, str]]:
    """The files that are not already on disk."""
    return [(number, name) for number, name in SUBSET if not (dest / name).exists()]


def announce(dest: Path, todo: list[tuple[int, str]]) -> None:
    """Print exactly what will happen before anything happens."""
    print(f"Destination: {dest}")
    print(f"Source:      {BASE_URL}/<number>.mat")
    print(f"Subset:      {len(SUBSET)} files, 12 kHz drive end, ~100 MB total")
    print()
    for number, name in SUBSET:
        state = "have" if (dest / name).exists() else "FETCH"
        print(f"  [{state:5}] {name:16} <- {BASE_URL}/{number}.mat")
    print()
    if todo:
        print(f"Will download {len(todo)} file(s); {len(SUBSET) - len(todo)} already present.")
    else:
        print("Nothing to do: every file is already present.")


def download(number: int, name: str, dest: Path) -> bool:
    """Fetch one file. Returns False on any failure, without raising."""
    url = f"{BASE_URL}/{number}.mat"
    target = dest / name
    # Download to a sibling .part file and rename only on success, so an
    # interrupted run never leaves a truncated .mat that the loader would
    # happily read as a short recording.
    partial = target.with_suffix(".part")
    try:
        with urllib.request.urlopen(url, timeout=120) as response:
            partial.write_bytes(response.read())
    # urllib's URLError and a socket timeout are both OSError; one clause covers
    # every way a download can fail so one bad file never aborts the run.
    except OSError as exc:
        print(f"  FAILED {name}: {exc}")
        partial.unlink(missing_ok=True)
        return False

    size = partial.stat().st_size
    if size < MIN_PLAUSIBLE_BYTES:
        print(f"  FAILED {name}: got {size} bytes, expected megabytes (moved or blocked?)")
        partial.unlink(missing_ok=True)
        return False

    partial.rename(target)
    print(f"  ok     {name}  ({size / 1e6:.1f} MB)")
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dest", type=Path, default=DEST, help="where to put the .mat files")
    parser.add_argument("--dry-run", action="store_true", help="print the plan and stop")
    parser.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    args = parser.parse_args(argv)

    dest: Path = args.dest
    dest.mkdir(parents=True, exist_ok=True)
    todo = plan(dest)
    announce(dest, todo)

    if args.dry_run or not todo:
        return 0
    if not args.yes and input("Proceed? [y/N] ").strip().lower() not in {"y", "yes"}:
        print("Nothing downloaded.")
        return 1

    print()
    failures = [name for number, name in todo if not download(number, name, dest)]
    print()
    print(f"Downloaded {len(todo) - len(failures)} of {len(todo)}.")
    if failures:
        print("Failed: " + ", ".join(failures))
        print("Check the URLs above against https://engineering.case.edu/bearingdatacenter")
        return 1

    print("Now run:  uv run hypengine benchmark")
    return 0


if __name__ == "__main__":
    sys.exit(main())
