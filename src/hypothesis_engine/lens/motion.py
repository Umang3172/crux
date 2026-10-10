"""How a machine moves in a video: every pixel is a small displacement sensor.

The machine's housing is boxed (by a vision model or by hand), and its shift
against the first frame is measured in every frame: a whole-pixel estimate from
phase correlation, refined below a pixel by one Lucas–Kanade step on the
residual. Camera shake is removed by measuring a still patch of the scene (a
wall, the floor) the same way and subtracting it. What is left is the housing's
own motion, a waveform sampled at the frame rate, which the physics reads like
any other vibration signal (see experiments.py).

Units are pixels of the motion frames, not millimetres: a phone does not know
how far away the machine is. Comparisons that need a level are made against an
earlier scan of the same machine, scaled by the size of its box.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.signal import butter, sosfiltfilt

#: Drift and hand shake are slow: hand tremor is 1 to 10 Hz (US patent 7796159)
#: and a shaft line sits at 10 Hz (600 rpm) or above. A 2 Hz high-pass removes
#: drift; the still patch removes the shake.
HIGHPASS_HZ = 2.0

#: Light blur before the sub-pixel step: the linearised (Lucas–Kanade) shift is
#: valid only for smooth images (Lucas & Kanade, IJCAI 1981).
BLUR_PX = 1.0

#: Size of a candidate still patch, as a fraction of each frame side.
PATCH = 0.18

#: A still patch needs texture to be tracked: mean gradient in grey levels per pixel.
MIN_TEXTURE = 2.0

#: Grid for the shake map: 6 x 8 cells of a 400 px frame are about 50 px each,
#: big enough to track, small enough to tell a motor from the wall behind it.
MAP_GRID = (6, 8)

#: A cell is the machine when it shakes this many times more than the median
#: cell; below that nothing in the picture stands out, and the map says so.
#: The bar mirrors order tracking's peak prominence (signals.features).
MAP_PROMINENCE = 4.0


@dataclass(frozen=True)
class Box:
    """A region in fractions of the frame (0..1), so it survives any resizing."""

    x: float
    y: float
    w: float
    h: float

    def pixels(self, shape: tuple[int, int]) -> tuple[int, int, int, int]:
        hh, ww = shape
        x0 = int(np.clip(round(self.x * ww), 0, ww - 8))
        y0 = int(np.clip(round(self.y * hh), 0, hh - 8))
        x1 = int(np.clip(round((self.x + self.w) * ww), x0 + 8, ww))
        y1 = int(np.clip(round((self.y + self.h) * hh), y0 + 8, hh))
        return y0, y1, x0, x1

    def diagonal(self, shape: tuple[int, int]) -> float:
        y0, y1, x0, x1 = self.pixels(shape)
        return float(np.hypot(y1 - y0, x1 - x0))

    def overlaps(self, other: Box, margin: float = 0.05) -> bool:
        return not (
            self.x + self.w + margin <= other.x
            or other.x + other.w + margin <= self.x
            or self.y + self.h + margin <= other.y
            or other.y + other.h + margin <= self.y
        )


def _integer_shift(ref: np.ndarray, cur: np.ndarray, win: np.ndarray) -> tuple[int, int]:
    """Whole-pixel shift of `cur` against `ref` by phase correlation."""
    a = np.fft.fft2(ref * win)
    b = np.fft.fft2(cur * win)
    cross = b * np.conj(a)
    r = np.fft.ifft2(cross / (np.abs(cross) + 1e-9)).real
    iy, ix = np.unravel_index(int(np.argmax(r)), r.shape)
    h, w = r.shape
    return (iy - h if iy > h // 2 else iy), (ix - w if ix > w // 2 else ix)


def _fine_shift(ref: np.ndarray, cur: np.ndarray) -> tuple[float, float]:
    """Sub-pixel shift of `cur` against `ref`, one Lucas–Kanade step (small motion)."""
    gy, gx = np.gradient(ref)
    gt = cur - ref
    a = np.array([[np.sum(gx * gx), np.sum(gx * gy)], [np.sum(gx * gy), np.sum(gy * gy)]])
    b = -np.array([np.sum(gx * gt), np.sum(gy * gt)])
    try:
        dx, dy = np.linalg.solve(a, b)
    except np.linalg.LinAlgError:
        return 0.0, 0.0
    return float(dy), float(dx)


def track(frames: np.ndarray, box: Box) -> np.ndarray:
    """(n, 2) shift of the boxed region in each frame against the first, as (dy, dx) pixels."""
    shape = frames.shape[1:]
    y0, y1, x0, x1 = box.pixels(shape)
    h, w = y1 - y0, x1 - x0
    win = np.outer(np.hanning(h), np.hanning(w))
    first = frames[0].astype(np.float32)
    ref = gaussian_filter(first[y0:y1, x0:x1], BLUR_PX)
    out = np.zeros((len(frames), 2))
    for i, frame in enumerate(frames):
        f = gaussian_filter(frame.astype(np.float32), BLUR_PX)
        iy, ix = _integer_shift(ref, f[y0:y1, x0:x1], win)
        # Re-crop where the region now is, then refine what is left below a pixel.
        cy0 = int(np.clip(y0 + iy, 0, shape[0] - h))
        cx0 = int(np.clip(x0 + ix, 0, shape[1] - w))
        dy, dx = _fine_shift(ref, f[cy0 : cy0 + h, cx0 : cx0 + w])
        out[i] = (cy0 - y0 + dy, cx0 - x0 + dx)
    return out


def texture(frame: np.ndarray, box: Box) -> float:
    y0, y1, x0, x1 = box.pixels(frame.shape)
    gy, gx = np.gradient(frame[y0:y1, x0:x1].astype(np.float32))
    return float(np.mean(np.hypot(gx, gy)))


def still_patch(frame: np.ndarray, machine: Box) -> Box | None:
    """The most textured corner or edge patch clear of the machine, if any has texture."""
    p = PATCH
    spots = [(0.02, 0.02), (0.98 - p, 0.02), (0.02, 0.98 - p), (0.98 - p, 0.98 - p)]
    spots += [
        (0.5 - p / 2, 0.02),
        (0.5 - p / 2, 0.98 - p),
        (0.02, 0.5 - p / 2),
        (0.98 - p, 0.5 - p / 2),
    ]
    boxes = [Box(x, y, p, p) for x, y in spots]
    clear = [b for b in boxes if not b.overlaps(machine)]
    if not clear:
        return None
    best = max(clear, key=lambda b: texture(frame, b))
    return best if texture(frame, best) >= MIN_TEXTURE else None


def uniform(times: np.ndarray, values: np.ndarray, fps: float) -> np.ndarray:
    """Values at evenly spaced times: phone video is often variable frame rate."""
    grid = np.arange(0.0, times[-1], 1.0 / fps)
    return np.column_stack([np.interp(grid, times, values[:, k]) for k in range(values.shape[1])])


def highpass(x: np.ndarray, fs: float, cutoff: float = HIGHPASS_HZ) -> np.ndarray:
    if len(x) < 32 or cutoff >= fs / 2:
        return x - x.mean(axis=0)
    sos = butter(2, cutoff / (fs / 2), btype="highpass", output="sos")
    return sosfiltfilt(sos, x, axis=0)


@dataclass
class Motion:
    signal: np.ndarray  # 1-D displacement along the main direction of shaking, pixels
    fs: float
    direction_deg: float  # 0 = left-right in the upright frame, 90 = up-down
    rms_px: float
    scale_px: float  # diagonal of the machine's box, for comparing scans
    shake_removed: bool
    note: str = ""


def measure(frames: np.ndarray, times: np.ndarray, fps: float, machine: Box) -> Motion:
    """The machine's own motion in the video, along the direction it shakes most."""
    moved = track(frames, machine)
    patch = still_patch(frames[0], machine)
    note = ""
    if patch is not None:
        moved = moved - track(frames, patch)
    else:
        note = "no still, textured patch beside the machine: camera shake is not removed"
    xy = highpass(uniform(times, moved, fps), fps)
    # The direction that carries most of the motion (first principal axis).
    cov = np.cov(xy.T) if len(xy) > 2 else np.eye(2)
    vals, vecs = np.linalg.eigh(cov)
    axis = vecs[:, int(np.argmax(vals))]
    signal = xy @ axis
    angle = float(np.degrees(np.arctan2(abs(axis[0]), abs(axis[1]))))
    return Motion(
        signal,
        fps,
        angle,
        float(np.sqrt(np.mean(signal**2))) if len(signal) else 0.0,
        machine.diagonal(frames.shape[1:]),
        patch is not None,
        note,
    )


