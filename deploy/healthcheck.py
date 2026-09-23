"""Container health probe: is the API answering on this instance's port?

A separate file because expressing this inline in a Dockerfile HEALTHCHECK means
three levels of quoting, and because the image carries no curl. Cloud Run uses
its own startup and liveness probes and ignores Docker's, so this is for local
runs, Compose and anything else that reads the image's own contract.
"""

from __future__ import annotations

import os
import sys
import urllib.request


def main() -> int:
    port = os.getenv("PORT", "8080")
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=4) as response:
            return 0 if response.status == 200 else 1
    except Exception:
        return 1


if __name__ == "__main__":
    sys.exit(main())
