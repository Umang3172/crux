"""Bearings whose fault frequencies are on file, and reading a part number off a label.

The sound check needs a bearing's fault frequencies, which follow from its inner
geometry. Every entry here is copied from a source that states it: the maker's
data sheet, or the paper or dataset page that describes the test rig. Nothing is
estimated; a bearing that is not here is TBD, and the sound is not checked for
bearing faults on it.

Two kinds of entry:

* **Geometry** (ball count, ball and pitch diameters, contact angle) when a source
  states it; the physics derives the frequencies.
* **Published multipliers only** when a maker publishes the frequencies but not the
  geometry (NTN-SNR's data sheets). BPFO + BPFI is the ball count and their
  difference fixes (d/D)·cos α, which is all BPFO, BPFI and the cage frequency
  depend on, so the entry stores that ratio, not dimensions. With α = 0 the
  ratio also gives the ball spin, and `tests/test_lens.py` checks it against the
  spin the maker publishes.

A part number is not always one design. NTN-SNR's sheets give the SNR 6204C3
seven balls and the 6204NREE eight, so their outer-race frequencies differ by 15%.
A label is therefore read as a bearing only when every design on file for that
number agrees within the slip window (`signals.features.BEARING_SLIP_FRACTION`);
otherwise the note asks for the full designation.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..forecast.runs import XJTU_BEARING
from ..models import SKF_6205_2RS_JEM, BearingGeometry
from ..physics.frequencies import bearing_multipliers
from ..signals.features import BEARING_SLIP_FRACTION

INCH_MM = 25.4

_CWRU = (
    "Case Western Reserve University Bearing Data Center, bearing information page "
    "(engineering.case.edu/bearingdatacenter/bearing-information), read 10 Oct 2026"
)
_SNR = "NTN Europe technical data sheet, docs.rs-online.com/{}.pdf, read 10 Oct 2026"


@dataclass(frozen=True)
class Bearing:
    maker: str  # as a label shows it; "" when the source does not name one
    designation: str  # as the source writes it
    series: str  # the number that names the size, e.g. "6205"
    geometry: BearingGeometry
    source: str
    #: What the source publishes, as multiples of shaft speed: bpfo, bpfi, ftf,
    #: bsf (one spin of the element) and bsf_2x (what CWRU calls "rolling element"
    #: and SNR "over rolling frequency on rolling element").
    published: dict[str, float] = field(default_factory=dict)
    variants: tuple[str, ...] = ()  # other designations the same source gives the same values for
    ratio_only: bool = False  # geometry is the ratio form of published multipliers

    @property
    def name(self) -> str:
        return f"{self.maker} {self.designation}".strip()

    def multipliers(self) -> dict[str, float]:
        return bearing_multipliers(self.geometry)


def _per_rev(shaft_hz: float, **hz: float) -> dict[str, float]:
    """Frequencies a source gives in Hz at one speed, as multiples of that speed."""
    return {k: v / shaft_hz for k, v in hz.items()}


def _ratio_only(
    maker: str,
    designation: str,
    series: str,
    source: str,
    variants: tuple[str, ...] = (),
    **published: float,
) -> Bearing:
    """An entry from published BPFO and BPFI alone: ball count and (d/D)·cos α."""
    total = published["bpfo"] + published["bpfi"]
    balls = round(total)
    if abs(total - balls) > 0.01:  # a misread sheet, not a bearing
        raise ValueError(f"{designation}: BPFO + BPFI = {total}, not a whole ball count")
    ratio = (published["bpfi"] - published["bpfo"]) / total
    geometry = BearingGeometry(
        n_rolling_elements=balls,
        ball_diameter_mm=ratio,
        pitch_diameter_mm=1.0,  # ratio form: these two are not dimensions
        contact_angle_deg=0.0,
        label=f"{maker} {designation} (ratio from the maker's BPFO and BPFI)",
    )
    return Bearing(maker, designation, series, geometry, source, published, variants, True)


TABLE: tuple[Bearing, ...] = (
    # ---------------------------------------------------------------- test rigs
    Bearing(
        "SKF",
        "6205-2RS JEM",
        "6205",
        SKF_6205_2RS_JEM,
        _CWRU + ", drive end: ball 0.3126 in, pitch 1.537 in",
        {"bpfi": 5.4152, "bpfo": 3.5848, "ftf": 0.39828, "bsf_2x": 4.7135},
    ),
    Bearing(
        "NSK",
        "6205 DDU",
        "6205",
        BearingGeometry(9, 7.90, 38.5, 0.0, label="NSK 6205 DDU (Jung et al. 2023)"),
        "W. Jung et al., Data in Brief 48 (2023) 109049, test bed section: 9 balls, "
        "7.90 mm, pitch 38.5 mm, 0 deg; frequencies at 3,010 rpm (50.17 Hz)",
        # The article's "BSF" (234.19 Hz) is twice the spin, as CWRU's rolling element.
        _per_rev(50.17, bpfo=179.43, bpfi=272.07, ftf=19.94, bsf_2x=234.19),
    ),
    Bearing(
        "SKF",
        "6203-2RS JEM",
        "6203",
        BearingGeometry(
            8,
            0.2656 * INCH_MM,
            1.122 * INCH_MM,
            0.0,
            label="SKF 6203-2RS JEM (CWRU fan end)",
        ),
        _CWRU + ", fan end: 8 balls (BPFO + BPFI = 8.0), ball 0.2656 in, pitch 1.122 in",
        {"bpfi": 4.9469, "bpfo": 3.0530, "ftf": 0.3817, "bsf_2x": 3.9874},
    ),
    Bearing(
        "LDK",
        "UER204",
        "UER204",
        XJTU_BEARING,
        "XJTU-SY dataset authors, biaowang.tech/xjtu-sy-bearing-datasets, bearing table: "
        "8 balls, 7.92 mm, mean diameter 34.55 mm, 0 deg (read 10 Oct 2026)",
    ),
    Bearing(
        "Rexnord",
        "ZA-2115",
        "ZA-2115",
        BearingGeometry(
            16,
            0.331 * INCH_MM,
            2.815 * INCH_MM,
            15.17,
            label="Rexnord ZA-2115 (IMS rig, double row)",
        ),
        "D. Sacerdoti, M. Strozzi, C. Secchi, Applied Sciences 13 (2023) 5977, Tables 2 "
        "and 3: 16 rollers per row, 0.331 in, pitch 2.815 in, 15.17 deg; frequencies "
        "at 33.3 Hz. The IMS readme names the bearing but not its geometry",
        # The table rounds to whole Hz; its 2 x BSF (278 Hz) is 0.7% below what the
        # stated geometry gives (279.8 Hz), so only BPFO, BPFI and FTF are checked.
        _per_rev(2000 / 60, bpfo=236.0, bpfi=297.0, ftf=15.0),
    ),
    Bearing(
        "",
        "MaFaulDa rig bearing",
        "MaFaulDa",
        # The page does not state a contact angle; its multipliers are reproduced
        # with 0 deg (cos α = 1 to within 0.1%), as a deep-groove bearing.
        BearingGeometry(8, 7.145, 28.519, 0.0, label="MaFaulDa rig bearing (model not named)"),
        "MaFaulDa page, www02.smt.ufrj.br/~offshore/mfs/page_01.html: 8 balls, "
        "0.7145 cm, cage diameter 2.8519 cm (read 10 Oct 2026)",
        {"ftf": 0.3750, "bpfo": 2.9980, "bpfi": 5.0020, "bsf": 1.8710},
    ),
    # ------------------------------------------------- maker data sheets (SNR)
    _ratio_only(
        "SNR",
        "6204NREE",
        "6204",
        _SNR.format("88ce/A700000014902302"),
        ("6204HVZZ", "6204G15C4"),
        bpfo=3.052,
        bpfi=4.948,
        bsf_2x=3.983,
        bsf=1.992,
        ftf=0.382,
    ),
    _ratio_only(
        "SNR",
        "6204C3",
        "6204",
        _SNR.format("1643/A700000014925459"),
        bpfo=2.595,
        bpfi=4.405,
        bsf_2x=3.611,
        bsf=1.806,
        ftf=0.371,
    ),
    _ratio_only(
        "SNR",
        "62204EE",
        "62204",
        _SNR.format("a762/A700000014964820"),
        ("62204EEC3",),
        bpfo=3.052,
        bpfi=4.948,
        bsf_2x=3.983,
        bsf=1.992,
        ftf=0.382,
    ),
    _ratio_only(
        "SNR",
        "6206NREE",
        "6206",
        _SNR.format("ce14/A700000014925816"),
        ("6206C4", "6206F600", "6206NRZZ", "6206SEE"),
        bpfo=3.568,
        bpfi=5.432,
        bsf_2x=4.622,
        bsf=2.311,
        ftf=0.396,
    ),
    _ratio_only(
        "SNR",
        "6305NREE",
        "6305",
        _SNR.format("7fcf/A700000014927897"),
        ("6305F600",),
        bpfo=2.542,
        bpfi=4.458,
        bsf_2x=3.38,
        bsf=1.69,
        ftf=0.363,
    ),
    _ratio_only(
        "SNR",
        "6305ZZ",
        "6305",
        _SNR.format("56a1/A700000014914301"),
        bpfo=2.574,
        bpfi=4.426,
        bsf_2x=3.515,
        bsf=1.758,
        ftf=0.368,
    ),
    _ratio_only(
        "SNR",
        "62305EE",
        "62305",
        _SNR.format("5f34/A700000015015483"),
        bpfo=2.542,
        bpfi=4.458,
        bsf_2x=3.38,
        bsf=1.69,
        ftf=0.363,
    ),
    _ratio_only(
        "SNR",
        "6306NR",
        "6306",
        _SNR.format("27ab/A700000014893557"),
        ("6306NRC3",),
        bpfo=3.054,
        bpfi=4.946,
        bsf_2x=3.99,
        bsf=1.995,
        ftf=0.382,
    ),
    _ratio_only(
        "SNR",
        "6306C3",
        "6306",
        _SNR.format("0abb/A700000014914317"),
        bpfo=3.084,
        bpfi=4.916,
        bsf_2x=4.139,
        bsf=2.07,
        ftf=0.386,
    ),
    _ratio_only(
        "SNR",
        "62306EE",
        "62306",
        _SNR.format("4ff3/A700000014962107"),
        bpfo=3.054,
        bpfi=4.946,
        bsf_2x=3.99,
        bsf=1.995,
        ftf=0.382,
    ),
)

#: Makers as a label writes them. SNR is checked before NTN because SNR labels
#: often read "NTN-SNR".
_MAKERS: tuple[tuple[str, str], ...] = (
    ("SNR", "SNR"),
    ("SKF", "SKF"),
    ("NSK", "NSK"),
    ("NTN", "NTN"),
    ("FAG", "FAG"),
    ("SCHAEFFLER", "FAG"),
    ("KOYO", "KOYO"),
    ("NACHI", "NACHI"),
    ("TIMKEN", "TIMKEN"),
    ("LDK", "LDK"),
    ("REXNORD", "Rexnord"),
)


def _series_pattern(series: str) -> re.Pattern[str]:
    """A part number standing alone: '6205' in 'SKF 6205-2RS' or 'NSK6205', not in '62050' or '16205'."""
    letters, digits = re.match(r"([A-Za-z-]*)(\d*)", series).groups()  # type: ignore[union-attr]
    letters = letters.rstrip("-").upper()
    if not digits:  # a dataset name, e.g. MaFaulDa
        return re.compile(rf"(?<![A-Z0-9]){re.escape(series.upper())}(?![A-Z0-9])")
    head = rf"(?<![A-Z0-9]){letters}[\s-]?" if letters else r"(?<![0-9])"
    return re.compile(head + digits + r"(?![0-9])")


_SERIES = {b.series: _series_pattern(b.series) for b in TABLE}


def _flat(text: str) -> str:
    return re.sub(r"[\s\-_/.]", "", text.upper())


def _maker(text: str) -> str:
    up = text.upper()
    for token, maker in _MAKERS:
        if re.search(rf"(?<![A-Z]){token}(?![A-Z])", up):
            return maker
    return ""


def _agree(found: list[Bearing]) -> bool:
    """Whether the designs' race frequencies agree within the slip window."""
    for key in ("bpfo", "bpfi"):
        values = [b.multipliers()[key] for b in found]
        if (max(values) - min(values)) / min(values) > BEARING_SLIP_FRACTION:
            return False
    return True


