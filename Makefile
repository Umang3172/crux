.PHONY: setup test lint fmt demo serve serve-app web-install web-build web-dev \
        docker-build docker-run deploy url clean

PY := uv run
REGION ?= asia-south1
SERVICE ?= hypothesis-engine
IMAGE ?= hypothesis-engine:local

# Lazily expanded: gcloud is only consulted by the deploy targets, never by a
# plain `make test`.
PROJECT_ID ?= $(shell gcloud config get-value project 2>/dev/null)
DEPLOYER ?= hypothesis-deployer@$(PROJECT_ID).iam.gserviceaccount.com

setup:
	uv venv --python 3.11
	uv pip install -e ".[dev]"
	@echo "Optional model adapters:  uv pip install -e '.[llm,jev]'"

test:
	$(PY) pytest

lint:
	$(PY) ruff check .

fmt:
	$(PY) ruff check --fix .
	$(PY) ruff format .

demo:
	$(PY) hypengine demo --fault outer_race

# The API on its own, no UI. What you want when you are working on the API.
serve:
	$(PY) hypengine serve --reload

# What the container runs: the built UI and the API on one port, including
# /spectrum. Needs `make web-build` first.
serve-app:
	PYTHONPATH=. $(PY) uvicorn deploy.server:app --port 8080 --reload

# ----------------------------------------------------------------------- web
web-install:
	cd web && npm ci

web-build:
	cd web && npm ci && npm run build

web-dev:
	cd web && npm run dev

# --------------------------------------------------------------------- image
docker-build:
	docker build -t $(IMAGE) .

docker-run:
	docker run --rm -p 8080:8080 -e PORT=8080 $(IMAGE)

# -------------------------------------------------------------------- deploy
# Builds the UI, installs from uv.lock, pushes to Artifact Registry and deploys.
# First-time project setup (APIs, registry, IAM, the Gemini secret) is in
# docs/DEPLOY.md and only has to be done once.
deploy:
	gcloud builds submit --config cloudbuild.yaml \
		--substitutions "_REGION=$(REGION)" \
		--service-account "projects/$(PROJECT_ID)/serviceAccounts/$(DEPLOYER)"

# The link for the submission form.
url:
	@gcloud run services describe $(SERVICE) --region $(REGION) \
		--format 'value(status.url)'

clean:
	rm -rf .pytest_cache .ruff_cache **/__pycache__ dist build web/dist
