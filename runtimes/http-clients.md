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

SDKs set their own defaults on top of these, retries included, and a per-request timeout counts again on every retry: the OpenAI SDKs' default timeout and retries are in [providers/openai.md](../providers/openai.md), the Anthropic SDK's in [providers/anthropic.md](../providers/anthropic.md), the AI SDK's in [runtimes/llm-sdks.md](llm-sdks.md), and LangChain's in [runtimes/langchain.md](langchain.md).

## Platform time limits for a whole function

A serverless platform ends a function that runs past its time limit, however its HTTP client is set up. An agent turn that makes several model calls inside one function has to finish within that limit as a whole (LP-GE-04).

| Platform | Setting | What it covers | Source |
|---|---|---|---|
| Vercel Functions | `maxDuration`: a named export in a Next.js App Router route file (`export const maxDuration = 60`), or the `functions` object in `vercel.json` (`{"functions": {"api/*.js": {"maxDuration": 15}}}`); the page also documents a team-wide default and longer limits on some plans | The maximum time the function can run, in seconds | https://vercel.com/docs/functions/configuring-functions/duration |

Other platforms (AWS Lambda, Cloudflare Workers, Netlify Functions) have their own limits; they were not read for this table (checked 2026-11-26), so look the limit up in the platform's documentation.
