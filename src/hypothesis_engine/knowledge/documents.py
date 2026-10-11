"""The documents on file, by machine.

One, for the virtual pump set the demo runs on. It is written for this project
to stand in for a machine's manual and maintenance file, and every passage of it
says so where it is shown. It is built from the same constants the synthetic rig
is, so the document and the rig cannot disagree about the machine they describe.
That makes the demo circular in one respect: the fact the document supplies was
put there by us. What the demo shows is the path, a document to a suspect to a
physics test, not that a real manual would hold the fact.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..data.rig import AUX_PUMP_LOBES, AUX_PUMP_ORDER, AUX_PUMP_RATIO, BENCH_RIG
from ..models import MachineSpec

DEMO_NOTE = "A demo document written for this project, not a manufacturer's manual."

_SECTION = re.compile(r"^## (.+)$", re.MULTILINE)


@dataclass(frozen=True)
class Document:
    title: str
    text: str  # plain text in sections, each under a "## " heading
    note: str = ""

    def sections(self) -> list[tuple[str, str]]:
        """(heading, body) for each section, in order."""
        parts = _SECTION.split(self.text)
        return [
            (parts[i].strip(), " ".join(parts[i + 1].split()))
            for i in range(1, len(parts) - 1, 2)
            if parts[i + 1].strip()
        ]


def pump_set_notes(machine: MachineSpec) -> Document:
    """Site notes for the demo pump set, from the rig's own description of it."""
    b = machine.bearing
    designation = b.label.split(" (")[0]  # the label may carry a note of where it came from
    return Document(
        title="Chilled-water pump set 2: site notes",
        note=DEMO_NOTE,
        text=f"""
## About these notes
These notes describe chilled-water pump set 2 in data hall B: what is fitted and how it is
driven. They are kept with the machine's maintenance file.

## Nameplate
The motor runs the pump at a nominal {machine.nominal_rpm:g} rpm through a flexible coupling.

## Drive-end bearing
The drive-end bearing is a deep-groove ball bearing, designation {designation}, with
{b.n_rolling_elements} balls of {b.ball_diameter_mm:g} mm on a pitch circle of
{b.pitch_diameter_mm:g} mm. Fit a replacement of the same designation.

## Impeller
The pump impeller has {machine.blade_count} vanes. Debris caught between vanes puts the
rotor out of balance.

## Coupling and alignment
A flexible coupling joins the motor shaft and the pump shaft. Check the alignment with the
pump at running temperature, because the casing grows as it warms.

## Mounting
The motor and the pump sit on one baseplate. When the hold-down bolts are loosened, check
each foot for a gap before tightening again.

## Auxiliary seal-flush pump
A small booster pump on the bearing bracket keeps the mechanical seal flushed. It has
{AUX_PUMP_LOBES} lobes and is driven from the main shaft through a toothed belt at a ratio
of {AUX_PUMP_RATIO:g} to 1, so its lobes pass {AUX_PUMP_ORDER:g} times for every turn of the
main shaft. A worn lobe or a slack belt knocks at that rate. It has no sensor of its own.
""",
    )


#: Documents on file, by machine id.
DOCUMENTS: dict[str, tuple[Document, ...]] = {
    BENCH_RIG.machine_id: (pump_set_notes(BENCH_RIG),),
}
