"""Where data lives: datasets a person downloaded, tables derived from them, and
what the app saves while it runs (scans, lessons, tickets' stills).

One folder, found the same way by every module, so a deployed container and a
laptop checkout agree. In order:

1. `CRUX_DATA`, when it is set. The container sets it to `/app/data`.
2. `data/` at the top of a source checkout, when the package is run from one.
3. `data/` under the working directory. A package installed as a wheel has no
   checkout above it, and without this its "data" would land inside the Python
   library folder, where nothing can find it and the app may not write.
"""

from __future__ import annotations

import os
from pathlib import Path


def data_root() -> Path:
    chosen = os.getenv("CRUX_DATA")
    if chosen:
        return Path(chosen)
    checkout = Path(__file__).resolve().parents[3]
    if (checkout / "pyproject.toml").is_file():
        return checkout / "data"
    return Path.cwd() / "data"


DATA_ROOT = data_root()
