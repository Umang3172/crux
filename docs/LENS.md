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