def _stabilise(frames: np.ndarray, margin: int) -> np.ndarray:
    """Remove whole-pixel camera shake: shift each frame back by its global offset."""
    ref = frames[0].astype(np.float32)
    h, w = ref.shape
    win = np.outer(np.hanning(h), np.hanning(w))
    out = np.empty((len(frames), h - 2 * margin, w - 2 * margin), np.float32)
    for i, f in enumerate(frames):
        iy, ix = _integer_shift(ref, f.astype(np.float32), win)
        iy, ix = int(np.clip(iy, -margin, margin)), int(np.clip(ix, -margin, margin))
        out[i] = f[margin + iy : h - margin + iy, margin + ix : w - margin + ix]
    return out


@dataclass
class ShakeMap:
    ratio: np.ndarray  # (rows, cols) each cell's shaking over the median cell's
    box: Box | None  # the cells that shake clearly more than the rest, if any
    area: Box | None = None  # the part of the frame the grid covers
    note: str = ""


def shake_map(
    frames: np.ndarray, times: np.ndarray, fps: float, grid: tuple[int, int] = MAP_GRID
) -> ShakeMap:
    """Where in the picture the shaking is: every cell tracked, shake common to all removed.

    Each cell's sub-pixel shift is one Lucas–Kanade step against the first frame,
    after whole-pixel camera shake is taken out. Motion every cell shares (the
    phone moving) is removed by subtracting the median cell; what is left is
    each cell's own shaking above the drift filter.
    """
    rows, cols = grid
    margin = 8
    stable = _stabilise(frames, margin)
    n, h, w = stable.shape
    ch, cw = h // rows, w // cols
    stable = stable[:, : rows * ch, : cols * cw]
    fy, fx = frames.shape[1], frames.shape[2]
    area = Box(margin / fx, margin / fy, cols * cw / fx, rows * ch / fy)
    ref = gaussian_filter(stable[0], BLUR_PX)
    gy, gx = np.gradient(ref)
    cells = (rows, ch, cols, cw)
    gx, gy, ref = gx.reshape(cells), gy.reshape(cells), ref.reshape(cells)
    a11 = np.einsum("ricj,ricj->rc", gx, gx)
    a12 = np.einsum("ricj,ricj->rc", gx, gy)
    a22 = np.einsum("ricj,ricj->rc", gy, gy)
    det = a11 * a22 - a12**2
    # A plain wall or floor cell has too little texture to track: its "motion" is
    # noise, so it is left out (the same bar the still patch must clear).
    textured = np.einsum("ricj->rc", np.hypot(gx, gy)) / (ch * cw) >= MIN_TEXTURE
    ok = textured & (det > 1e-6 * (a11 * a22 + 1e-12))
    det = np.where(ok, det, 1.0)
    moved = np.zeros((n, rows, cols, 2))
    for i in range(n):
        it = gaussian_filter(stable[i], BLUR_PX).reshape(cells) - ref
        b1 = -np.einsum("ricj,ricj->rc", gx, it)
        b2 = -np.einsum("ricj,ricj->rc", gy, it)
        moved[i, :, :, 1] = (a22 * b1 - a12 * b2) / det  # dx
        moved[i, :, :, 0] = (a11 * b2 - a12 * b1) / det  # dy
    moved[:, ~ok] = 0.0
    use = ok.reshape(-1)
    if use.sum() < 4:
        return ShakeMap(
            np.zeros((rows, cols)), None, area, "too little texture in the picture to map"
        )
    flat = moved.reshape(n, rows * cols, 2)
    flat = flat - np.median(flat[:, use], axis=1, keepdims=True)
    energy = np.zeros(rows * cols)
    for k in np.flatnonzero(use):
        xy = highpass(uniform(times, flat[:, k], fps), fps)
        energy[k] = float(np.sqrt(np.mean(np.sum(xy**2, axis=1))))
    ratio = (energy / (np.median(energy[use]) + 1e-12)).reshape(rows, cols)
    best = float(ratio.max())
    if best < MAP_PROMINENCE:
        return ShakeMap(
            ratio, None, area, "no part of the picture shakes clearly more than the rest"
        )
    # The best cell and every touching cell that shakes at least half as much.
    keep = ratio >= max(MAP_PROMINENCE, best / 2)
    r0, c0 = np.unravel_index(int(np.argmax(ratio)), ratio.shape)
    region = {(r0, c0)}
    frontier = [(r0, c0)]
    while frontier:
        r, c = frontier.pop()
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (r + dr, c + dc)
            if 0 <= q[0] < rows and 0 <= q[1] < cols and keep[q] and q not in region:
                region.add(q)
                frontier.append(q)
    rs = [r for r, _ in region]
    cs = [c for _, c in region]
    y0 = (margin + min(rs) * ch) / fy
    x0 = (margin + min(cs) * cw) / fx
    y1 = (margin + (max(rs) + 1) * ch) / fy
    x1 = (margin + (max(cs) + 1) * cw) / fx
    return ShakeMap(ratio, Box(float(x0), float(y0), float(x1 - x0), float(y1 - y0)), area)
