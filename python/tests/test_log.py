import json
from pathlib import Path

import pytest
from kvsig import TEST_KEY

from leanprompt_cli import Logger
from leanprompt_cli.log import params_hash, parse_usage_log, usage_from

FIXTURES = Path(__file__).resolve().parents[2] / "cli" / "test" / "fixtures" / "bodies"


def fx(name):
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


@pytest.fixture
def setup(tmp_path):
    path = tmp_path / ".leanprompt" / "usage.jsonl"
    logger = Logger(path, TEST_KEY, "openai", "gpt-x")

    def read():
        return parse_usage_log(path.read_text(encoding="utf-8"))[0]

    return path, logger, read


def test_openai_chat_nodes_and_increasing_chars(setup):
    _, logger, read = setup
    body = fx("openai-chat")
    logger.log(
        "openai.chat",
        body,
        {"prompt_tokens": 50, "completion_tokens": 5, "prompt_tokens_details": {"cached_tokens": 20}},
        finish="stop",
    )
    (r,) = read()
    assert len(r["ids"]["nodes"]) == len([m for m in body["messages"] if m["role"] != "system"])
    nc = r["node_chars"]
    assert len(nc) == len(r["ids"]["nodes"])
    assert all(b > a for a, b in zip(nc, nc[1:]))
    assert (r["prompt_tokens"], r["cached_tokens"], r["output_tokens"], r["finish"], r["flags"]) == (50, 20, 5, "stop", {})


def test_anthropic_usage_sums_counters():
    u = usage_from("anthropic", {"input_tokens": 100, "cache_read_input_tokens": 900, "cache_creation_input_tokens": 0})
    assert u["prompt_tokens"] == 1000 and u["cached_tokens"] == 900
    for provider in ("my-proxy", "openrouter"):
        u = usage_from(provider, {"input_tokens": 100, "cache_read_input_tokens": 900})
        assert u["prompt_tokens"] == 1000 and u["cached_tokens"] == 900
    assert usage_from("openai", None) == {
        "prompt_tokens": 0,
        "cached_tokens": 0,
        "cache_write_tokens": 0,
        "output_tokens": 0,
    }


class _Model:
    """Stands in for an SDK pydantic model: attributes plus model_dump()."""

    def __init__(self, **kw):
        self.__dict__.update(kw)

    def model_dump(self):
        return {k: (v.model_dump() if isinstance(v, _Model) else v) for k, v in self.__dict__.items()}


class _Plain:
    """An SDK object with attributes only (no model_dump)."""

    def __init__(self, **kw):
        self.__dict__.update(kw)


def test_openai_sdk_usage_object():
    usage = _Model(prompt_tokens=2000, completion_tokens=40, total_tokens=2040,
                   prompt_tokens_details=_Model(cached_tokens=1536, audio_tokens=0))
    assert usage_from("openai", usage) == {
        "prompt_tokens": 2000, "cached_tokens": 1536, "cache_write_tokens": 0, "output_tokens": 40,
    }


def test_anthropic_sdk_usage_object():
    usage = _Model(input_tokens=100, cache_read_input_tokens=900, cache_creation_input_tokens=50, output_tokens=7)
    assert usage_from("anthropic", usage) == {
        "prompt_tokens": 1050, "cached_tokens": 900, "cache_write_tokens": 50, "output_tokens": 7,
    }


def test_usage_object_without_model_dump_is_read_by_attribute():
    usage = _Plain(prompt_tokens=300, completion_tokens=3, prompt_tokens_details=_Plain(cached_tokens=256))
    assert usage_from("openai", usage) == {
        "prompt_tokens": 300, "cached_tokens": 256, "cache_write_tokens": 0, "output_tokens": 3,
    }
    usage = _Plain(input_tokens=10, cache_read_input_tokens=90, output_tokens=1)
    assert usage_from("anthropic", usage)["prompt_tokens"] == 100


def test_google_genai_usage_metadata_object():
    usage = _Model(prompt_token_count=5000, cached_content_token_count=4096, candidates_token_count=12)
    assert usage_from("gemini", usage) == {
        "prompt_tokens": 5000, "cached_tokens": 4096, "cache_write_tokens": 0, "output_tokens": 12,
    }


