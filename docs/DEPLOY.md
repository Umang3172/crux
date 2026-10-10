# Deploy

One container, one URL: the investigation UI at `/` and the API beside it
(`/health`, `/tests`, `/investigations`, `/replay`, `/spectrum`, `/docs`). That
URL is the prototype link on the submission form.

Everything below is copy-paste. A teammate with a fresh Google Cloud project and
`gcloud` installed should get to a live link without making a single decision.

> Default region **`asia-south1`** (Mumbai): closest to the team and the rig, and
> it carries Cloud Run, Cloud Build, Artifact Registry and Secret Manager.

---

## 0 · What you need first

- `gcloud` ([install](https://cloud.google.com/sdk/docs/install)), logged in:
  `gcloud auth login`
- A Google Cloud project **with billing enabled**. Cloud Build and Artifact
  Registry both refuse to work without it, with errors that do not say so.
- A Gemini API key from <https://aistudio.google.com/apikey>, if you want live
  narration. **It is optional.** With no key the system runs its offline path and
  every diagnosis is identical — only the prose changes (ADR-0002).

---

## 1 · One-time project setup

Run this block once per project. It is idempotent: re-running it is harmless.

```bash
export PROJECT_ID="your-project-id"        # <- the only thing to edit
export REGION="asia-south1"
gcloud config set project "$PROJECT_ID"

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  compute.googleapis.com \
  iamcredentials.googleapis.com
```

**Artifact Registry**, one repository to hold the image:

```bash
gcloud artifacts repositories create containers \
  --repository-format=docker \
  --location="$REGION" \
  --description="MechNova container images"
```

**A deploy identity.** Fresh projects no longer give Cloud Build broad rights by
default, so the build runs as a service account we create and grant exactly what
it needs. Doing this explicitly is also the difference between a first deploy
that works and twenty minutes of IAM errors.

```bash
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
DEPLOYER="hypothesis-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud iam service-accounts create hypothesis-deployer \
  --display-name="Hypothesis Engine deployer"

for role in roles/run.admin roles/artifactregistry.writer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${DEPLOYER}" --role="$role" --condition=None
done

# Cloud Run services run as $RUNTIME, so the deployer must be allowed to assign it.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME" \
  --member="serviceAccount:${DEPLOYER}" \
  --role=roles/iam.serviceAccountUser
```

**The Gemini key, in Secret Manager** — never as a plain environment variable, so
it is not readable from the Cloud Run console, the service YAML, or a screenshot
of either. Skip this step entirely to deploy the offline path.

```bash
# Paste the key at the prompt; it is not echoed and never reaches your shell history.
read -rs -p "Gemini API key: " GEMINI_KEY && echo
printf '%s' "$GEMINI_KEY" | gcloud secrets create gemini-api-key --data-file=-
unset GEMINI_KEY

# The running service is what reads it.
gcloud secrets add-iam-policy-binding gemini-api-key \
  --member="serviceAccount:${RUNTIME}" \
  --role=roles/secretmanager.secretAccessor
```

> The secret is called `gemini-api-key`, and Cloud Run mounts it as the
> environment variable **`GOOGLE_API_KEY`**, because that is the name
> `agents/factory.py` checks to decide whether Gemini narration is live. Renaming
> either one means changing `_SECRETS` in `cloudbuild.yaml`.

Rotating the key later is one command, no redeploy:

```bash
printf '%s' "NEW_KEY" | gcloud secrets versions add gemini-api-key --data-file=-
```

---

## 2 · Deploy

```bash
make deploy
```

or, without make:

```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions "_REGION=${REGION}" \
  --service-account "projects/${PROJECT_ID}/serviceAccounts/${DEPLOYER}"
```

That builds the UI, resolves Python dependencies from `uv.lock`, pushes the image
to Artifact Registry and deploys it to Cloud Run. Four to seven minutes cold,
about ninety seconds afterwards because the layers cache. The last thing it
prints is the URL.

Deploying **without** a Gemini key:

```bash
gcloud builds submit --config cloudbuild.yaml --substitutions "_SECRETS=,_REGION=${REGION}"
```

---

## 3 · Get the URL back out

This is the line to paste into the submission form:

```bash
gcloud run services describe hypothesis-engine \
  --region "$REGION" --format 'value(status.url)'
```

or `make url`. Then check it is really serving:

```bash
URL="$(gcloud run services describe hypothesis-engine --region "$REGION" --format 'value(status.url)')"

curl -s "$URL/health"
# {"status":"ok","models":{"narrator":"gemini-3.1-pro","gate":"offline-rules"}}

curl -s "$URL/replay" -X POST -H 'content-type: application/json' \
  -d '{"fault":"looseness","severity":0.35}' | head -c 400

open "$URL"     # macOS; xdg-open on Linux
```

`/health` is the honest answer to "is a model actually live?" — it names the
implementation behind each role. Show it once in the demo video (DEMO_SCRIPT.md).

---

## 4 · Before judging

- **Open every tab on the live link.** The image carries each optional group a
  tab needs (`llm`, `lens`, `forecast`), and ships no dataset: the maintenance
  tab shows a synthetic pump life, labelled as one (`data/demo.py`), and what
  the app saves goes under `CRUX_DATA` (`/app/data`), which on Cloud Run is
  memory and is gone with the instance.
- **Check which model the header names.** "Gemini off" means the investigator
  tab is running its offline stand-in: either `_SECRETS` was empty, or the key
  did not mount. If a Gemini call fails at run time (no quota, a model id that
  has been retired) the case is finished by the stand-in and the tab says why,
  so read that line rather than assuming the model answered.

- **`_MIN_INSTANCES=1`** for the judging window, so nobody's first click waits on
  a cold start. Roughly a few dollars a month; set it back to `0` afterwards.

  ```bash
  gcloud run services update hypothesis-engine --region "$REGION" --min-instances 1
  ```

- **Flip the repo public** (ADR-0006) — the submission needs both a live URL and
  a public repo.
- **Check the link from a phone and from a network that is not yours.** The
  service is `--allow-unauthenticated`; confirm that is actually true.

---

## 5 · Running the same image locally

Identical to what Cloud Run runs, which is the point of testing it here first:

```bash
make docker-build
make docker-run          # http://localhost:8080
```

Without Docker, the same app from source:

```bash
make web-build           # once: builds web/dist
make serve-app           # http://localhost:8080, UI and API together
```

`make serve` still runs the API on its own, without the UI, for API work.

---

## 6 · When it goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| `PERMISSION_DENIED` on `builds submit` | The deployer SA is missing a role, or you skipped `--service-account` | Re-run the IAM block in §1 |
| Build fails at `npm ci` | `web/package-lock.json` is out of step with `package.json` | `cd web && npm install`, commit the lockfile |
| Build fails at `uv sync --frozen` | `uv.lock` is out of step with `pyproject.toml` | `uv lock`, commit `uv.lock` |
| Service deploys, URL returns 403 | Org policy blocks unauthenticated invocation | Needs a project admin — see §7 |
| `/health` shows `offline-template` with a key set | The runtime SA cannot read the secret | Re-run the `secretAccessor` binding in §1 |
| First request takes ~10 s | Cold start, importing scipy | Expected at `--min-instances 0`; see §4 |
| UI loads but every panel is empty | The bundle was not built into the image | Confirm the build log ran `npm run build`; check `/health` responds |

Logs:

```bash
gcloud run services logs read hypothesis-engine --region "$REGION" --limit 50
```

---

## 7 · What still needs a person with console access

These cannot be scripted from here, and one of them will bite on the day if
nobody checks it early:

1. **Billing** must be linked to the project. Console → Billing.
2. **`constraints/iam.allowedPolicyMemberDomains`**, the org policy that blocks
   `allUsers`. If your Google Workspace has it on, `--allow-unauthenticated` is
   silently overridden and the judge's link returns 403. Test the URL from a
   logged-out browser the day you first deploy, not the day you submit.
3. **Quota** for Cloud Run in `asia-south1` on a brand-new project is
   occasionally zero until the first successful deploy warms it. If a deploy
   fails on quota, request an increase — it is usually granted in minutes, but it
   is not instant.
4. **The GitHub deploy workflow** (`.github/workflows/deploy.yml`) needs a
   Workload Identity Federation pool created once by a project owner. It stays a
   no-op until then; `deploy/README.md` has the commands.
