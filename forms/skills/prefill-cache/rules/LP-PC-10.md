---
id: LP-PC-10
title: Stable image and attachment placement
skill: prefill-cache
applies_to: [anthropic, openai, gemini, openrouter, vllm, sglang]
saves: prefill
severity: medium
evidence:
  - doc: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
    checked: 2026-11-26
  - doc: https://developers.openai.com/api/docs/guides/prompt-caching
    checked: 2026-11-26
---
## Rule
Put each image, file or document in the message where it first appears and keep it there, with the same bytes or the same reference, for the rest of the session; never move it, re-encode it or re-upload it per call.

## Why
Images and attachments are often the largest part of a prompt, and they are part of the prefix like any text. On Anthropic, adding or removing images invalidates the message blocks ([providers/anthropic.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.2/providers/anthropic.md)); on OpenAI images count toward the prefix that must match ([providers/openai.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.2/providers/openai.md)). Documented, not yet measured here.

The shapes that break it:
- "the current screenshot" attached to the newest message and removed from the older ones on every turn;
- a pre-signed URL generated on every call, so the same file has a new URL (its expiry query string) each time;
- an image resized or re-compressed on every call, which gives different base64 bytes;
- a file re-uploaded per call, which gives a new file id;
- attachments placed in the system prompt and swapped per request.

## Detect in code
Python:
```
rg -n 'generate_presigned_url\(|b64encode\(|\.thumbnail\(|\.resize\(|files\.(create|upload)\(' -g '*.py'
```
Shapes: `generate_presigned_url(...)` inside the function that builds messages; `base64.b64encode(resize(img))` on each call; `for m in history: m["content"] = [p for p in m["content"] if p["type"] != "image"]`.

TS/JS:
```
rg -n 'getSignedUrl\(|toString\("base64"\)|sharp\(|files\.create\(' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `image_url: { url: await getSignedUrl(s3, cmd) }` in the request builder; `sharp(buf).resize(...)` per request.

Go:
```
rg -n 'PresignGetObject\(|base64\.StdEncoding\.EncodeToString\(|imaging\.Resize\(' -g '*.go'
```
Shapes: a presign call or a resize inside the loop that builds each request.

## Fix
Encode or upload once, when the attachment enters the conversation, and store the exact content part.

```python
# before
def build(history, shot):
    for m in history:
        m["content"] = [p for p in m["content"] if p.get("type") != "image_url"]
    url = s3.generate_presigned_url("get_object", Params=shot.key)
    history[-1]["content"].append({"type": "image_url", "image_url": {"url": url}})

# after
def add_screenshot(history, shot, step):
    part = {"type": "image_url", "image_url": {"url": to_data_url(shot)}}   # encoded once
    history.append({"role": "user", "content": [
        {"type": "text", "text": f"Screenshot after step {step}; it supersedes earlier ones."}, part]})
```

If old images must leave the context to save space, drop them in a compaction step (LP-PC-08), not on every turn.

## Don't break meaning
If the app removed old images so the model would look only at the latest one, keep that intent with a label ("supersedes earlier ones") on the new image instead of deleting the old ones, and check that answers still refer to the latest image. Text that refers to an image stays next to it. Do not lower image resolution once to make bytes stable if the task needs the detail.

## Verify
(a) In a session with an image, the next turn reports `cached_tokens` or `cache_read_input_tokens` covering the message that holds the image.

(b) kvsig: `msgs[i]` of the message that carries the attachment is equal on every later request, and `nodes` continue (each request's `nodes` start with all of the previous one's).

## Waste signal
Measured: lowers S on every turn that moves or re-encodes an attachment. Static: severity medium for a per-call presign, re-encode or re-upload, or for attachments removed from older messages each turn.
<!-- leanprompt:generated v0.1.0-dev.2 — managed by npx leanprompt init; local edits are replaced on update -->
