# stable_head_template.py

Save the code below as a file in the project's tests (the skill says which name), after the user says yes.

```python
"""The helper for a CI test that fails when the stable head of your requests changes.

Install: pip install kvsig==0.1.0 pytest   (kvsig/1 and loose/1 ids; never assert on loose/2).
Copy this file into your tests under a name of your own (for example tests/stable_head.py) and
write the test beside it (for example tests/test_stable_head.py):

    from stable_head import assert_stable_head

    def test_head_does_not_change_from_one_day_to_the_next():
        assert_stable_head(build, ["2026-11-01", "2026-11-02"], {"sys": True, "tools": True})

`build` is the function your app uses to build a request, returning (dialect, body), and the
inputs are two values that must NOT change the head (two dates, two users, two working directories).
"""
from kvsig import SUPPORTED, TEST_KEY, canonicalize, ids


def _ids_of(dialect, body):
    canon = canonicalize(body, dialect) if dialect in SUPPORTED else None
    if canon is None:
        raise AssertionError(f"kvsig could not identify the request (dialect {dialect}); is it a supported dialect, under 2 MiB, valid JSON?")
    return ids(canon, TEST_KEY)


def assert_stable_head(build, inputs, expect):
    a, b = (_ids_of(*build(x)) for x in inputs)
    bad = []
    if expect.get("sys") and a.sys != b.sys:
        bad.append("`sys` differs, `loose_sys` equal: the system prompt changed only in noise (a date line, a reminder, whitespace)"
                   if a.loose_sys == b.loose_sys else "`sys` differs, `loose_sys` differs: the system prompt changed in content the loose form does not treat as noise (a labelled date or time, an id, a path, wording)")
    if expect.get("tools") and a.tools != b.tools:
        bad.append("`tools` differs, `loose_tools` equal: the tool list changed only in the member order inside a schema or arguments"
                   if a.loose_tools == b.loose_tools else "`tools` differs, `loose_tools` differs: a tool was added, removed, edited or reordered")
    for i in range(expect.get("nodes_up_to", 0)):
        if a.nodes[i] != b.nodes[i]:
            bad.append(f"`nodes[{i}]` differs: the prompt up to message {i} changed (a history message was rewritten, or the head above changed)")
            break
    if bad:
        raise AssertionError("The stable head changed between the two inputs:\n- " + "\n- ".join(bad))
# leanprompt:generated v0.1.0-dev.12: written by npx leanprompt install; npx leanprompt update replaces local edits
```
