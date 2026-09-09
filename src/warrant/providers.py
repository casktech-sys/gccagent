"""
Model-agnostic provider layer + residency-aware routing policy.

ARCHITECTURAL CLAIM (ADR-003):
Provider selection is a *policy* decision driven by task class and tenant
residency, not a hardcoded client. Routing is refused — not silently
downgraded — when no provider satisfies the tenant's jurisdiction.

The MockProvider is deterministic and requires no API key, so the whole system
is runnable and testable offline. That is a governance property, not a
convenience: tests must not depend on a probabilistic external service.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal, Optional, Protocol


class TaskClass:
    NEGOTIATION = "negotiation"     # sensitive: drafts binding-ish language
    SUMMARY = "summary"             # low sensitivity
    CLASSIFY = "classify"           # low sensitivity, high volume


@dataclass
class ProviderSpec:
    name: str
    tier: Literal["frontier", "cost_efficient", "local"]
    regions: list[str] = field(default_factory=list)
    model: str = ""


class Provider(Protocol):
    spec: ProviderSpec
    def draft(self, system: str, user: str) -> str: ...


# --------------------------------------------------------------------------


class MockProvider:
    """
    Deterministic stand-in. Produces narrative prose only — it never produces
    the structured offer, which is computed by agent policy. That separation is
    the point: model output is decorative, not decisive.
    """
    spec = ProviderSpec("mock", "local", ["me-central", "eu-west", "us-east"], "mock-1")

    def draft(self, system: str, user: str) -> str:
        role = "seller" if "seller" in system.lower() else "buyer"
        if "request_quote" in user:
            return "Requesting a quote for the scope described."
        if "quote" in user and role == "seller":
            return "Pleased to quote for this engagement; pricing reflects our standard rate card."
        if "counter" in user:
            return ("Thanks for the proposal. We can move on price, but the payment "
                    "terms need to stay within our standard arrangement.")
        if "accept" in user:
            return "Agreed. Confirming on the terms as stated."
        return "Acknowledged."


class AnthropicProvider:
    spec = ProviderSpec("anthropic", "frontier", ["us-east", "eu-west"], "claude-sonnet-4-6")

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("ANTHROPIC_API_KEY")

    def draft(self, system: str, user: str) -> str:
        import urllib.request, json
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps({
                "model": self.spec.model, "max_tokens": 300, "system": system,
                "messages": [{"role": "user", "content": user}],
            }).encode(),
            headers={"content-type": "application/json",
                     "x-api-key": self.api_key or "",
                     "anthropic-version": "2023-06-01"},
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
        return "".join(b.get("text", "") for b in data.get("content", []))


class OpenAICompatProvider:
    """
    Covers OpenAI and the OpenAI-compatible endpoints used by most
    cost-efficient models (DeepSeek, Qwen, GLM, Mistral, self-hosted vLLM).
    One adapter, many providers.
    """
    def __init__(self, name: str, base_url: str, model: str,
                 tier: str = "cost_efficient", regions: Optional[list[str]] = None,
                 api_key_env: str = "OPENAI_API_KEY"):
        self.spec = ProviderSpec(name, tier, regions or ["us-east"], model)  # type: ignore[arg-type]
        self.base_url = base_url.rstrip("/")
        self.api_key = os.getenv(api_key_env)

    def draft(self, system: str, user: str) -> str:
        import urllib.request, json
        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps({
                "model": self.spec.model, "max_tokens": 300,
                "messages": [{"role": "system", "content": system},
                             {"role": "user", "content": user}],
            }).encode(),
            headers={"content-type": "application/json",
                     "authorization": f"Bearer {self.api_key or ''}"},
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
        return data["choices"][0]["message"]["content"]


# --------------------------------------------------------------------------


class NoCompliantProviderError(RuntimeError):
    """Raised when residency policy cannot be satisfied. Never downgrade silently."""


class Router:
    """
    Selection order:
      1. filter to providers whose regions intersect the tenant's allowed regions
         (unless the tenant permits cross-border inference)
      2. sensitive task classes prefer frontier tier
      3. everything else prefers cost_efficient
    """

    def __init__(self, providers: list[Provider]):
        self.providers = providers
        self.decisions: list[dict] = []

    def select(self, task_class: str, tenant) -> Provider:
        if tenant.allow_cross_border_inference:
            pool = list(self.providers)
        else:
            pool = [p for p in self.providers
                    if set(p.spec.regions) & set(tenant.allowed_inference_regions)]

        if not pool:
            raise NoCompliantProviderError(
                f"no provider offers inference in {tenant.allowed_inference_regions} "
                f"for jurisdiction {tenant.jurisdiction.value}; "
                f"cross-border inference is disabled for this tenant"
            )

        prefer = "frontier" if task_class == TaskClass.NEGOTIATION else "cost_efficient"
        ranked = sorted(pool, key=lambda p: (p.spec.tier != prefer, p.spec.name))
        chosen = ranked[0]
        self.decisions.append({
            "task_class": task_class,
            "tenant": tenant.tenant_id,
            "jurisdiction": tenant.jurisdiction.value,
            "preferred_tier": prefer,
            "eligible": [p.spec.name for p in pool],
            "chosen": chosen.spec.name,
        })
        return chosen


def default_router(offline: bool = True) -> Router:
    if offline:
        return Router([MockProvider()])
    return Router([
        MockProvider(),
        AnthropicProvider(),
        OpenAICompatProvider("deepseek", "https://api.deepseek.com/v1",
                             "deepseek-chat", api_key_env="DEEPSEEK_API_KEY"),
    ])
