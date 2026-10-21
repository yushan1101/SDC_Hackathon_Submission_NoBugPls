"""Per-node usage records: latency, model, provider-reported tokens (measured) and estimated cost."""
import time
from contextlib import contextmanager


def record(node: str, ms: float, model: str = "", input_tokens: int = 0, output_tokens: int = 0,
           measured: bool = True, error: str = "") -> dict:
    from config.settings import get_settings
    s = get_settings()
    cost = (input_tokens * s.llm_usd_per_1m_input + output_tokens * s.llm_usd_per_1m_output) / 1e6
    return {"node": node, "ms": round(ms, 2), "model": model or "deterministic",
            "llm_calls": int(bool(model)), "input_tokens": input_tokens, "output_tokens": output_tokens,
            "tokens_measured": measured, "est_usd": round(cost, 6), "error": error}


@contextmanager
def timer():
    t = time.perf_counter()
    box = {}
    yield box
    box["ms"] = 1000 * (time.perf_counter() - t)


def summarize(usage: list[dict]) -> dict:
    return {"nodes": len(usage), "llm_calls": sum(u["llm_calls"] for u in usage),
            "input_tokens": sum(u["input_tokens"] for u in usage),
            "output_tokens": sum(u["output_tokens"] for u in usage),
            "est_usd": round(sum(u["est_usd"] for u in usage), 6),
            "ms": round(sum(u["ms"] for u in usage), 1)}
