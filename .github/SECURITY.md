# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately by email to info@podwarden.com, or through GitHub's private vulnerability reporting on this repository when it is enabled. Include what you found, how to reproduce it and the leanprompt version. We acknowledge reports and keep you informed until the fix is released, and credit you in the release notes if you wish.

## What leanprompt sends, and what it never sends

- **No telemetry.** The CLI and the skills report nothing to the LM Warden Team or anyone else. There is no account, no hosted service and no upload.
- **Two network calls, both to addresses you choose.** `leanprompt profile detect --lmwarden <url>` makes one request to the LM Warden URL you give, with the API key from the environment variable you name as a bearer token; it never prints the key. The replay harness (`npm run eval`, in this repository only) sends requests to the providers you name. Nothing else in leanprompt makes a network call; `npx` itself downloads the package from npm.
- **The usage logger never writes prompt or completion text.** `.leanprompt/usage.jsonl` holds keyed kvsig ids, character counts, token counts, the finish reason and flags. The ids are keyed with a secret you generate and keep out of the repository; the ids mean nothing without it.
- **Result files hold no prompt text.** Files under `eval/results/` contain token counts, answer-check outcomes and spend only.
- **`install` (and `init`) writes only inside the project** (or your home directory with `--scope=global`), refuses to write through a symlinked parent directory that leads outside the project, and never overwrites a file it did not generate.

## Supported versions

Security fixes go into the latest release.
