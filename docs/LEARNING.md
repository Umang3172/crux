# Learning across sites

Each plant runs Crux on its own machines and keeps working offline. It gets
better in three ways, at three speeds:

| What changes | How fast | How it gets there | Who decides |
|---|---|---|---|
| Lessons (knowledge) | at once | an alert bundle from the hub, or a case closed here | no number changes, so they go straight into memory |
| Time-left models | about monthly | a monthly bundle, retrained on every failure the hub holds | a person, after the site's own test |
| The language model | rarely | a newer local model, or a cloud model distilled into it | the team; not automated |

Fast knowledge, slower numbers, slowest model: memory that updates at several
rates echoes the continuum memory of Google's Nested Learning (Google Research
blog, 7 Nov 2025), applied here to a system rather than inside one network.

Code: `src/hypothesis_engine/fleet/`. Nothing in it moves an investigation's
beliefs.

## The lesson memory (`memory.py`, `learn.py`)

Modelled on ReasoningBank (Ouyang et al., arXiv 2509.25140, 2025): after a
case closes, a short lesson is written from what Crux said and what the
technician found. A hit becomes a strategy; a miss becomes a pitfall to avoid,
and misses are kept, not hidden. The model never retrains; the memory grows.
Lessons are recalled by word overlap (tf-idf cosine) within one machine type,
and the repair ticket quotes the most relevant ones (`E8`). A model words a
lesson when one is on (Gemini, else a local model); templates otherwise. Every
lesson keeps the case it came from and who confirmed it.

## Specialist packs (`packs.py`)

One general assistant, one pack per machine type. The language skill
(explaining, writing a ticket, reading a photo) is shared; what differs is the
physics and the data: signals, what counts as normal, the faults that can be
named, the time-left model. A compressor never borrows a bearing's thresholds,
and an update for one type never touches another.

## Hub and site (`hub.py`, `site.py`, `bundle.py`)

Sites send the hub contributions: a lesson and, for a failure, the part's
health trend (derived numbers, never raw recordings). The hub answers with
signed bundles:

- **alert**: the moment a site marks a failure as major, that lesson goes to
  every site, like an antivirus update;
- **monthly**: every lesson so far, and the time-left model retrained on every
  failure held, listing the runs it was trained on.

A site verifies the signature and every file's hash, refuses anything changed
or added, applies alerts to its memory, and stages a monthly bundle. The staged
model is tested against the one in use **on this site's own failures that the
bundle was not trained on**. It can be installed only if it is no worse on both
median error and "early end too late", and only by a named person. Without
such failures the test says so and a person decides. Every installed version is
kept, so a rollback is one step.

Bundles are signed with an HMAC shared by hub and site (`CRUX_HUB_KEY` or
`hub.key`). A production hub would sign with a private key and give sites only
the public one: TBD. On Google Cloud the hub folder becomes a bucket and the
monthly step a scheduled job.

Not built: averaging model updates across sites without pooling their trends
(federated learning, McMahan et al., arXiv 1602.05629), distilling a cloud
model into the local one, and accepting a lasting change in use as a machine's
new normal.

## Try it

```bash
uv run python scripts/fleet_demo.py     # a hub: lessons from the public datasets, an alert, a monthly update trained on XJTU-SY
CRUX_SITE=nasa-ims-rig CRUX_SITE_TABLES=health_ims.csv uv run hypengine serve
```

On the Predictive maintenance tab, "Check for updates" applies the alert and
stages the update. On 6 Oct 2026 the update, trained only on XJTU-SY, was
tested on the four IMS failures: median error 0.45 against 1.76 for the trend
in use, early end too late 17% against 74%. After a repair, "What did you
find?" closes the ticket into a lesson and sends it to the hub.
