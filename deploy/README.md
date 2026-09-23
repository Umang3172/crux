# deploy/

What the container actually runs, plus the one-time Google Cloud wiring that
`docs/DEPLOY.md` and `.github/workflows/deploy.yml` assume.

| File | What it is |
|---|---|
| `server.py` | The ASGI app the image runs: `api/app.py` with the built UI mounted on the same origin, plus `POST /spectrum` for the measured-against-simulated plot |
| `healthcheck.py` | The image's `HEALTHCHECK` probe — no curl in a slim image, and inline Python in a Dockerfile is three levels of quoting |

Neither file decides anything. `server.py` mounts static files and serialises two
spectra from the same deterministic functions the investigation uses; both blocks
are marked in the source and should be deleted the day `api/app.py` grows them.

```bash
uvicorn deploy.server:app          # UI + API on one port (make serve-app)
uvicorn hypothesis_engine.api.app:app   # API alone (make serve)
```

---

## Workload Identity Federation, once

`.github/workflows/deploy.yml` deploys on push to main **without a service
account key in the repository**. GitHub mints a short-lived OIDC token per run
and Google trusts it because of which repository it came from. A long-lived JSON
key would do the same job and would also be a credential that leaks the moment
the repo goes public before the deadline (ADR-0006), so: no keys.

Run this once, as a project owner, after the §1 block in `docs/DEPLOY.md`:

```bash
export PROJECT_ID="your-project-id"
export GITHUB_REPO="MechNova/hypothesis-engine"   # owner/name, exactly
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
DEPLOYER="hypothesis-deployer@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam workload-identity-pools create github \
  --project="$PROJECT_ID" --location=global \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc github \
  --project="$PROJECT_ID" --location=global \
  --workload-identity-pool=github \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository=='${GITHUB_REPO}'"

# Let workflows from that one repository act as the deployer, and nothing else.
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" \
  --project="$PROJECT_ID" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${GITHUB_REPO}"

echo
echo "GCP_WORKLOAD_IDENTITY_PROVIDER ="
echo "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/providers/github"
echo "GCP_SERVICE_ACCOUNT = ${DEPLOYER}"
```

> **The `--attribute-condition` is load-bearing.** Without it, a workflow in *any*
> GitHub repository anywhere can present a token and impersonate the deployer.
> This is the single most common way a Workload Identity setup is left wide open.

Then add the printed values as repository secrets (Settings → Secrets and
variables → Actions):

| Secret | Value |
|---|---|
| `GCP_PROJECT_ID` | your project id |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | the `projects/…/providers/github` line printed above |
| `GCP_SERVICE_ACCOUNT` | `hypothesis-deployer@<project>.iam.gserviceaccount.com` |
| `GCP_REGION` | optional; `asia-south1` if unset |

Until all three of the first are present the workflow reports "Deploy skipped"
and passes. Deploy by hand with `make deploy` in the meantime.

### Undoing it

```bash
gcloud iam workload-identity-pools providers delete github \
  --location=global --workload-identity-pool=github
gcloud iam workload-identity-pools delete github --location=global
```
