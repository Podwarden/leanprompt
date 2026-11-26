"""The leanprompt usage logger for Python apps.

One JSON object per line (``leanprompt/usage/1``). It writes ids, counts and flags,
never prompt or completion text, and never raises into the caller's request path.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from datetime import datetime, timezone
from typing import Any, Sequence

from kvsig import SUPPORTED, Key, canonicalize, ids
from kvsig.jsontext import dump

__all__ = ["Logger", "usage_from", "finish_from", "params_hash", "node_chars", "parse_usage_log"]

_FINISH = {
    "length": "length",
    "max_tokens": "length",
    "max_output_tokens": "length",
    "tool": "tool",
    "tool_calls": "tool",
    "tool_use": "tool",
    "function_call": "tool",
    "error": "error",
}


def finish_from(finish: str | None) -> str:
    """Provider finish reasons mapped onto stop|length|tool|error; unknown reasons count as stop."""
    return _FINISH.get(finish or "", "stop")


def _num(x: Any) -> int | float:
    return x if isinstance(x, (int, float)) and not isinstance(x, bool) and x >= 0 else 0


_USAGE_KEYS = (
    "prompt_tokens", "completion_tokens", "input_tokens", "output_tokens",
    "cache_read_input_tokens", "cache_creation_input_tokens",
    "prompt_tokens_details", "input_tokens_details", "cached_tokens", "cache_write_tokens",
    "usageMetadata", "promptTokenCount", "cachedContentTokenCount", "candidatesTokenCount",
    "prompt_token_count", "cached_content_token_count", "candidates_token_count",
)


def _as_dict(x: Any, depth: int = 0) -> dict[str, Any]:
    """A usage value as a dict: a dict as is, an SDK (pydantic) object through model_dump(),
    anything else through attribute access on the known usage keys."""
    if isinstance(x, dict):
        return x
    if x is None or depth > 2:
        return {}
    dump_fn = getattr(x, "model_dump", None)
    if callable(dump_fn):
        try:
            d = dump_fn()
            if isinstance(d, dict):
                return d
        except Exception:  # noqa: BLE001 -- fall back to attributes
            pass
    out: dict[str, Any] = {}
    for k in _USAGE_KEYS:
        v = getattr(x, k, None)
        if v is None:
            continue
        out[k] = v if isinstance(v, (int, float)) else _as_dict(v, depth + 1)
    return out


def usage_from(provider: str, usage: Any) -> dict[str, int | float]:
    """Token counts from a provider's usage object (see cli/src/log/record.ts).

    ``usage`` may be a dict or an SDK object (the OpenAI and Anthropic SDKs return pydantic
    models; google-genai's ``usage_metadata`` uses snake_case keys)."""
    try:
        u = _as_dict(usage)
    except Exception:  # noqa: BLE001 -- unreadable usage counts as 0
        u = {}
    if provider == "anthropic" or "cache_read_input_tokens" in u or "cache_creation_input_tokens" in u:
        read = _num(u.get("cache_read_input_tokens"))
        write = _num(u.get("cache_creation_input_tokens"))
        return {
            "prompt_tokens": _num(u.get("input_tokens")) + read + write,
            "cached_tokens": read,
            "cache_write_tokens": write,
            "output_tokens": _num(u.get("output_tokens")),
        }
    if "prompt_token_count" in u or "candidates_token_count" in u:
        return {
            "prompt_tokens": _num(u.get("prompt_token_count")),
            "cached_tokens": _num(u.get("cached_content_token_count")),
            "cache_write_tokens": 0,
            "output_tokens": _num(u.get("candidates_token_count")),
        }
    if isinstance(u.get("usageMetadata"), dict) or "promptTokenCount" in u:
        m = u["usageMetadata"] if isinstance(u.get("usageMetadata"), dict) else u
        return {
            "prompt_tokens": _num(m.get("promptTokenCount")),
            "cached_tokens": _num(m.get("cachedContentTokenCount")),
            "cache_write_tokens": 0,
            "output_tokens": _num(m.get("candidatesTokenCount")),
        }
    details = u.get("prompt_tokens_details")
    if not isinstance(details, dict):
        details = u.get("input_tokens_details")
    if not isinstance(details, dict):
        details = {}
    prompt = u.get("prompt_tokens")
    if prompt is None:
        prompt = u.get("input_tokens")
    out = u.get("completion_tokens")
    if out is None:
        out = u.get("output_tokens")
    return {
        "prompt_tokens": _num(prompt),
        "cached_tokens": _num(details.get("cached_tokens")),
        "cache_write_tokens": _num(details.get("cache_write_tokens")),
        "output_tokens": _num(out),
    }


def params_hash(secret: bytes, params: dict[str, Any] | None) -> str:
    """HMAC-SHA256 over the canonical JSON of the params (keys sorted), keyed by the kvsig key; first 16 hex."""
    text = dump(params or {}, sort=True)
    return hmac.new(secret, text.encode("utf-8"), hashlib.sha256).hexdigest()[:16]


def node_chars(canon: Any) -> list[int]:
    """Cumulative code points of the canonical JSON of the head, the tools and body messages 0..i."""
    total = sum(len(dump(m)) for m in canon.head) + sum(len(dump(t)) for t in canon.tools)
    out: list[int] = []
    for m in canon.messages:
        total += len(dump(m))
        out.append(total)
    return out


def _identify(key: Key, dialect: str, body: Any) -> tuple[dict[str, Any], list[int]] | None:
    if dialect not in SUPPORTED:
        return None
    if isinstance(body, (str, bytes)):
        body = json.loads(body)
    canon = canonicalize(body, dialect)  # type: ignore[arg-type]
    if canon is None or canon.stateful:
        return None
    i = ids(canon, key)
    return {"conv": i.conv, "head": i.head, "nodes": list(i.nodes)}, node_chars(canon)


class Logger:
    """``Logger(path, key_bytes, provider, model).log(dialect, body, usage, ...)``.

    ``key_bytes`` is the 32-byte kvsig key or a ``kvsig.Key``. Raw bytes are wrapped as epoch 1,
    the same convention as the TypeScript logger, so one key gives the same ids in both
    languages. Every kvsig id starts with the epoch byte: pass a Key with another epoch only
    if every logger of the app does.
    """

    def __init__(self, path: str | os.PathLike[str], key_bytes: bytes | Key, provider: str, model: str) -> None:
        self.path = os.fspath(path)
        self.key = key_bytes if isinstance(key_bytes, Key) else Key(1, bytes(key_bytes))
        self.provider = provider
        self.model = model
        self._next = self._existing_records()

    def _existing_records(self) -> int:
        try:
            with open(self.path, encoding="utf-8") as f:
                return len(parse_usage_log(f.read())[0])
        except Exception:  # noqa: BLE001 -- missing or unreadable file: start at 0
            return 0

    def log(
        self,
        dialect: str,
        body: Any,
        usage: Any,
        *,
        params: dict[str, Any] | None = None,
        breakpoints: Sequence[int] = (),
        finish: str | None = None,
        retry_of: int | None = None,
        parse_failed: bool = False,
    ) -> int | None:
        """Appends one record; returns its 0-based index among the valid records of the file
        (the value for a later ``retry_of``), or None when nothing was written."""
        try:
            try:
                who = _identify(self.key, dialect, body)
            except Exception:  # noqa: BLE001 -- logging must never break the call path
                who = None
            try:
                phash = params_hash(self.key.secret, params)
            except Exception:  # noqa: BLE001
                phash = ""
            flags: dict[str, Any] = {}
            if retry_of is not None:
                flags["retry_of"] = retry_of
            if parse_failed:
                flags["parse_failed"] = True
            record = {
                "v": 1,
                "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                "provider": self.provider,
                "model": self.model,
                "dialect": dialect,
                "ids": who[0] if who else None,
                "node_chars": who[1] if who else None,
                "breakpoints": [n for n in breakpoints if isinstance(n, int) and not isinstance(n, bool)],
                "params": phash,
                **usage_from(self.provider, usage),
                "finish": finish_from(finish),
                "flags": flags,
            }
            parent = os.path.dirname(self.path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, separators=(",", ":"), ensure_ascii=False) + "\n")
            index = self._next
            self._next += 1
            return index
        except Exception:  # noqa: BLE001
            return None


def parse_usage_log(text: str) -> tuple[list[dict[str, Any]], int]:
    """(records, bad): malformed or non-record lines are skipped and counted; blank lines ignored."""
    records: list[dict[str, Any]] = []
    bad = 0
    for line in text.split("\n"):
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except ValueError:
            bad += 1
            continue
        ok = (
            isinstance(r, dict)
            and r.get("v") == 1
            and isinstance(r.get("provider"), str)
            and isinstance(r.get("params"), str)
            and isinstance(r.get("prompt_tokens"), (int, float))
            and (r.get("ids") is None or isinstance(r["ids"], dict))
        )
        if ok:
            records.append(r)
        else:
            bad += 1
    return records, bad
