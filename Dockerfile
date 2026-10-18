# The image behind the deployed link: the UI and the API on one origin.
#
# Three stages. The UI is built by node and thrown away; the dependencies are
# resolved from uv.lock and thrown away; the runtime carries a virtualenv, a
# static bundle and nothing else. No compiler, no npm, no lockfile resolution at
# deploy time — the same commit produces the same image.

# --------------------------------------------------------------- 1 · the UI
FROM node:22-alpine AS web

WORKDIR /web
# package-lock.json is committed, so `npm ci` installs exactly what the team
# tested. `npm install` here would quietly drift.
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY web/ ./
RUN npm run build

# ------------------------------------------------------- 2 · the virtualenv
FROM python:3.11-slim-bookworm AS builder

# uv is the installer only; uv.lock is what pins the dependency set, so the
# range here cannot affect what lands in the image. Bump it deliberately.
RUN pip install --no-cache-dir "uv>=0.12,<0.13"

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON=python3.11 \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Every tab of the UI has to work from the deployed link, so the image carries
# each optional group a tab needs: `llm` for the investigator, `lens` to read a
# phone video, `forecast` for the learned time-left model.
ARG EXTRAS="--extra llm --extra lens --extra forecast"

# Dependencies first, so editing src/ does not re-resolve or re-download them.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project ${EXTRAS}

# Then the project itself, installed as a built wheel rather than an editable
# link so the runtime stage needs no source tree.
COPY README.md ./
COPY src ./src
RUN uv sync --frozen --no-dev --no-editable ${EXTRAS}

# ------------------------------------------------------------- 3 · runtime
FROM python:3.11-slim-bookworm AS runtime

# Cloud Run gives one vCPU and scales to zero, so every cold start pays the
# numpy/scipy import. Two things keep that cheap:
#   * the venv arrives with bytecode already compiled (UV_COMPILE_BYTECODE),
#   * BLAS is pinned to a single thread. Left alone it sizes its pool from the
#     host's core count, not the container's share, and spends the first second
#     of every cold start creating threads that then contend for one CPU.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    PATH="/app/.venv/bin:$PATH" \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1 \
    MALLOC_ARENA_MAX=2 \
    WEB_DIST=/app/web/dist \
    CRUX_DATA=/app/data \
    PORT=8080

RUN useradd --system --create-home --uid 10001 app

WORKDIR /app
# What the app saves while it runs (lens scans, lessons) goes under CRUX_DATA.
# No dataset ships in the image; on Cloud Run this folder is memory and is
# gone with the instance.
RUN mkdir -p /app/data && chown app /app/data
COPY --from=builder /app/.venv /app/.venv
COPY --from=web /web/dist /app/web/dist
COPY deploy/server.py deploy/healthcheck.py /app/deploy/

USER app
EXPOSE 8080

# Cloud Run runs its own probes and ignores this one; it is here so the image
# states its own contract for local runs and anything else that reads it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD ["python", "/app/deploy/healthcheck.py"]

# One worker: the box has one vCPU, and /replay is CPU-bound, so a second worker
# would halve the memory available and win nothing. Scale with instances, which
# is what Cloud Run is good at. `exec` so uvicorn is PID 1 and gets SIGTERM.
CMD ["sh", "-c", "exec uvicorn deploy.server:app --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers --forwarded-allow-ips='*' --timeout-keep-alive 65"]
