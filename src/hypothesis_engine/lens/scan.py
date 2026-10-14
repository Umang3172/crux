"""A lens scan: one phone video of one machine, kept on disk with what was found.

Two steps, with a person in between:

1. **New scan.** The video is read; a vision model names the machine, reads the
   nameplate and boxes the housing; a second look checks for plainly visible
   trouble; the strongest motion lines are listed as speed candidates.
2. **Analyse**, once a person has confirmed the shaft speed (and moved the box
   if needed): the physics compares the motion, and the sound when the bearing
   is known, with every fault it can test, compares the motion with the
   machine's normal scan if one is marked, and names the one check that would
   settle what is left.

Scans live in `data/lens/<id>/`: the video, its stills and `scan.json`.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from ..forecast.runs import DATA_ROOT
from ..models import FaultKind
from ..signals.features import magnitude_spectrum
from ..ticket.camera import Step
from . import clip as clips
from . import experiments as ex
from . import look as looks
from .motion import HIGHPASS_HZ, Box, measure, shake_map

LENS_DIR = DATA_ROOT / "lens"

#: Where to measure when nobody has boxed the machine: the middle of the frame,
#: where a person points the phone.
DEFAULT_BOX = Box(0.3, 0.3, 0.4, 0.4)

#: Speed candidates offered from the motion before anyone knows the speed.
CANDIDATES = 3

#: A candidate line must stand this many times above the spectrum's median, the
#: same bar order tracking sets for a shaft peak (signals.features).
CANDIDATE_PROMINENCE = 4.0

LABEL = {
    FaultKind.HEALTHY: "running normally",
    FaultKind.IMBALANCE: "out of balance",
    FaultKind.MISALIGNMENT: "shafts out of line",
    FaultKind.LOOSENESS: "loose mounting",
    FaultKind.OUTER_RACE: "bearing outer ring damage",
    FaultKind.INNER_RACE: "bearing inner ring damage",
}
BEARING_KINDS = (FaultKind.OUTER_RACE, FaultKind.INNER_RACE)


@dataclass
class Scan:
    id: str
    machine: str
    created: str
    file: str
    fps: float
    nominal_fps: float
    duration_s: float
    size: tuple[int, int]
    stills: int
    audio_fs: float
    notes: list[str] = field(default_factory=list)
    identity: dict[str, Any] = field(default_factory=dict)
    look: dict[str, Any] = field(default_factory=dict)
    box: dict[str, float] = field(default_factory=dict)
    box_source: str = ""
    shake: list[list[float]] = field(default_factory=list)  # each cell's shaking over the median
    shake_area: dict[str, float] | None = None  # where that grid sits in the frame
    candidates: list[dict[str, float]] = field(default_factory=list)
    normal: bool = False
    analysis: dict[str, Any] | None = None


def _folder(scan_id: str, root: Path | None = None) -> Path:
    return (root or LENS_DIR) / scan_id


def save(scan: Scan, root: Path | None = None) -> None:
    p = _folder(scan.id, root) / "scan.json"
    p.write_text(json.dumps(asdict(scan), indent=1, default=str))


def load(scan_id: str, root: Path | None = None) -> Scan:
    p = _folder(scan_id, root) / "scan.json"
    if not p.exists():
        raise KeyError(scan_id)
    d = json.loads(p.read_text())
    d["size"] = tuple(d["size"])
    return Scan(**d)


def all_scans(root: Path | None = None) -> list[Scan]:
    base = root or LENS_DIR
    if not base.exists():
        return []
    out = [load(p.name, root) for p in base.iterdir() if (p / "scan.json").exists()]
    return sorted(out, key=lambda s: s.created, reverse=True)


def still(scan_id: str, index: int, root: Path | None = None) -> bytes:
    return (_folder(scan_id, root) / f"still_{index}.jpg").read_bytes()


@lru_cache(maxsize=2)
def _clip(path: str) -> clips.Clip:
    return clips.read(path)


def candidates(signal: np.ndarray, fps: float) -> list[dict[str, float]]:
    """The strongest motion lines, as speed suggestions a person can accept."""
    f, mag = magnitude_spectrum(signal, fps)
    keep = f > HIGHPASS_HZ * 1.5
    f, mag = f[keep], mag[keep]
    if len(mag) < 3:
        return []
    floor = float(np.median(mag)) + 1e-12
    order = np.argsort(mag)[::-1]
    out: list[dict[str, float]] = []
    for i in order:
        if mag[i] < CANDIDATE_PROMINENCE * floor or len(out) >= CANDIDATES:
            break
        if any(abs(f[i] - c["hz"]) < 1.0 for c in out):
            continue
        out.append({"hz": float(f[i]), "px": float(mag[i]), "rpm_if_1x": float(f[i] * 60.0)})
    return out


def _quiet(step: str, state: str, detail: dict[str, Any]) -> None:
    return None


def new_scan(
    data: bytes,
    filename: str,
    machine: str,
    root: Path | None = None,
    look: bool = True,
    on_step: Step | None = None,
) -> Scan:
    """Read a video and keep it as a scan. `on_step` hears each step as it runs."""
    say = on_step or _quiet
    scan_id = f"S-{uuid.uuid4().hex[:8]}"
    folder = _folder(scan_id, root)
    folder.mkdir(parents=True, exist_ok=True)
    suffix = Path(filename).suffix.lower() or ".mp4"
    path = folder / f"video{suffix}"
    path.write_bytes(data)
    say("read", "start", {"bytes": len(data)})
    c = _clip(str(path))
    for i, jpg in enumerate(c.stills):
        (folder / f"still_{i}.jpg").write_bytes(jpg)
    middle = c.stills[len(c.stills) // 2]
    has_sound = c.audio is not None and len(c.audio) > 0
    say(
        "read",
        "done",
        {
            "id": scan_id,
            "fps": round(c.fps, 3),
            "duration_s": round(c.duration_s, 2),
            "frames": len(c.frames),
            "size": list(c.size),
            "stills": len(c.stills),
            "still": len(c.stills) // 2,
            "sound": has_sound,
            "audio_fs": c.audio_fs,
            "notes": list(c.notes),
        },
    )

    # The machine's normal scan, when a person has marked one: its box measures the
    # same spot again, and its still is the look's reference photo.
    normal = _normal_for_machine(machine, root)
    reference, reference_label = None, ""
    if normal is not None and normal.stills:
        try:
            reference = still(normal.id, normal.stills // 2, root)
            reference_label = f"normal scan {normal.id} of {normal.created[:10]}"
        except FileNotFoundError:
            reference = None
    if look:
        say("identify", "start", {})
        identity = looks.identify(middle)
        say(
            "identify",
            "done",
            {
                "machine_type": identity.machine_type,
                "nameplate_text": identity.nameplate_text,
                "box": asdict(identity.box) if identity.box else None,
                "box_label": identity.box_label,
                "by": identity.by,
                "note": identity.note,
            },
        )
    else:
        identity = looks.Identity(note="look skipped")
        for step in ("identify", "look"):
            say(step, "off", {"note": "look skipped"})
    seen = (
        looks.visible(
            middle,
            f"a technician's phone video of a {identity.machine_type or 'machine'}",
            reference,
            reference_label,
            on_step=on_step,
        )
        if look
        else None
    )
    notes = list(c.notes)
    say("motion", "start", {"frames": len(c.frames)})
    shaking = shake_map(c.frames, c.times, c.fps)
    if normal is not None:
        box, source = Box(**normal.box), "the normal scan of this machine"
    elif shaking.box is not None:
        box, source = shaking.box, "where the video shakes most"
    elif identity.box is not None:
        box, source = identity.box, f"the model ({identity.box_label or 'machine'})"
        notes.append(shaking.note)
    else:
        box, source = DEFAULT_BOX, "the middle of the frame"
        notes.append(shaking.note)
    if c.duration_s < 3.0:
        notes.append(f"the clip is {c.duration_s:.1f} s; 10 s resolves the shaft lines better")
    m = measure(c.frames, c.times, c.fps, box)
    if m.note:
        notes.append(m.note)
    lines = candidates(m.signal, c.fps)
    say(
        "motion",
        "done",
        {
            "box": asdict(box),
            "box_source": source,
            "rms_px": round(float(m.rms_px), 3),
            "shake_removed": m.shake_removed,
            "candidates": lines,
            "note": m.note or shaking.note,
        },
    )
    # The sound is tested against each fault at a known shaft speed, so it waits
    # for a person to confirm one (`analyse`).
    say("sound", "waiting", {"sound": has_sound, "audio_fs": c.audio_fs})

    scan = Scan(
        id=scan_id,
        machine=machine.strip() or identity.machine_type or "unnamed machine",
        created=datetime.now(UTC).isoformat(timespec="seconds"),
        file=path.name,
        fps=round(c.fps, 3),
        nominal_fps=round(c.nominal_fps, 3),
        duration_s=round(c.duration_s, 2),
        size=c.size,
        stills=len(c.stills),
        audio_fs=c.audio_fs,
        notes=notes,
        identity={**asdict(identity), "box": asdict(identity.box) if identity.box else None},
        look=asdict(seen) if seen else {},
        box=asdict(box),
        box_source=source,
        shake=[[round(float(v), 2) for v in row] for row in shaking.ratio],
        shake_area=asdict(shaking.area) if shaking.area else None,
        candidates=lines,
    )
    save(scan, root)
    say("save", "done", {"id": scan.id})
    return scan


def _lines(ls: list[ex.Line]) -> list[dict[str, Any]]:
    return [asdict(x) for x in ls]


def _normal_for(scan: Scan, root: Path | None) -> Scan | None:
    others = [
        s for s in all_scans(root) if s.normal and s.machine == scan.machine and s.id != scan.id
    ]
    return others[0] if others else None


def _normal_for_machine(machine: str, root: Path | None) -> Scan | None:
    named = machine.strip()
    if not named:
        return None
    found = [s for s in all_scans(root) if s.normal and s.machine == named]
    return found[0] if found else None


def analyse(
    scan_id: str,
    rpm: float,
    box: Box | None = None,
    bearing: str = "",
    root: Path | None = None,
) -> dict[str, Any]:
    """The physics on a scan, once a person has confirmed the shaft speed."""
    scan = load(scan_id, root)
    box = box or Box(**scan.box)
    c = _clip(str(_folder(scan_id, root) / scan.file))
    m = measure(c.frames, c.times, c.fps, box)
    speed, speed_note = ex.refine_speed(m.signal, c.fps, rpm)
    seen_lines = ex.lines(m.signal, c.fps, speed)
    camera = ex.camera_experiments(m.signal, c.fps, speed)
    standing = ex.consistent(camera)

    one, two = (ln for ln in seen_lines if ln.order in (1.0, 2.0))
    blind = abs(one.seen_hz - two.seen_hz) < ex.CAMERA_BIN_HZ or not one.clear
    if blind:
        standing = list(ex.CAMERA_KINDS)

    change = None
    normal = _normal_for(scan, root)
    if normal is not None and normal.analysis:
        then = [ex.Line(**x) for x in normal.analysis["lines"]]
        change = ex.against_normal(seen_lines, then, m.scale_px, normal.analysis["scale_px"], speed)

    heard, heard_note = [], "no sound track in this video"
    if c.audio is not None and len(c.audio):
        heard, heard_note = ex.sound_experiments(
            c.audio, c.audio_fs, speed, bearing or scan.identity.get("nameplate_text", "")
        )

    # Faults still possible: the camera's survivors, narrowed by the change from
    # normal when there is one, plus bearing faults unless the sound ruled on them.
    # With a normal scan on file and no shaft line doubled, no shaft fault has grown.
    if change and change.scores:
        top = change.scores[0].kind
        standing = [top] + [
            a.kind for a in change.scores[1:] if a.score >= change.scores[0].score - ex.TIE
        ]
    elif change is not None and not blind:
        standing = [FaultKind.HEALTHY]
    # Bearing damage can sit beside any shaft fault; only the sound speaks to it.
    if heard:
        standing += [k for k in BEARING_KINDS if k in ex.consistent(heard) and k not in standing]
    elif FaultKind.HEALTHY in standing:
        standing += [k for k in BEARING_KINDS if k not in standing]
    check = ex.next_check(standing, speed)

    result = {
        "rpm": speed,
        "rpm_given": rpm,
        "speed_note": speed_note,
        "box": asdict(box),
        "fps": c.fps,
        "direction_deg": m.direction_deg,
        "rms_px": m.rms_px,
        "scale_px": m.scale_px,
        "shake_removed": m.shake_removed,
        "lines": _lines(seen_lines),
        "camera_blind": blind,
        "camera": [
            {"kind": a.kind.value, "label": LABEL[a.kind], "score": a.score} for a in camera
        ],
        "normal_scan": normal.id if normal else None,
        "change": (
            {
                "growth": {str(k): v for k, v in change.growth.items()},
                "scores": [
                    {"kind": a.kind.value, "label": LABEL[a.kind], "score": a.score}
                    for a in change.scores
                ],
                "note": change.note,
            }
            if change
            else None
        ),
        "sound": [{"kind": a.kind.value, "label": LABEL[a.kind], "score": a.score} for a in heard],
        "sound_note": heard_note,
        "standing": [k.value for k in standing],
        "next_check": {"id": check.id, "name": check.name, "procedure": list(check.procedure)}
        if check
        else None,
        "spectrum": _spectrum(m.signal, c.fps),
        "summary": summary(
            speed, c.fps, seen_lines, camera, blind, change, heard, standing, check, scan
        ),
    }
    scan.analysis = result
    scan.box = asdict(box)
    save(scan, root)
    return result


def _spectrum(signal: np.ndarray, fps: float, points: int = 300) -> dict[str, list[float]]:
    f, mag = magnitude_spectrum(signal, fps)
    step = max(1, len(f) // points)
    return {"hz": [round(float(x), 3) for x in f[::step]], "px": [float(x) for x in mag[::step]]}


def _names(kinds: list[FaultKind]) -> str:
    words = [LABEL[k] for k in kinds]
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " or " + words[-1]


def summary(
    rpm: float,
    fps: float,
    seen_lines: list[ex.Line],
    camera: list[ex.Agreement],
    blind: bool,
    change: ex.Change | None,
    heard: list[ex.Agreement],
    standing: list[FaultKind],
    check: Any,
    scan: Scan,
) -> list[str]:
    """Plain sentences, every one traceable to a number in the analysis."""
    out = []
    findings = scan.look.get("findings") or []
    if findings:
        out.append(
            "Seen in the video (unconfirmed, check by eye): "
            + "; ".join(f"{f['what']}: {f['where']}" for f in findings)
            + "."
        )
    elif scan.look.get("retake"):
        out.append(f"The photo check needs a new photo: {scan.look['retake']}.")
    one = next(ln for ln in seen_lines if ln.order == 1.0)
    if blind:
        out.append(
            f"At {fps:.0f} fps the camera cannot separate the shaft lines of a {rpm:.0f} rpm machine "
            f"(1x and 2x land together near {one.seen_hz:.1f} Hz). Record in Slo-mo to see them."
        )
    else:
        best = [a for a in camera if a.kind in ex.consistent(camera)]
        out.append(
            f"The housing's motion matches {_names([a.kind for a in best])} best "
            f"(agreement {best[0].score:.2f}); the camera cannot see bearing damage."
        )
    if change is not None:
        if change.scores:
            g1 = change.growth.get(1.0, 0.0)
            g2 = change.growth.get(2.0, 0.0)
            out.append(
                f"Against this machine's normal scan, the 1x motion is {g1:.1f}x and the 2x motion {g2:.1f}x; "
                f"that change matches {LABEL[change.scores[0].kind]} best (agreement {change.scores[0].score:.2f})."
            )
        else:
            out.append(
                "Against this machine's normal scan, no shaft line has doubled: "
                "no sign of imbalance, misalignment or looseness growing."
            )
    elif FaultKind.HEALTHY in ex.consistent(camera) and not blind:
        out.append(
            "A clean 1x looks the same on a healthy and an out-of-balance machine; "
            "a scan of this machine running normally, marked as normal, would tell them apart."
        )
    if heard:
        out.append(
            f"The sound matches {_names(ex.consistent(heard))} best (agreement {heard[0].score:.2f})."
        )
    if check is not None and len(standing) > 1:
        out.append(
            f"Still possible: {_names(standing)}. The check that settles it: {check.name.lower()}."
        )
    elif len(standing) == 1:
        out.append(f"Leading explanation: {LABEL[standing[0]]}. Confirm on site before any repair.")
    return out


def mark_normal(scan_id: str, root: Path | None = None) -> Scan:
    """This scan is how its machine looks when it runs normally (one per machine)."""
    scan = load(scan_id, root)
    if not scan.analysis:
        raise ValueError("analyse the scan first, so its motion lines are on file")
    for other in all_scans(root):
        if other.machine == scan.machine and other.normal and other.id != scan.id:
            other.normal = False
            save(other, root)
    scan.normal = True
    save(scan, root)
    return scan
