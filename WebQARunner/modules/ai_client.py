"""Azure OpenAI client for scenario step decisions."""

from __future__ import annotations

import json
import re

from openai import AzureOpenAI

_SYSTEM_PROMPT = (
    "You are a web UI test automation agent. "
    "Analyze the page state and decide the next action toward the test goal. "
    "Always respond with valid JSON only — no markdown, no text outside the JSON object."
)


class AzureOpenAIClient:
    def __init__(self, config: dict) -> None:
        self._client = AzureOpenAI(
            azure_endpoint=config["endpoint"],
            api_key=config["api_key"],
            api_version=config.get("api_version", "2024-02-01"),
        )
        self._deployment = config["deployment"]
        self._temperature = config.get("temperature", 0)

    def call(self, prompt: str) -> tuple[dict, dict]:
        """Return (parsed_response, usage_dict)."""
        response = self._client.chat.completions.create(
            model=self._deployment,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=self._temperature,
        )
        content = response.choices[0].message.content or ""
        usage = {
            "input": response.usage.prompt_tokens if response.usage else 0,
            "output": response.usage.completion_tokens if response.usage else 0,
        }
        return _parse_json(content), usage


def _parse_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group())
        raise
