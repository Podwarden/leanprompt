"""The stable-head template (skills/measure-loop/templates/stable_head_template.py) against small fixture builders."""
import importlib.util
from pathlib import Path

import pytest

PATH = Path(__file__).resolve().parents[2] / "skills" / "measure-loop" / "templates" / "stable_head_template.py"
spec = importlib.util.spec_from_file_location("stable_head_template", PATH)
tpl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tpl)

TOOLS = [
    {"type": "function", "function": {"name": n, "description": n, "parameters": {"type": "object", "properties": {}}}}
    for n in ("search", "fetch", "write")
]


def build_before(i):
    """The system prompt opens with a bare date line; the tools come out in an order that depends on the run."""
    day, run = i
    tools = TOOLS[run:] + TOOLS[:run]
    return "openai.chat", {"tools": tools, "messages": [{"role": "system", "content": f"{day}\nYou are a support assistant."}, {"role": "user", "content": "hi"}]}


def build_after(i):
    """The date rides in the newest user message; the tool order is fixed."""
    day, _run = i
    return "openai.chat", {"tools": TOOLS, "messages": [{"role": "system", "content": "You are a support assistant."}, {"role": "user", "content": f"<environment>{day}</environment>\nhi"}]}


DAYS = [("2026-11-03", 0), ("2026-11-04", 0)]
RUNS = [("2026-11-03", 0), ("2026-11-03", 1)]


def test_before_fails_on_sys_with_the_noise_message():
    with pytest.raises(AssertionError, match="`sys` differs, `loose_sys` equal: the system prompt changed only in noise"):
        tpl.assert_stable_head(build_before, DAYS, {"sys": True})


def test_before_fails_on_tools_when_the_order_changes():
    with pytest.raises(AssertionError, match="`tools` differs, `loose_tools` differs"):
        tpl.assert_stable_head(build_before, RUNS, {"tools": True})


def test_after_passes_on_head_but_not_on_nodes_when_the_date_is_in_the_user_message():
    tpl.assert_stable_head(build_after, DAYS, {"sys": True, "tools": True})
    tpl.assert_stable_head(build_after, RUNS, {"sys": True, "tools": True, "nodes_up_to": 1})
    with pytest.raises(AssertionError, match="`nodes\\[0\\]` differs"):
        tpl.assert_stable_head(build_after, DAYS, {"nodes_up_to": 1})


def test_unidentifiable_request_fails_loudly():
    with pytest.raises(AssertionError, match="could not identify"):
        tpl.assert_stable_head(lambda _x: ("gemini.native", {}), [1, 2], {"sys": True})


def test_template_is_a_helper_no_runner_collects():
    # The template is copied into the user's skill folders; pytest must find no test in it.
    assert not PATH.name.startswith("test_") and not PATH.stem.endswith("_test")
    assert not [n for n in vars(tpl) if n.startswith("test")]


def test_docstring_example_passes():
    def build(_day):
        return "openai.chat", {"messages": [{"role": "system", "content": "You are a support assistant."}, {"role": "user", "content": "Where is my order?"}]}

    tpl.assert_stable_head(build, ["2026-11-01", "2026-11-02"], {"sys": True, "tools": True})
