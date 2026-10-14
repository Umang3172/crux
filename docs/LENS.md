# Crux Lens: point a phone at a machine

A technician records about ten seconds of video of a running machine. Crux
reads three things from that one clip:

| Reading | From | What it can say | Counts as evidence? |
|---|---|---|---|
| **Look** | a vision model on one still | what the machine is, nameplate text, plainly visible trouble (a leak, a thrown belt) | no: shown as unconfirmed |
| **Motion** | the video frames, through the physics | how the housing shakes at each shaft order: imbalance, misalignment, looseness | yes: virtual experiments |
| **Sound** | the audio track, through the physics | bearing impacts, when the bearing's geometry is known | yes: virtual experiments |

The result is plain sentences, each traceable to a number, and the one
catalog check that would settle what is still possible. Code:
`src/hypothesis_engine/lens/`, API `api/lens.py`, screen `web/src/pages/Lens.tsx`.

## Motion: every pixel is a displacement sensor

The housing's shift against the first frame is measured in every frame: a
whole-pixel step by phase correlation, then one Lucas–Kanade step below a pixel
(`motion.track`). A still, textured patch beside the machine (a wall, the floor)
is measured the same way and subtracted, which removes the phone's own shake.
The result is a displacement waveform sampled at the frame rate, the same kind
of signal an accelerometer gives, only slower. Camera vibrometry is established
practice: phase-based motion processing (Wadhwa et al., ACM TOG 2013) and
commercial motion-amplification cameras (RDI Iris M) work this way.

**Where to measure** comes from the video itself, not from the model. The frame
is cut into a 6 x 8 grid; each cell is tracked, motion shared by every cell (the
phone) is removed, and the cells that shake at least 4 times more than the
median cell are boxed (`motion.shake_map`). On 7 Oct 2026 a local vision model
boxed three different places on three stills of the same motor, so its box is
only the fallback. The box a person confirms on a machine's normal scan is
reused for its later scans, so they measure the same spot.

**What the camera can see** is set by the frame rate: lines up to half of it.
Each shaft-order fault from `physics.signatures` is synthesised *as this camera
samples it*, aliasing included, and compared with the measured motion by the
same log peak-hold correlation the investigation uses (`experiments.camera_experiments`).
So even 30 fps can separate misalignment from looseness when the folded lines
land apart. When two orders fold onto the same line (60 fps on a 2,400 rpm
machine puts 1x and 2x both at 20 Hz), the lens says it cannot tell and asks for
Slo-mo. Bearing impacts are far above any phone frame rate: the camera never
speaks to bearing damage.

**Healthy or out of balance?** Both are a clean 1x, so shape cannot separate
them. A level can: once a scan is marked as the machine's normal one, later
scans are compared with it. Each shaft line's amplitude is divided by the size of
the machine's box (a phone held closer does not look like a worse machine);
lines that at least doubled count as grown, the same doubling the watcher needs
before it alarms (FORECAST.md). The growth is matched with what each fault adds
over a healthy machine in its signature: imbalance adds 1x, misalignment 2x and
3x, looseness half orders and a run of harmonics (`experiments.against_normal`).

## Sound

A phone microphone records at audio rates, so with the bearing's geometry every
hypothesis, impacts included, is synthesised and compared with the sound by the
investigation's raw-plus-envelope correlation (`experiments.sound_experiments`).
The bearing's fault frequencies must be on file (`lens/bearings.py`, below); any
other bearing is TBD and the sound is not used. Phone microphones hear little
below about 200 Hz (IEEE 7449545), so the sound speaks mainly to bearings,
while the video speaks to shaft faults: the two split the spectrum.

### Bearings on file

