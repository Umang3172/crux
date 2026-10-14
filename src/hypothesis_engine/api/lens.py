"""Crux Lens over HTTP: upload a phone video, confirm the speed, read the result.

The upload is the raw video as the request body (no form encoding), so a phone
page can send the file the camera app produced as it is. `/scans/live` takes the
same upload and answers with one JSON line per step as the step runs, then the
scan, so a page can draw the pipeline while it works instead of a spinner.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..lens import scan as scans
from ..lens.motion import Box

router = APIRouter(prefix="/lens", tags=["lens"])

#: Largest upload accepted: a 10 s 4K phone clip is about 100 MB.
MAX_BYTES = 300 * 1024 * 1024


def _get(scan_id: str) -> scans.Scan:
    try:
        return scans.load(scan_id)
    except KeyError:
        raise HTTPException(404, f"no scan {scan_id}") from None


async def _upload(request: Request) -> bytes:
    data = await request.body()
    if not data:
        raise HTTPException(400, "send the video file as the request body")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "video too large: keep it to about 10 seconds")
    try:
        import av  # noqa: F401 - checked here so the reply says what is missing
    except ImportError:
        raise HTTPException(
            501, 'video support is not installed: uv pip install -e ".[lens]"'
        ) from None
    return data


@router.post("/scans")
async def new_scan(
    request: Request, machine: str = "", filename: str = "video.mp4", look: bool = True
) -> dict[str, Any]:
    """Read the video, let a model name the machine and box it, list speed candidates."""
    import av

    data = await _upload(request)
    try:
        scan = scans.new_scan(data, filename, machine, look=look)
    except (ValueError, av.FFmpegError) as e:
        raise HTTPException(422, f"could not read this video: {e}") from None
    return asdict(scan)


@router.post("/scans/live")
async def new_scan_live(
    request: Request, machine: str = "", filename: str = "video.mp4", look: bool = True
) -> StreamingResponse:
    """The same scan, answered as it runs: one JSON line per step, then the scan.

    Each line is `{"step", "state", "detail"}`; the last is `{"step": "scan",
    "state": "done", "scan": ...}`, or `{"step": "error", ...}` if the video could
    not be read. The scan runs in a worker thread; its steps reach the stream
    through the event loop, in the order they happened.
    """
    import av

    data = await _upload(request)
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    def say(step: str, state: str, detail: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(
            queue.put_nowait, {"step": step, "state": state, "detail": detail}
        )

    async def run() -> None:
        try:
            scan = await asyncio.to_thread(
                scans.new_scan, data, filename, machine, look=look, on_step=say
            )
            queue.put_nowait({"step": "scan", "state": "done", "scan": asdict(scan)})
        except (ValueError, av.FFmpegError) as e:
            queue.put_nowait(
                {
                    "step": "error",
                    "state": "failed",
                    "detail": {"message": f"could not read this video: {e}"},
                }
            )
        except Exception as e:  # the stream has started: report it in the stream
            queue.put_nowait(
                {
                    "step": "error",
                    "state": "failed",
                    "detail": {"message": f"the scan failed ({type(e).__name__})"},
                }
            )
        finally:
            queue.put_nowait(None)

    task = asyncio.create_task(run())

    async def lines() -> AsyncIterator[str]:
        while (item := await queue.get()) is not None:
            yield json.dumps(item, default=str) + "\n"
        await task

    return StreamingResponse(lines(), media_type="application/x-ndjson")


@router.get("/scans")
def all_scans() -> list[dict[str, Any]]:
    return [
        {
            "id": s.id,
            "machine": s.machine,
            "created": s.created,
            "normal": s.normal,
            "analysed": s.analysis is not None,
            "summary": (s.analysis or {}).get("summary", [])[:1],
        }
        for s in scans.all_scans()
    ]


@router.get("/scans/{scan_id}")
def one(scan_id: str) -> dict[str, Any]:
    return asdict(_get(scan_id))


@router.get("/scans/{scan_id}/still/{index}")
def still(scan_id: str, index: int) -> Response:
    _get(scan_id)
    try:
        return Response(scans.still(scan_id, index), media_type="image/jpeg")
    except FileNotFoundError:
        raise HTTPException(404, "no such still") from None


class BoxIn(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0.02, le=1)
    h: float = Field(gt=0.02, le=1)


class AnalyseRequest(BaseModel):
    rpm: float = Field(gt=0, le=60_000, description="Shaft speed a person has confirmed.")
    box: BoxIn | None = None
    bearing: str = Field(default="", description="Bearing part number, e.g. 6205, if known.")


@router.post("/scans/{scan_id}/analyse")
def analyse(scan_id: str, req: AnalyseRequest) -> dict[str, Any]:
    _get(scan_id)
    box = Box(req.box.x, req.box.y, req.box.w, req.box.h) if req.box else None
    return scans.analyse(scan_id, req.rpm, box=box, bearing=req.bearing)


@router.post("/scans/{scan_id}/normal")
def normal(scan_id: str) -> dict[str, Any]:
    """Mark this scan as how its machine looks when it runs normally."""
    _get(scan_id)
    try:
        return asdict(scans.mark_normal(scan_id))
    except ValueError as e:
        raise HTTPException(409, str(e)) from None
