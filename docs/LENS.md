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
`src/hypothesis_engine/lens/`, API `api/lens.py`, screen `web/src/lens/`.

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
Geometry is on file only for bearings in `KNOWN_BEARINGS` (now the 6205); any
other bearing is TBD and the sound is not used. Phone microphones hear little
below about 200 Hz (IEEE 7449545), so the sound speaks mainly to bearings,
while the video speaks to shaft faults: the two split the spectrum.

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

## Known limits (7 Oct 2026)

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
