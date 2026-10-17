"""A slow piece of work, streamed as one JSON line per step while it runs.

The work runs in a worker thread and reports each step through `say`. Steps go
through a thread-safe queue that the response reads in order, so nothing
depends on which event loop the request happens to be served from: an earlier
version scheduled each step onto the loop with `call_soon_threadsafe`, and
under a test client that opens a fresh loop per request the steps of a second
request could be lost.
"""

from __future__ import annotations

import asyncio
import json
import queue
import threading
from collections.abc import AsyncIterator, Callable
from typing import Any, TypeVar

from fastapi.responses import StreamingResponse

T = TypeVar("T")

#: `say(step, state, detail)`: one step of the work, as it happens.
Say = Callable[[str, str, dict[str, Any]], None]

_DONE = object()


def stream_steps(
    work: Callable[[Say], T],
    last: Callable[[T], dict[str, Any]],
    failed: Callable[[Exception], dict[str, Any]],
) -> StreamingResponse:
    """Run `work(say)` in a thread and stream each step, then `last(result)`.

    Every line is a JSON object; a step is `{"step", "state", "detail"}`. If the
    work raises, the final line is `failed(exception)` instead: once a stream
    has started, an error can only be reported inside it.
    """
    lines: queue.SimpleQueue[Any] = queue.SimpleQueue()

    def say(step: str, state: str, detail: dict[str, Any]) -> None:
        lines.put({"step": step, "state": state, "detail": detail})

    def run() -> None:
        try:
            lines.put(last(work(say)))
        except Exception as exc:  # noqa: BLE001 - reported in the stream, below
            lines.put(failed(exc))
        finally:
            lines.put(_DONE)

    async def body() -> AsyncIterator[str]:
        threading.Thread(target=run, name="stream-steps", daemon=True).start()
        while (item := await asyncio.to_thread(lines.get)) is not _DONE:
            yield json.dumps(item, default=str) + "\n"

    return StreamingResponse(body(), media_type="application/x-ndjson")