def _designs(found: list[Bearing]) -> str:
    return "; ".join(
        f"{b.name}: {b.geometry.n_rolling_elements} balls, BPFO {b.multipliers()['bpfo']:.3f}x"
        for b in found
    )


@dataclass(frozen=True)
class Reading:
    bearing: Bearing | None
    note: str


def lookup(text: str) -> Reading:
    """The bearing a label or typed part number names, or why it cannot be read."""
    if not text.strip():
        return Reading(None, "no bearing part number given")
    up = text.upper()
    found = [b for b in TABLE if _SERIES[b.series].search(up)]
    if not found:
        return Reading(
            None, f"'{text.strip()}' is not on file (TBD), so its fault frequencies are unknown"
        )
    numbers = sorted({b.series for b in found})
    if len(numbers) > 1:
        return Reading(
            None, f"more than one bearing number in '{text.strip()}': {', '.join(numbers)}"
        )
    series, maker, flat = numbers[0], _maker(text), _flat(text)
    exact = [b for b in found if any(_flat(d) in flat for d in (b.designation, *b.variants))]
    if exact and (not maker or any(b.maker == maker for b in exact)):
        best = next((b for b in exact if b.maker == maker), exact[0])
        return Reading(best, f"read as {best.name}")

    if maker:
        same = [b for b in found if b.maker == maker]
        if same:
            found = same
        elif len({b.maker for b in found}) >= 2 and _agree(found):
            return Reading(
                found[0],
                f"no {maker} {series} on file; read as {found[0].name}, which agrees within "
                f"{BEARING_SLIP_FRACTION:.0%} with the other makers' {series} on file",
            )
        else:
            return Reading(
                None,
                f"no {maker} {series} on file (TBD). On file: {_designs(found)}. "
                "Makers' designs can differ, so it is not assumed",
            )
    if not _agree(found):
        return Reading(
            None,
            f"{series} is made in more than one design on file ({_designs(found)}); "
            "enter the full designation from the bearing",
        )
    others = f"; the other {series} designs on file agree within {BEARING_SLIP_FRACTION:.0%}"
    return Reading(found[0], f"read as {found[0].name}" + (others if len(found) > 1 else ""))