Each entry is copied from a source that states it; nothing is estimated. Where
a maker publishes fault frequencies but not the geometry (NTN-SNR's data sheets),
the entry keeps what they fix: the ball count (BPFO + BPFI) and (d/D)·cos α. The
derived ball spin then matches the maker's published spin within 0.1%, which
confirms a 0° contact angle (`tests/test_lens.py`).

| Bearing | Balls | BPFO | BPFI | Source |
|---|---|---|---|---|
| SKF 6205-2RS JEM | 9 | 3.585 | 5.415 | CWRU bearing page: 7.94 mm balls, 39.04 mm pitch |
| NSK 6205 DDU | 9 | 3.577 | 5.423 | Jung et al., Data in Brief 48:109049 (2023): 7.90 mm, 38.5 mm |
| SKF 6203-2RS JEM | 8 | 3.053 | 4.947 | CWRU bearing page: 0.2656 in, 1.122 in |
| LDK UER204 | 8 | 3.083 | 4.917 | XJTU-SY authors' bearing table: 7.92 mm, 34.55 mm |
| Rexnord ZA-2115 | 16 per row | 7.092 | 8.908 | Sacerdoti et al., Applied Sciences 13:5977 (2023): 0.331 in, 2.815 in, 15.17° |
| MaFaulDa rig bearing | 8 | 2.998 | 5.002 | MaFaulDa page: 0.7145 cm, 2.8519 cm; model not named |
| SNR 6204NREE, 6204HVZZ, 6204G15C4 | 8 | 3.052 | 4.948 | NTN Europe data sheets (maker's frequencies) |
| SNR 6204C3 | 7 | 2.595 | 4.405 | NTN Europe data sheet |
| SNR 62204EE, 62204EEC3 | 8 | 3.052 | 4.948 | NTN Europe data sheets |
| SNR 6206NREE, C4, F600, NRZZ, SEE | 9 | 3.568 | 5.432 | NTN Europe data sheets |
| SNR 6305NREE, 6305F600; 62305EE | 7 | 2.542 | 4.458 | NTN Europe data sheets |
| SNR 6305ZZ | 7 | 2.574 | 4.426 | NTN Europe data sheet |
| SNR 6306NR, 6306NRC3; 62306EE | 8 | 3.054 | 4.946 | NTN Europe data sheets |
| SNR 6306C3 | 8 | 3.084 | 4.916 | NTN Europe data sheet |

Multiples of shaft speed. Sheet addresses and read dates are in the code.

**A part number is not always one design.** NTN-SNR's sheets give the 6204C3
seven balls and the 6204NREE eight: their outer-race lines differ by 15%, far
beyond the 1 to 2% bearings slip (Randall and Antoni 2011). So a label is read
only when every design on file for that number agrees within the slip window
(`BEARING_SLIP_FRACTION`, 2%). "6204" alone is refused with both designs named;
"SNR 6204 C3" is read. A maker with nothing on file is not assumed from another
maker ("SKF 6206" is refused), unless two makers already agree for that number:
the 6205s from SKF (CWRU) and NSK (Jung et al.) differ by 0.2%, so "FAG 6205"
reads as the SKF one, and the note says so. Numbers that only contain a bearing
number ("62050", "16205") are not read as one.

Still TBD: SKF, NSK, FAG and other makers' 6204, 6206, 6305 and 6306 (their
public pages give ball counts at most, never the pitch diameter: NSK's 6206 page
gives 9 balls of 9.525 mm and no pitch diameter, so it is not used).

## The look, and why it is checked twice

A vision model names the machine, copies nameplate text and boxes the housing
(`look.identify`); visible trouble goes through the CCTV look-and-confirm
(`ticket.camera.inspect`). Nameplate text stands only if a second, focused
question reads it too: on 7 Oct 2026 a local 8B model wrote out a whole
nameplate for a still where no text is legible, then said on the second look
that it was not legible, while confirming the real "ABB" badge on a full-size
photo. A person types the speed; a model reading is never used as a number.

Models, in order: Gemini Robotics-ER 2 (`GEMINI_LENS_MODEL`, default
`gemini-robotics-er-2-preview`) when a Gemini key is set, not yet run; a local
model through Ollama when `OLLAMA_MODEL` is set (tested with Gemma 4); otherwise
none, and the person draws the box. Nothing here moves a belief.

### The photo check (`ticket/camera.py`, `ticket/photo.py`)

The same check serves a Lens scan and the CCTV still on a repair ticket. It
answers a fixed checklist instead of an open question: crack; leak (oil, water,
coolant); corrosion or rust; belt damage or a thrown belt; discolouration or heat
marks; loose or missing fasteners or guards; smoke. For each item the model gives
a status (present, absent, unsure, cannot see), a severity when present, a box,
one sentence of visible evidence, and, beside a reference photo, whether it is
new since then. Boxes are `[ymin, xmin, ymax, xmax]` in 0 to 1000 of the image,
Gemini's convention, for every model. The reply is constrained by a JSON schema
(Gemini structured output; Ollama's `format`). Smoke, or anything graded high, is
marked a hazard.

1. **Quality gate, before any model.** A still that is too small, too dark, blown
   out or blurred is turned back with the measured reason and no model sees it;
   the ticket then says, truly, that nobody has looked at it. A model answering
   "cannot see" for every item counts the same.
2. **Reference photo.** In Lens, the middle still of the scan a person marked as
   the machine's normal one. For CCTV, an optional `normal` still per machine in
   `data/cameras.json`. Both photos go in one request, labelled reference
   (normal) and now.
3. **First look**, the whole checklist.
4. **Second look on a crop.** Each item reported present is cut out around its
   box with margin and asked about again as a yes or no, with the same region of
   the reference. Only what this confirms is kept; the number dropped is recorded.
   The crop is the deterministic stand-in for Agentic Vision's zoom when the model
   cannot run code, and it is used for every model so their scores compare.

Models: **Gemini 3 Flash with code execution** ("Agentic Vision", blog.google,
27 Jan 2026: the model crops and zooms in Python; Google reports "a consistent
5-10% quality boost across most vision benchmarks") when a Gemini key is set:
`GEMINI_VISION_MODEL` (default `gemini-3-flash-preview`), `GEMINI_AGENTIC_VISION=0`
to run it without code execution. Gemini 3 accepts structured output together
with code execution (ai.google.dev, Gemini 3 guide, read 10 Oct 2026); if a model
refuses the pair, the look is taken in two steps, then written into the schema.
Temperature stays at 1.0, as that guide asks. **Not run: no Google Cloud access
yet.** A local model through Ollama when `OLLAMA_MODEL` is set: tested with Gemma
4 8B, 27 s for one first look on a 1280 x 1211 photo. Otherwise nobody looks, and
the screen says so.

Everything the check keeps is shown as unconfirmed, boxed on the photo, for a
person to check before acting. It never reaches the investigation, and a test
asserts that a camera finding leaves every belief and the ledger unchanged.

Limits: the same region of the reference is only the same part of the machine
when the framing matches (a fixed CCTV camera; a phone held roughly where the
normal scan was taken). The gate's blur and exposure bars are provisional (below).

## Numbers and where they come from

| Constant | Value | Why |
|---|---|---|
| `clip.MAX_SECONDS` | 12 s | 10 s resolves 0.1 Hz; caps a 240 fps clip near 2,900 frames |
| `clip.MOTION_LONG_SIDE` | 400 px | sub-pixel tracking survives; memory stays near 200 MB at 240 fps |
| `motion.HIGHPASS_HZ` | 2 Hz | drift out; hand tremor is 1 to 10 Hz (US patent 7796159) and is removed by the still patch |
| `motion.MAP_GRID` | 6 x 8 | cells of about 50 px on a 400 px frame |
| `motion.MAP_PROMINENCE` | 4 x median | the bar order tracking sets for a shaft peak (`signals.features`) |
| `motion.MIN_TEXTURE` | 2 grey levels/px | a plain wall cell's motion is noise; such cells are left out |
| `experiments.CAMERA_BIN_HZ` | 1 Hz | absorbs a few percent of speed error at 20 to 50 Hz lines |
| `experiments.TIE` | 0.05 | right and wrong faults differ by more on clean tests (`tests/test_lens.py`) |
| `experiments.GROWN` | 2 x | the watcher's doubling rule |
| `photo.MIN_SHORT_SIDE_PX` | 224 px | smallest input common vision encoders were trained at (CLIP ViT-B/32, Radford et al. 2021); below it a model only enlarges the photo |
| `photo.MEASURE_LONG_SIDE_PX` | 1024 px | stills are measured at the Lens still size, downscaled only |
| `photo.MIN_SHARPNESS` | 100 | **provisional**: variance of the Laplacian (Pech-Pacheco et al., ICPR 2000) with a published rule-of-thumb bar (Rosebrock, PyImageSearch, 2015); replaced by `photo_eval.py --calibrate` |
| `photo.DARK_P99`, `photo.BRIGHT_P1` | 32, 223 of 255 | **provisional**: the brightest 1% in the bottom eighth, or the darkest 1% in the top eighth, is a near-black or near-white frame |
| `photo.CROP_MARGIN`, `photo.CROP_MIN_FRACTION` | half the box each side; a quarter of the short side at least | design choice: the second look sees a leak's source and the floor under it; not fitted |

## Known limits (7 Oct 2026, updated 10 Oct)

- No measured accuracy for anything in Lens: the sound check has scripts and
  loaders but no downloaded data; the photo check was scored on 7 stand-in photos
  only (above); the motion check has no public video to score on.

- Tested on synthetic video only: a textured scene, and a real rig photo whose
  motor was made to shake at known shaft orders, encoded with H.264. No phone
  video of a real faulty machine has been through it yet.
- Units are pixels, not millimetres: no ISO 10816 severity zone without a
  scale. Severity comes from the change since the normal scan.
- Whether a phone's Slo-mo file keeps its capture rate through a browser upload
  is TBD. The lens reads the rate from frame times (edit lists ignored) and
  warns when the file's nominal rate disagrees.
- Live video (Gemini Live API, ER 2 streaming at up to 1 fps) can say what and
  where, never how fast something shakes; not built.

## Try it

```bash
uv pip install -e ".[lens]"                      # PyAV and Pillow
OLLAMA_MODEL=gemma4:latest uv run uvicorn deploy.server:app --port 8080
cd web && VITE_API_BASE= npm run dev -- --host   # --host: open it from a phone on the same Wi-Fi
```

Open the **Lens** tab. On a phone, use the laptop's address that Vite prints
under "Network". Record a clip of a desk fan, mark it as normal, tape a coin to
one blade, record again: the second scan should read as out of balance.

## Data for testing

Checked 10 Oct 2026 against each dataset's own page, paper or archive index.
Nothing here is downloaded by code: a person fetches it into a folder under
`data/` that git ignores (`data/.gitignore`), then the scripts in `scripts/` run.

| Data | Where | Licence | Size | What is in it | Lens check |
|---|---|---|---|---|---|
| **MaFaulDa** (UFRJ) | www02.smt.ufrj.br/~offshore/mfs/page_01.html | not stated on the page | 13.0 GB; per class 0.3 to 3.7 GB | 1,951 CSV recordings, 8 columns: tachometer, two 3-axis accelerometers, microphone (Shure SM81). 250,000 samples each, stated as 50 kHz for 5 s. Normal 49; horizontal misalignment 197 (0.5 to 2.0 mm); vertical misalignment 301 (0.51 to 1.90 mm); imbalance 333 (6 to 35 g); bearing faults 1,071 in folders `outer_race`, `ball_fault`, `cage_fault`, each with 0, 6, 20 or 35 g added. 737 to 3,686 rpm. Bearing: 8 balls, 7.145 mm, 28.519 mm pitch (model not named) | **sound** |
| **Jung et al. 2023** (KAIST) | Data in Brief 48:109049; data doi 10.17632/ztmf3m7h5x.6 | CC BY 4.0 | sound: `acoustic.zip` 47.2 MB (vibration 2.66 GB, current and temperature 1.55 GB) | Five 60 s microphone recordings (PCB 378B02 by bearing housing A, 51.2 kHz, pascals), all at 0 Nm: normal, inner race 0.3 and 1.0 mm, outer race 0.3 and 1.0 mm. 3,010 rpm, stated (no tachometer in these files). Bearing NSK 6205 DDU. Misalignment and unbalance were recorded by accelerometer only | **sound** (n = 5) |
| Phys-AD (CVPR 2025) | guyao2023.github.io/Phys-AD; huggingface.co/datasets/guoliz/Phys-AD | not stated | 32.1 GB | 6,359 clips of 22 objects driven by a robot arm or motor, 60 fps, 1080p, 60 to 240 frames. Rotating objects: a fan (stuck, uneven rotation, vibration), a rolling bearing (lack of friction), gears (stuck, not meshed). No pumps, motors as subjects, misalignment or shaft speeds | none: 1 to 4 s at 60 fps, no speed or shaft-fault label |
| SURVISHNO 2019 contest | survishno.sciencesconf.org, "Contest" page | not stated | TBD | Two silent smartphone clips: a fan at varying speed, a beam on a shaker. Full clips through a sign-up form | none: speed reading at most |
| SURVISHNO 2023 contest | doi 10.5281/zenodo.13707571 | CC BY 4.0; the rules add "scientific research only" | 4.2 GB zip (15.2 GB AVI) + 50.6 MB MAT | One bearing at varying speed, outer ring on springs, high-speed camera at 2,000 fps (23,723 frames of 800 x 800 px), with 51.2 kHz tachometer and accelerometer records | none: one bearing, varying speed, not a phone |
| MMAD (ICLR 2025) | huggingface.co/datasets/jiang-cc/MMAD | CC BY-NC-SA 4.0 | 28.4 GB | 8,366 product images (MVTec AD, MVTec LOCO, VisA, GoodsAD) with 39,672 questions, each with a normal template image. Best model in the paper: GPT-4o, 74.9% | look, as a protocol reference only: no machines; non-commercial |
| MVTec AD | mvtec.com/company/research/datasets/mvtec-ad | CC BY-NC-SA 4.0, no commercial use | over 5,000 images | 15 product and texture categories, normal and defective (cracks, scratches) | look stand-in (cracks); non-commercial |
| KolektorSDD2 | vicos.si/resources/kolektorsdd2 | CC BY-NC-SA 4.0 | TBD | 356 defective and 2,979 good surface images of production items, about 230 x 630 px | none of the checklist |
| Roboflow `giv/crack_2025` | universe.roboflow.com/giv/crack_2025 | CC BY 4.0, as declared by the uploader | 1,239 images | crack, corrosion and numbered classes; no description, no published version (export needs an account and a fork); source of the images unknown | look stand-in (crack, corrosion), not machines |
| Roboflow `damagepipe/corrosion-detection` | universe.roboflow.com | - | - | "Project Not Found" on 10 Oct 2026 | none |
| D-Fire | github.com/gaiasd/DFireDataset | CC0 1.0 (repository licence) | TBD | 21,527 scene images: smoke only 5,867, fire only 1,164, both 4,658, neither 9,838, with boxes | look stand-in (smoke), not machines |
| BeltCrack (arXiv 2506.17892) | github.com/UESTC-nnLab/BeltCrack; doi 10.57760/sciencedb.31181 | code Apache-2.0; dataset terms not stated | TBD | 14,087 + 9,645 frames from 29 + 42 sequences of real conveyor belts with cracks | look stand-in (belt damage); conveyor belts, not V-belt drives; split by sequence |

**Which checks have no real data.** The motion check has none: no public phone
video of a machine with a known shaft fault at a known speed was found. The photo
check has no labelled photos of real pumps, motors or belt drives with the
checklist's faults; the sets above are product surfaces, conveyor belts and smoke
scenes, so a score on them says how the look behaves on those, not on machines.
Only the sound check has real recordings with labels, both from lab rigs with a
measurement microphone, not a phone.

**MaFaulDa, read with care.**
- Sample rate: the page states 50 kHz, and also that two NI 9234 modules sampled
  at 51.2 kHz. Every file is named by its shaft frequency (`12.288.csv`), and every
  name is a whole multiple of 0.2048 Hz = 51,200 / 250,000, so the names were
  computed at 51.2 kHz. Ratios to shaft speed do not depend on which is right when
  the speed is read from the same file's tachometer, which is how the loader reads it.
- Bearing labels: the text says the three faulty bearings had outer track, rolling
  element and inner track defects; the folders say `outer_race`, `ball_fault` and
  `cage_fault`, and the file counts per folder match neither naming consistently.
  The loader takes `outer_race` as outer race and treats ball and cage as causes
  Crux does not hold; no folder is labelled inner race.
  `scripts/lens_sound_eval.py --label-check` measures which bearing frequency each
  folder's accelerometer actually carries, instead of assuming.

**Download steps (a person runs these).**

```bash
# MaFaulDa, about 13 GB in all. Licence not stated on the page: use for testing, do not redistribute.
mkdir -p data/mafaulda && cd data/mafaulda
for f in normal imbalance horizontal-misalignment vertical-misalignment overhang underhang; do
  curl -O "https://www02.smt.ufrj.br/~offshore/mfs/database/mafaulda/$f.zip" && unzip -q "$f.zip" && rm "$f.zip"
done
cd ../..

# Jung et al. 2023 sound, 47.2 MB, CC BY 4.0: on https://data.mendeley.com/datasets/ztmf3m7h5x/6
# download acoustic.zip, then:
mkdir -p data/jung2023/acoustic && unzip acoustic.zip -d data/jung2023/acoustic
```

The layout the loaders expect: `data/mafaulda/normal/12.288.csv`,
`data/mafaulda/overhang/ball_fault/0g/22.3232.csv` and so on, and
`data/jung2023/acoustic/0Nm_BPFO_10.mat`.

## Scoring the sound check on real recordings

`scripts/lens_sound_eval.py` runs `experiments.sound_experiments`, the call a
scan makes, on every recording found under `data/`, twice:

- **raw**: the dataset's measurement microphone;
- **phone**: the same sound through `lens/phone.py`, an emulation kept apart from
  the physics: resampled to 48 kHz (AES5's recommended rate), a fourth-order
  high-pass at 200 Hz (phone microphones hear little below it, IEEE 7449545; the
  order is an assumption until a real phone's response replaces it), and white
  noise at a stated SNR when `--snr` is given.

The speed is the dataset's: MaFaulDa's own tachometer column, read with
hysteresis and a straight-line fit through every pulse (`datasets.tach_rpm`);
Jung et al.'s stated 3,010 rpm. The bearing is the dataset's (`lens/bearings.py`).
Labels only score. The report gives, per condition: true cause against leading
cause, how often the top two are within `TIE` ("can't tell"), the rank of the
right bearing fault, shaft faults on their own rows, and for ball and cage faults
(causes Crux does not hold) how often a bearing fault leads anyway. Rows with
fewer than 30 cases are flagged. It also reports the tachometer-to-file-name
speed ratio (the 50 versus 51.2 kHz question) and, with `--label-check`, which
bearing line each MaFaulDa folder's accelerometer actually carries.

```bash
uv run python scripts/lens_sound_eval.py --label-check --out data/lens_eval/sound.md
```

**Results: none yet (10 Oct 2026).** Neither dataset is downloaded on the
machine this was written on, and downloading is a person's step (download steps
above). Until a run is written here, Crux has no measured accuracy for the sound
check. Expectations, not results: shaft faults should read poorly from sound,
worse through the phone emulation, because their evidence sits below the 200 Hz
cut (on MaFaulDa 1x is 12 to 61 Hz and 3x at most 184 Hz); bearing faults depend on whether
the microphone hears the impacts in the 1.5 to 5 kHz envelope band the physics
reads. Jung et al. gives n = 5 recordings (60 cases of 5 s, not independent), so
any share from it is anecdotal; MaFaulDa gives 1,951. If the results are poor,
the fix is reported with the numbers and goes through `docs/DECISIONS.md`; no
constant is moved to improve them.

## Scoring the photo check

`scripts/photo_eval.py` runs `camera.inspect`, the call a ticket and a scan make,
on `data/photo_eval/<label>/*.jpg` (label `normal` or checklist items joined by
`+`), without and, where `pairs.csv` names one, with the normal photo beside it,
and reads each look after the first look and after the second. Per item it
counts hits, misses, unsure, cannot see, false alarms on normal photos and
retakes, with n everywhere. A fixed 20% of photos, chosen by a hash of the file
name, is the calibration split: never scored, used only by `--calibrate` to set
the gate's bars (the bar that keeps 99% of them; no recommendation below 30).

**Run of 10 Oct 2026: Gemma 4 8B (Q4_K_M) through Ollama, temperature 0.** No
labelled photos of real machines exist yet, so the set is what was on hand:

- 8 normal photos of 2 rigs: the XJTU-SY authors' photo of their test bed, six
  grey frames of the two synthetic Lens videos made from that same photo, and the
  330 x 245 px photo in the IMS readme. Labelled normal by us: nothing wrong is
  visible in them.
- 1 damage photo: the XJTU-SY authors' photo of a bearing whose outer ring broke,
  cropped from their figure of failed bearings without its caption, labelled
  crack. Their other three panels are left out: two show wear, which is not on
  the checklist, and in the third (a broken cage) we cannot see the break.

The hash split held out 2 normal photos; 7 were scored (6 normal, 1 crack) plus
one normal pair with the normal photo beside it. Results:

- **False alarms on normal photos: 0 of 7 looks** (6 without a reference, 1 with
  it). With zero events in 7, the false-alarm rate could still be as high as about
  40% (95% bound, 3/n), and 7 looks of 2 rigs are not independent. It rules out
  only a model that alarms on most normal photos. Nothing was reported present,
  so the second look had nothing to check.
- On the small IMS photo the model answered "cannot see" for 5 of 7 items
  rather than guessing.
- **The damage photo was turned back by the quality gate as blurred (sharpness
  91, bar 100) although it is in focus**: most of its frame is plain white
  background, which lowers the whole-frame variance of the Laplacian. A false
  retake on 1 of 1 damage photos, from the provisional bar. The bar is not moved
  to pass it; the fix is the calibration split (30 photos or more) or a sharpness
  measured only where the photo has detail, and either needs photos to justify it.
- Diagnostic, with the gate bypassed, not a score: Gemma 4 answered crack
  "absent" on that photo and reported low-severity corrosion on the bearing
  body, which the cropped second look confirmed. On the only real damage photo
  the local model missed a plainly broken ring, as it missed the crack with the
  open question before the checklist (docs/FORECAST.md).
- 25 to 27 s per first look on this laptop.

What this means: the pipeline runs end to end and is cautious on normal photos;
it says nothing about accuracy on real machines, and the 8B local model is not
good enough at seeing a crack. Gemini 3 Flash with Agentic Vision is the next
run (below). The report and every answer are in `data/lens_eval/` (not committed).

## Video for the motion check: none public, and what would do

No public video could score the motion check (10 Oct 2026; table above).
Phys-AD's clips are 1 to 4 s at 60 fps of toys and parts with no shaft speed or
shaft-fault label; SURVISHNO 2019 is one fan at varying speed; SURVISHNO 2023 is
one bearing filmed at 2,000 fps at varying speed. So no loader or score was
written for the motion check, and it has no measured accuracy.

The video that would score it, recorded on a rig where the fault is induced and
known:

- **Faults:** healthy; imbalance at three or more added masses; parallel and
  angular misalignment at three or more offsets; looseness by slackened foot
  bolts. Each on the same machine, so a scan marked normal exists for the
  comparison with a normal scan.
- **Phones:** at least two (one iPhone, one Android), each in its own camera app at
  240 fps Slo-mo and at 30 or 60 fps, 1080p or better, sound on; at least 10 s
  per clip (0.1 Hz resolution).
- **Speeds:** at least three, chosen so 1x falls both below and above half the
  frame rate (600 to 3,000 rpm covers both at 30 and 60 fps), to test the
  aliasing logic.
- **View:** side-on to the shaft, housing in the middle, a textured wall or floor
  in frame for shake removal; phone resting on a support at about 1 m, plus a
  handheld take of each.
- **Truth recorded alongside:** a once-per-revolution optical tachometer and a
  radial accelerometer on the bearing housing (5 kHz or more), synchronised to the
  video by a visible and audible marker (a clap or a flash).
- **Count:** 30 clips or more per fault and phone, so no row rests on fewer than 30.
- **Licence:** CC BY 4.0, with the frame times and the metadata above.

## Magnified clip (optional): not built

A motion-magnified clip would let a viewer see the wobble, for display only.
It is not built, for a reason outside the code: the methods are patented. MIT's
licensing office lists US 9,811,901, 10,007,986 and 10,217,218, "linear-based
eulerian motion modulation", all granted and offered for non-exclusive licence
(tlo.mit.edu, "Eulerian Video Magnification for Revealing Subtle Changes in the
World", read 10 Oct 2026). Google Patents also lists US 9,324,005
"Complex-valued phase-based eulerian motion modulation" and US 9,805,475
"Eulerian motion modulation" (titles only; status not checked). Whether a
public demo needs a licence is a team decision, not a coding one. The shake map
already shows where the machine moves, from the same measurement, without it.

## To run once Gemini is available

Written, never run (no Google Cloud access as of 10 Oct 2026):

1. `ticket.camera.GeminiInspector`: Gemini 3 Flash (`gemini-3-flash-preview`)
   with code execution. Check that one request with both images, code execution
   and the JSON schema is accepted; if not, that the two-step path works; record
   how many code steps (`CameraLook.zooms`) a look takes and how long it runs.
2. Score it: `GOOGLE_API_KEY=… uv run python scripts/photo_eval.py`, then again
   with `GEMINI_AGENTIC_VISION=0`, beside the Gemma 4 run, on the same photos.
   The difference is what Agentic Vision adds on our photos (Google's claim is
   5 to 10% on its benchmarks). Temperature stays at 1.0, so run each twice and
   report both.
3. `lens.look.identify` on Gemini Robotics-ER 2 (`GEMINI_LENS_MODEL`): the box and
   the nameplate reading, against the Gemma 4 results above.
4. A labelled photo set of real machines is what makes any of these numbers mean
   something; until it exists, the scores are on the stand-ins listed here.
