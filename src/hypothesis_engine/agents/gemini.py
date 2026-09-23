"""Gemini adapter.

Used for the parts a language model is genuinely good at: explaining the case in
maintenance language, drafting the work order, and (later) proposing hypotheses
outside the built-in catalogue. It never edits beliefs directly — the engine owns
those, and the ledger has to stay traceable.

Install with the `llm` extra:  uv pip install -e ".[llm]"
"""

from __future__ import annotations

import os

SYSTEM = """You are the investigator on a machine-diagnosis case.
You are given: the machine, the measured evidence, the hypotheses with their
posteriors, and the correlations from virtual experiments.
Rules:
- Never invent a number. Quote only values you were given, with their evidence id.
- Prefer the shortest explanation a maintenance engineer would accept.
- If the evidence does not decide the case, say what measurement would.
"""

MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-pro")


class GeminiNarrator:
    name = f"gemini:{MODEL}"

    def __init__(self) -> None:
        from google import genai  # type: ignore

        self._client = genai.Client()

    def explain(self, prompt: str, context: dict) -> str:
        import json

        response = self._client.models.generate_content(
            model=MODEL,
            contents=[
                {"role": "user", "parts": [{"text": SYSTEM}]},
                {
                    "role": "user",
                    "parts": [
                        {
                            "text": f"Task: {prompt}\nCase:\n{json.dumps(context, default=str, indent=2)}"
                        }
                    ],
                },
            ],
        )
        return (response.text or "").strip()
