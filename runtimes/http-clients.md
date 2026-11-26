---
runtime: http-clients
checked: 2026-11-26
source: https://github.com/nodejs/undici/blob/main/docs/docs/api/Client.md
---

# HTTP client default timeouts

Status: documented, not yet measured here. Used by LP-GE-04: a call that sets no timeout of its own gets the default of the HTTP client it runs on. Each row gives the client's default, what it covers, and the page it was read from on the `checked:` date.

## Defaults

| Runtime / client | Default | What it covers | Source |
|---|---|---|---|
| Node.js built-in `fetch` (undici) | `headersTimeout` `300e3` milliseconds (five minutes); `bodyTimeout` `300e3` milliseconds; `0` disables either | `headersTimeout`: the wait for the complete response headers. `bodyTimeout`: the time between consecutive body chunks. Node's `fetch` is based on undici and takes a `dispatcher` option; that a global `fetch` with no `dispatcher` uses these undici defaults follows from that, and is not stated on the Node page | https://github.com/nodejs/undici/blob/main/docs/docs/api/Client.md, https://nodejs.org/api/globals.html#fetch |
| Python `httpx` | A `TimeoutException` after five seconds of network inactivity; `timeout=None` disables it | Connect, read, write and pool are the four timeout kinds; the page does not say which of them the default covers. A non-streaming completion usually sends nothing until the answer is ready, so a default read wait applies to the whole generation | https://www.python-httpx.org/advanced/timeouts/ |
| Python `requests` | No timeout unless one is set | `timeout=` sets the connect and read timeouts (one value for both, or a tuple); the read timeout is the wait between bytes from the server, not a wall-clock limit | https://requests.readthedocs.io/en/latest/user/advanced/#timeouts |
| Go `net/http` (`http.Client`, `http.DefaultClient`) | No timeout: a zero `Timeout` means none, and `DefaultClient` (used by `http.Get`, `http.Head`, `http.Post`) is `&Client{}` | `Client.Timeout` covers connection time, redirects and reading the response body | https://pkg.go.dev/net/http#Client |

SDKs set their own defaults on top of these: the OpenAI Python SDK's default timeout and retries are in [providers/openai.md](../providers/openai.md).
