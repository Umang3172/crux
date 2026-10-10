"""Update bundles: what the cloud sends a site, signed so a site can trust it.

A bundle is a folder: `manifest.json` (version, kind, the hash of every file,
the runs any model was trained on), `manifest.sig`, `lessons.jsonl` and
`models/`. Kind is "alert" (lessons only, sent the moment a site confirms a
major failure) or "monthly" (lessons and retrained models).

The signature is an HMAC-SHA256 with a key the hub and its sites share
(`CRUX_HUB_KEY`, or `hub.key` beside the hub). A production hub would sign with
a private key and give sites only the public one; that is TBD.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import shutil
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from .memory import Lesson


class BadBundle(Exception):
    """A bundle whose signature or files do not check out. Never installed."""


@dataclass
class Manifest:
    version: int
    kind: str  # alert | monthly
    hub: str
    created: str = field(default_factory=lambda: datetime.now(UTC).isoformat(timespec="seconds"))
    machine_types: list[str] = field(default_factory=list)
    files: dict[str, str] = field(default_factory=dict)  # relative path -> sha256
    trained_on: list[str] = field(default_factory=list)  # run ids behind any model
    note: str = ""


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _sign(key: bytes, manifest_bytes: bytes) -> str:
    return hmac.new(key, manifest_bytes, hashlib.sha256).hexdigest()


def key_from(env_or_file: Path | None = None) -> bytes:
    """The shared key: CRUX_HUB_KEY, else the file given."""
    if os.getenv("CRUX_HUB_KEY"):
        return os.environ["CRUX_HUB_KEY"].encode()
    if env_or_file is not None and env_or_file.exists():
        return env_or_file.read_bytes().strip()
    raise BadBundle("no hub key: set CRUX_HUB_KEY or provide hub.key")


def write(
    folder: Path,
    manifest: Manifest,
    lessons: list[Lesson],
    models: dict[str, Path],
    key: bytes,
) -> Path:
    """Lay out a bundle in `folder` and sign it."""
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "lessons.jsonl").write_text("".join(json.dumps(asdict(x)) + "\n" for x in lessons))
    if models:
        (folder / "models").mkdir(exist_ok=True)
    for name, src in models.items():
        shutil.copyfile(src, folder / "models" / name)
    manifest.files = {
        str(p.relative_to(folder)): _sha(p)
        for p in sorted(folder.rglob("*"))
        if p.is_file() and p.name not in ("manifest.json", "manifest.sig")
    }
    raw = json.dumps(asdict(manifest), indent=2, sort_keys=True).encode()
    (folder / "manifest.json").write_bytes(raw)
    (folder / "manifest.sig").write_text(_sign(key, raw))
    return folder


def verify(folder: Path, key: bytes) -> Manifest:
    """The manifest, if the signature and every file hash check out; BadBundle otherwise."""
    try:
        raw = (folder / "manifest.json").read_bytes()
        sig = (folder / "manifest.sig").read_text().strip()
    except OSError as e:
        raise BadBundle(f"{folder.name}: incomplete ({e})") from e
    if not hmac.compare_digest(_sign(key, raw), sig):
        raise BadBundle(f"{folder.name}: signature does not match")
    m = Manifest(**json.loads(raw))
    for rel, digest in m.files.items():
        p = folder / rel
        if not p.is_file() or _sha(p) != digest:
            raise BadBundle(f"{folder.name}: {rel} is missing or changed")
    extra = {
        str(p.relative_to(folder))
        for p in folder.rglob("*")
        if p.is_file() and p.name not in ("manifest.json", "manifest.sig")
    } - set(m.files)
    if extra:
        raise BadBundle(f"{folder.name}: files not in the manifest: {sorted(extra)}")
    return m


def lessons_in(folder: Path) -> list[Lesson]:
    out = []
    path = folder / "lessons.jsonl"
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip():
                d = json.loads(line)
                d["cases"] = tuple(d.get("cases", ()))
                out.append(Lesson(**d))
    return out
