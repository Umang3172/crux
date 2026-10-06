"""A phone video, read once into what the lens needs: motion frames, sound, stills.

Three things come out of one clip:

* small grey frames with their capture times, for measuring how the machine moves;
* the sound track, for hearing what the camera cannot see;
* a few upright colour stills, for the model that says what the machine is and
  whether anything is plainly wrong.

Phone video is often variable frame rate and Slo-mo files carry an edit list that
stretches time for slow playback. The edit list is ignored so frame times are
capture times, and the frame rate is read from those times, not from the
container's nominal rate. When the two disagree the clip says so, because every
frequency the lens reports scales with it.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

#: Longest clip read. Ten seconds resolves 0.1 Hz, far finer than any shaft
#: line needs, and keeps a 240 fps clip to 2,400 frames.
MAX_SECONDS = 12.0

#: Long side of the grey motion frames, in pixels. Phase correlation resolves a
#: small fraction of a pixel, so 400 px keeps sub-pixel motion while a 240 fps,
#: 10 s clip stays near 200 MB as uint8.
MOTION_LONG_SIDE = 400

#: Long side of the colour stills sent to a vision model.
STILL_LONG_SIDE = 1024

#: Frame-time and nominal rates further apart than this are reported.
RATE_DISAGREEMENT = 0.10


@dataclass
class Clip:
    frames: np.ndarray  # (n, h, w) uint8, upright, grey
    times: np.ndarray  # (n,) seconds from the first frame, capture time
    fps: float  # from the frame times
    nominal_fps: float  # what the container claims
    audio: np.ndarray | None = None  # mono float32
    audio_fs: float = 0.0
    stills: list[bytes] = field(default_factory=list)  # upright JPEGs
    size: tuple[int, int] = (0, 0)  # original (width, height), upright
    notes: list[str] = field(default_factory=list)

    @property
    def duration_s(self) -> float:
        return float(self.times[-1] - self.times[0]) if len(self.times) > 1 else 0.0


def _upright(img: np.ndarray, rotation: float) -> np.ndarray:
    """Turn a frame the way the phone meant it to be shown (counter-clockwise degrees)."""
    k = int(round(rotation / 90.0)) % 4
    return np.rot90(img, k) if k else img


def _jpeg(frame, rotation: float) -> bytes:  # noqa: ANN001 - av.VideoFrame
    img = frame.to_image()
    if rotation:
        img = img.rotate(rotation, expand=True)
    img.thumbnail((STILL_LONG_SIDE, STILL_LONG_SIDE))
    out = io.BytesIO()
    img.convert("RGB").save(out, format="JPEG", quality=88)
    return out.getvalue()


def frame_rate(times: np.ndarray) -> float:
    """Capture rate from frame times: the median gap is robust to a dropped frame."""
    gaps = np.diff(times)
    gaps = gaps[gaps > 0]
    return float(1.0 / np.median(gaps)) if len(gaps) else 0.0


def read(source: str | Path | bytes, max_seconds: float = MAX_SECONDS, stills: int = 3) -> Clip:
    """Decode a video file (any format the bundled FFmpeg reads, phone HEVC included)."""
    import av  # optional dependency: uv pip install -e ".[lens]"

    def open_():
        src = io.BytesIO(source) if isinstance(source, bytes) else str(source)
        return av.open(src, options={"ignore_editlist": "1"})

    with open_() as box:
        vs = box.streams.video[0]
        vs.thread_type = "AUTO"
        nominal = float(vs.guessed_rate or vs.average_rate or 0.0)
        length = float(box.duration) / av.time_base if box.duration else max_seconds
        span = min(length, max_seconds)
        # Stills are taken as the clip passes these times, so no full frame is kept.
        targets = [span * f for f in (0.15, 0.5, 0.85)][: max(1, stills)]
        grey: list[np.ndarray] = []
        times: list[float] = []
        jpegs: list[bytes] = []
        rotation = 0.0
        t0 = None
        last = None
        for frame in box.decode(vs):
            t = frame.time
            if t is None:
                continue
            if t0 is None:
                t0 = t
                rotation = float(getattr(frame, "rotation", 0) or 0)
            if t - t0 > max_seconds:
                break
            w, h = frame.width, frame.height
            scale = MOTION_LONG_SIDE / max(w, h)
            small = frame.reformat(
                width=max(2, int(round(w * scale)) // 2 * 2),
                height=max(2, int(round(h * scale)) // 2 * 2),
                format="gray",
            )
            grey.append(_upright(small.to_ndarray(), rotation))
            times.append(t - t0)
            if len(jpegs) < len(targets) and t - t0 >= targets[len(jpegs)]:
                jpegs.append(_jpeg(frame, rotation))
            last = frame
        if not grey or last is None:
            raise ValueError("no video frames could be read from this file")
        if not jpegs:
            jpegs.append(_jpeg(last, rotation))
        size = (last.width, last.height)

    t = np.asarray(times)
    fps = frame_rate(t)
    notes = []
    if nominal and abs(fps / nominal - 1.0) > RATE_DISAGREEMENT:
        notes.append(
            f"frame times say {fps:.1f} fps but the file says {nominal:.1f} fps; "
            "frequencies use the frame times"
        )
    if int(round(rotation / 90.0)) % 2:
        size = (size[1], size[0])

    audio, audio_fs = _audio(open_, max_seconds)
    return Clip(np.stack(grey), t, fps, nominal, audio, audio_fs, jpegs, size, notes)


def _audio(open_, max_seconds: float) -> tuple[np.ndarray | None, float]:  # noqa: ANN001
    import av

    with open_() as box:
        if not box.streams.audio:
            return None, 0.0
        st = box.streams.audio[0]
        fs = float(st.rate or 0)
        if fs <= 0:
            return None, 0.0
        resampler = av.AudioResampler(format="flt", layout="mono", rate=int(fs))
        chunks = []
        for frame in box.decode(st):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
            if sum(len(c) for c in chunks) > fs * max_seconds:
                break
        if not chunks:
            return None, 0.0
        x = np.concatenate(chunks)[: int(fs * max_seconds)].astype(np.float32)
        return x, fs
