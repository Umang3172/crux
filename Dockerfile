# Cloud Run image. Small, no build tools in the final layer.
FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src

RUN pip install --upgrade pip && pip install ".[llm,jev]" || pip install "."

# Cloud Run sets PORT; default for local runs.
ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn hypothesis_engine.api.app:app --host 0.0.0.0 --port ${PORT}"]
