"""Deterministic checks and crops on a still, before and between a model's looks.

Nothing here calls a model, so a photo nobody could use is turned back with a
measured reason instead of being shown to one, and every crop for a second look
is exactly reproducible.

Boxes use one convention for every model: `[ymin, xmin, ymax, xmax]`, each an
integer from 0 to 1000 of the image's height or width, which is how Gemini
returns boxes (ai.google.dev/gemini-api/docs/image-understanding, read 10 Oct 2026).

Pillow decodes the images (the `lens` extra). Without it the gate says it could
not measure the photo and lets the look go ahead, and crops fall back to the
whole still.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
from scipy.ndimage import laplace

Box1000 = tuple[int, int, int, int]

#: The gate measures every still at this long side, downscaling larger ones and
#: never upscaling smaller ones, so a CCTV frame and a Lens still (made at 1024 px,
#: `lens.clip.STILL_LONG_SIDE`) are measured on one scale.
MEASURE_LONG_SIDE_PX = 1024

#: Shortest side a still may have: 224 px is the smallest input the common
#: vision encoders were trained at (CLIP ViT-B/32, Radford et al. 2021); below
#: it every model enlarges the photo and no detail is added.
MIN_SHORT_SIDE_PX = 224

#: Sharpness is the variance of the Laplacian of the grey image (Pech-Pacheco
#: et al., "Diatom autofocusing in brightfield microscopy", ICPR 2000). The bar
#: of 100 is a published rule of thumb (A. Rosebrock, "Blur detection with
#: OpenCV", PyImageSearch, 2015), not a calibrated value: PROVISIONAL until
#: `scripts/photo_eval.py --calibrate` sets it from a calibration split. Below
#: it a still is marked soft and looked at anyway (ADR-0032): an uncalibrated
#: bar turned back both real photos of a plainly visible fault it met.
MIN_SHARPNESS = 100.0

#: Too dark: even the brightest 1% of pixels sit in the bottom eighth of the
#: range; blown out: even the darkest 1% sit in the top eighth. Rec. 601 luma,
#: 8 bit. PROVISIONAL, as MIN_SHARPNESS: they turn back only a near-black or
#: near-white frame until a calibration split sets them.
DARK_P99 = 32.0
BRIGHT_P1 = 223.0

#: A second look sees the box plus half its size on every side, so a drip's
#: source or the floor under a leak stays in view, and never less than a quarter
#: of the photo's shorter side. A design choice, not a fitted number.
CROP_MARGIN = 0.5
CROP_MIN_FRACTION = 0.25


@dataclass(frozen=True)
class Quality:
    usable: bool
    reason: str  # why to retake; "" when usable
    width: int = 0
    height: int = 0
    sharpness: float = 0.0
    p1: float = 0.0
    p99: float = 0.0
    measured: bool = True  # False when the still could not be measured at all
    soft: bool = False  # under the sharpness bar: looked at, but a miss is likelier

    def as_dict(self) -> dict[str, float | int | bool]:
        return {
            "width": self.width,
            "height": self.height,
            "sharpness": round(self.sharpness, 1),
            "p1": self.p1,
            "p99": self.p99,
            "measured": self.measured,
            "soft": self.soft,
        }


def _open(image: bytes):  # noqa: ANN202 - PIL.Image.Image, imported lazily
    from PIL import Image, ImageOps

    img = Image.open(io.BytesIO(image))
    img.load()
    return ImageOps.exif_transpose(img)  # phones store rotation in EXIF


def grey(image: bytes, long_side: int = MEASURE_LONG_SIDE_PX) -> np.ndarray:
    """Rec. 601 luma (Pillow's "L" mode) as floats, downscaled to `long_side` at most."""
    img = _open(image).convert("L")
    if max(img.size) > long_side:
        img.thumbnail((long_side, long_side))
    return np.asarray(img, dtype=float)


def quality(image: bytes) -> Quality:
    """Whether a model should look at this still at all, and if not, why."""
    try:
        img = _open(image)
    except ImportError:
        return Quality(True, "", measured=False)
    except Exception:  # not an image Pillow can read
        return Quality(False, "the file could not be read as an image", measured=False)
    width, height = img.size
    g = grey(image)
    sharpness = float(laplace(g).var())
    p1, p99 = (float(v) for v in np.percentile(g, [1, 99]))
    q = dict(width=width, height=height, sharpness=sharpness, p1=p1, p99=p99)
    if min(width, height) < MIN_SHORT_SIDE_PX:
        why = (
            f"too small ({width} x {height} px; at least {MIN_SHORT_SIDE_PX} px on the short side)"
        )
        return Quality(False, why, **q)
    if p99 < DARK_P99:
        return Quality(False, f"too dark (brightest 1% of pixels at {p99:.0f} of 255)", **q)
    if p1 > BRIGHT_P1:
        return Quality(False, f"blown out (darkest 1% of pixels at {p1:.0f} of 255)", **q)
    return Quality(True, "", soft=sharpness < MIN_SHARPNESS, **q)


def parse_box(value: object) -> Box1000 | None:
    """A model's box as [ymin, xmin, ymax, xmax] in 0..1000, or None if it is not one."""
    if not isinstance(value, list | tuple) or len(value) != 4:
        return None
    try:
        y0, x0, y1, x1 = (int(round(min(1000.0, max(0.0, float(v))))) for v in value)
    except (TypeError, ValueError):
        return None
    y0, y1 = sorted((y0, y1))
    x0, x1 = sorted((x0, x1))
    if y1 - y0 < 5 or x1 - x0 < 5:  # under half a percent of a side: a point, not a box
        return None
    return (y0, x0, y1, x1)


def to_pixels(box: Box1000, width: int, height: int) -> tuple[int, int, int, int]:
    """(left, top, right, bottom) in pixels, as Pillow crops."""
    y0, x0, y1, x1 = box
    return (
        round(x0 * width / 1000),
        round(y0 * height / 1000),
        round(x1 * width / 1000),
        round(y1 * height / 1000),
    )


def from_pixels(left: int, top: int, right: int, bottom: int, width: int, height: int) -> Box1000:
    return (
        round(top * 1000 / height),
        round(left * 1000 / width),
        round(bottom * 1000 / height),
        round(right * 1000 / width),
    )


def to_fractions(box: Box1000) -> tuple[float, float, float, float]:
    """(x, y, w, h) as fractions of the frame, the screen's convention."""
    y0, x0, y1, x1 = box
    return (x0 / 1000, y0 / 1000, (x1 - x0) / 1000, (y1 - y0) / 1000)


def crop_box(box: Box1000) -> Box1000:
    """The region a second look sees: the box, its margin, at least the minimum size."""
    y0, x0, y1, x1 = box
    half_min = CROP_MIN_FRACTION * 1000 / 2

    def grow(a: int, b: int) -> tuple[int, int]:
        mid, half = (a + b) / 2, max((b - a) * (0.5 + CROP_MARGIN), half_min)
        lo, hi = mid - half, mid + half
        shift = max(0.0, -lo) - max(0.0, hi - 1000)  # slide back inside the frame
        return int(round(max(0.0, lo + shift))), int(round(min(1000.0, hi + shift)))

    (ny0, ny1), (nx0, nx1) = grow(y0, y1), grow(x0, x1)
    return (ny0, nx0, ny1, nx1)


def crop(image: bytes, box: Box1000) -> bytes:
    """A JPEG of `crop_box(box)` from the still; the still itself if it cannot be cut."""
    try:
        img = _open(image).convert("RGB")
    except Exception:  # no Pillow, or not an image: the whole still is the best view
        return image
    left, top, right, bottom = to_pixels(crop_box(box), *img.size)
    out = io.BytesIO()
    img.crop((left, top, right, bottom)).save(out, format="JPEG", quality=90)
    return out.getvalue()
