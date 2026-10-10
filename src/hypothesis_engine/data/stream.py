"""Captures arriving from a live sensor, a batch at a time.

The bench rig's firmware posts one-second batches of raw accelerometer counts
(`firmware/esp32_rig`). This keeps the most recent unbroken stretch per machine,
cuts a capture out of it when a case is opened, and holds the captures a person
has marked as the machine running normally, which is what lets a case be scored
against the machine's own normal (`physics.normal`).

Nothing here reads the signal or moves a belief. Everything is held in memory:
a restart forgets the stretch and the normal, and says so by having neither.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from ..models import MachineSpec, Observation

#: Seconds of signal kept per machine. A case reads `CAPTURE_S` of it and a
#: normal `NORMAL_CAPTURES` times that; a minute leaves room for both.
KEEP_SECONDS = 60.0

#: Seconds of signal a case is opened on, the length of the rig's captures.
CAPTURE_S = 2.0

#: Captures cut from the stretch when a person marks it as normal. Several, so
#: the machine's own wander from capture to capture can be measured.
NORMAL_CAPTURES = 5

#: Samples one batch may hold: ten seconds at the rig's 2 kHz.
MAX_BATCH_SAMPLES = 20_000

#: How late or early a batch may start, as a share of its own length, before
#: the stretch counts as broken. A second of Wi-Fi delay must not be stitched
#: over: a gap in the signal would read as a jump in it.
GAP_TOLERANCE = 0.25


class NotEnoughSignal(ValueError):
    """The unbroken stretch on hand is shorter than what was asked for."""


@dataclass
class Stream:
    """One machine's recent signal and the captures marked as its normal."""

    machine: MachineSpec
    samples: np.ndarray = field(default_factory=lambda: np.zeros(0))
    next_start_ms: float | None = None
    batches: int = 0
    normal: list[Observation] = field(default_factory=list)

    @property
    def seconds(self) -> float:
        return len(self.samples) / self.machine.sample_rate_hz


class Streams:
    """The live signal of every machine this server knows how to simulate."""

    def __init__(self, machines: dict[str, MachineSpec]) -> None:
        self._streams = {key: Stream(spec) for key, spec in machines.items()}

    def get(self, machine_id: str) -> Stream:
        try:
            return self._streams[machine_id]
        except KeyError:
            raise KeyError(
                f"no machine {machine_id!r} on this server: its bearing and speed are not on file"
            ) from None

    def add(
        self, machine_id: str, sample_rate_hz: float, started_at_ms: float, samples: np.ndarray
    ) -> Stream:
        """Append one batch. A batch that does not follow on from the last one
        starts a new stretch; what came before is dropped, never bridged."""
        stream = self.get(machine_id)
        fs = stream.machine.sample_rate_hz
        if abs(sample_rate_hz - fs) > 1e-6 * fs:
            raise ValueError(
                f"{machine_id} is on file at {fs:.0f} Hz, and this batch is sampled at "
                f"{sample_rate_hz:.0f} Hz"
            )
        x = np.asarray(samples, dtype=float)
        if x.ndim != 1 or not 0 < len(x) <= MAX_BATCH_SAMPLES:
            raise ValueError(f"a batch holds 1 to {MAX_BATCH_SAMPLES} samples")
        if not np.all(np.isfinite(x)):
            raise ValueError("a batch must hold finite numbers only")
        length_ms = 1000.0 * len(x) / fs
        expected = stream.next_start_ms
        follows = (
            expected is not None and abs(started_at_ms - expected) <= GAP_TOLERANCE * length_ms
        )
        stream.samples = np.concatenate([stream.samples, x]) if follows else x
        keep = int(KEEP_SECONDS * fs)
        if len(stream.samples) > keep:
            stream.samples = stream.samples[-keep:]
        # Count on from the batch's own clock, so drift does not add up.
        stream.next_start_ms = started_at_ms + length_ms
        stream.batches += 1
        return stream

    def capture(self, machine_id: str, seconds: float = CAPTURE_S, back: int = 0) -> Observation:
        """The latest `seconds` of unbroken signal as a capture; `back` steps
        that many capture-lengths further into the past."""
        stream = self.get(machine_id)
        fs = stream.machine.sample_rate_hz
        n = int(round(seconds * fs))
        end = len(stream.samples) - back * n
        if end - n < 0:
            raise NotEnoughSignal(
                f"{machine_id} has {stream.seconds:.1f} s of unbroken signal; "
                f"{seconds * (back + 1):.0f} s are needed"
            )
        x = stream.samples[end - n : end]
        return Observation(
            machine_id=machine_id,
            waveform=x - float(np.mean(x)),
            sample_rate_hz=fs,
            rpm=stream.machine.nominal_rpm,
            source="live sensor",
        )

    def mark_normal(self, machine_id: str) -> int:
        """Keep the latest unbroken signal as this machine's normal: up to
        `NORMAL_CAPTURES` captures, newest first, as many as the stretch holds.
        Replaces any normal marked before. Returns how many were kept."""
        stream = self.get(machine_id)
        kept: list[Observation] = []
        for back in range(NORMAL_CAPTURES):
            try:
                kept.append(self.capture(machine_id, back=back))
            except NotEnoughSignal:
                break
        if not kept:
            raise NotEnoughSignal(
                f"{machine_id} has {stream.seconds:.1f} s of unbroken signal; "
                f"{CAPTURE_S:.0f} s are needed to mark a normal"
            )
        stream.normal = kept
        return len(kept)