def test_logger_writes_counts_from_an_sdk_object(setup):
    _, logger, read = setup
    logger.log("openai.chat", fx("openai-chat"), _Model(prompt_tokens=50, completion_tokens=5, prompt_tokens_details=_Model(cached_tokens=20)))
    r = read()[-1]
    assert (r["prompt_tokens"], r["cached_tokens"], r["output_tokens"]) == (50, 20, 5)


def test_other_dialect_still_written(setup):
    _, logger, read = setup
    logger.log("other", fx("gemini"), {"prompt_tokens": 3})
    (r,) = read()
    assert r["ids"] is None and r["node_chars"] is None and r["prompt_tokens"] == 3


def test_unreadable_body_never_raises(setup):
    _, logger, read = setup
    logger.log("openai.chat", "{not json", {})
    logger.log("openai.chat", None, {})
    assert [r["ids"] for r in read()] == [None, None]


def test_never_writes_prompt_text(setup):
    path, logger, _ = setup
    logger.log("openai.chat", fx("openai-chat"), {}, params={"note": "x"})
    logger.log("other", fx("gemini"), {})
    text = path.read_text(encoding="utf-8")
    assert "SECRET" not in text and "Paris" not in text


def test_unwritable_path_never_raises():
    Logger("/dev/null/x/usage.jsonl", TEST_KEY, "openai", "m").log("other", {}, {})


def test_params_hash(setup):
    _, logger, read = setup
    logger.log("other", {}, {}, params={"temperature": 0.2, "top_p": 1})
    logger.log("other", {}, {}, params={"top_p": 1, "temperature": 0.2})
    logger.log("other", {}, {}, params={"temperature": 0.7, "top_p": 1})
    a, b, c = (r["params"] for r in read())
    assert a == b and a != c and len(a) == 16


def test_flags_finish_breakpoints(setup):
    _, logger, read = setup
    logger.log("other", {}, {}, breakpoints=[2, 5], finish="tool_use", retry_of=3, parse_failed=True)
    (r,) = read()
    assert r["finish"] == "tool" and r["breakpoints"] == [2, 5] and r["flags"] == {"retry_of": 3, "parse_failed": True}


def test_parse_usage_log_counts_bad_lines(setup):
    path, logger, _ = setup
    logger.log("other", {}, {})
    records, bad = parse_usage_log(path.read_text(encoding="utf-8") + '{truncated\n{"v":2}\n\n')
    assert len(records) == 1 and bad == 2


def test_cross_language_agreement(setup):
    """The same fixture is asserted in cli/test/log/logger.test.ts."""
    _, logger, read = setup
    x = fx("cross")
    logger.log(x["dialect"], x["body"], {}, params=x["params"])
    (r,) = read()
    assert r["ids"] == x["expected"]["ids"]
    assert r["node_chars"] == x["expected"]["node_chars"]
    assert r["params"] == x["expected"]["params"] == params_hash(TEST_KEY.secret, x["params"])


def test_raw_key_bytes_are_epoch_1_and_match_ts_ids(tmp_path):
    """Pinned to the same expected_raw_key ids as cli/test/log/logger.test.ts."""
    x = fx("cross")
    path = tmp_path / "usage.jsonl"
    Logger(path, bytes(range(32)), "openai", "m").log(x["dialect"], x["body"], {}, params=x["params"])
    (r,), _ = parse_usage_log(path.read_text(encoding="utf-8"))
    assert r["ids"] == x["expected_raw_key"]["ids"]
    assert r["ids"]["head"].startswith("01")
    assert r["params"] == x["expected"]["params"]


def test_log_returns_index_continuing_existing_file(setup):
    path, logger, _ = setup
    assert logger.log("other", {}, {}) == 0
    assert logger.log("other", {}, {}, retry_of=0) == 1
    with open(path, "a", encoding="utf-8") as f:
        f.write("{truncated\n")
    again = Logger(path, TEST_KEY, "openai", "gpt-x")
    assert again.log("other", {}, {}) == 2


def test_log_returns_none_when_unwritable():
    assert Logger("/dev/null/x/usage.jsonl", TEST_KEY, "openai", "m").log("other", {}, {}) is None
