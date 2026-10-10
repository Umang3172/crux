"""A local model through Ollama (for example Gemma 4): the stand-in until Gemini.

Nothing leaves the machine: Ollama serves the model on localhost. It is used
only when `OLLAMA_MODEL` is set (for example `gemma4:latest`), so tests and CI
never reach it by accident, and when the server answers; otherwise every caller
falls back to its offline path. The same rule binds it as Gemini: it writes and
looks, it never moves a belief.

    ollama pull gemma4 && OLLAMA_MODEL=gemma4:latest uv run hypengine serve
"""

from __future__ import annotations

import base64
import json
import os
import urllib.request

HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
TIMEOUT_S = float(os.getenv("OLLAMA_TIMEOUT_S", "180"))


def model() -> str | None:
    return os.getenv("OLLAMA_MODEL") or None


def available(timeout_s: float = 1.0) -> bool:
    """True when OLLAMA_MODEL is set and the server lists that model."""
    name = model()
    if not name:
        return False
    try:
        with urllib.request.urlopen(f"{HOST}/api/tags", timeout=timeout_s) as r:
            tags = json.load(r)
    except (OSError, ValueError):
        return False
    return any(m.get("name") == name or m.get("model") == name for m in tags.get("models", []))


def chat(
    prompt: str,
    *,
    schema: dict | None = None,
    images: list[bytes] | None = None,
    system: str | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
    timeout_s: float | None = None,
) -> str:
    """One non-streaming chat turn; returns the reply text (JSON text when `schema` is given).

    `temperature` 0 makes a reading repeatable (the same photo gives the same box).
    `max_tokens` and `timeout_s` bound a reply: a small model held to a schema
    can go on filling it until it is stopped.
    """
    name = model()
    if not name:
        raise RuntimeError("OLLAMA_MODEL is not set")
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    user: dict = {"role": "user", "content": prompt}
    if images:
        user["images"] = [base64.b64encode(i).decode() for i in images]
    messages.append(user)
    body: dict = {"model": name, "messages": messages, "stream": False, "think": False}
    if schema is not None:
        body["format"] = schema
    options: dict = {}
    if temperature is not None:
        options["temperature"] = temperature
    if max_tokens is not None:
        options["num_predict"] = max_tokens
    if options:
        body["options"] = options
    req = urllib.request.Request(
        f"{HOST}/api/chat",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout_s or TIMEOUT_S) as r:
        return json.load(r)["message"]["content"]
