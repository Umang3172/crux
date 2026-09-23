.PHONY: setup test lint fmt demo serve deploy clean

PY := uv run

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

serve:
	$(PY) hypengine serve --reload

# Cloud Run. Set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_REGION first.
deploy:
	gcloud run deploy hypothesis-engine \
		--source . \
		--region $${GOOGLE_CLOUD_REGION:-asia-south1} \
		--allow-unauthenticated \
		--set-env-vars GEMINI_MODEL=$${GEMINI_MODEL:-gemini-3.1-pro}

clean:
	rm -rf .pytest_cache .ruff_cache **/__pycache__ dist build
