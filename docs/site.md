# The website

The leanprompt website (lmwarden.com/leanprompt/) is a static site built from this
repository: `npm run build:site` writes it to `site-dist/leanprompt/` (sources in `site/`,
the build in `site/src/build.ts`, its tests in `site/test/`).

lmwarden.com serves it from S3-compatible object storage, so a site update needs no LM Warden
release. LM Warden also bundles a copy of the site, which it serves whenever the published
copy is missing or fails verification.

## Publishing

Push the change to the public repository's `main` first, then:

```sh
npm run publish:site -- --dry-run   # build and list what would be uploaded
npm run publish:site                # build public main's tip and publish it
```

`publish:site` fetches `main` from the public repository, builds that commit from a clean
`git archive` in a temporary directory, and uploads it:

| Key under `<bucket>/<prefix>/` | What | Cache-Control |
|---|---|---|
| `<commit>/<path>` | every file of the build, with its Content-Type | `public, max-age=31536000, immutable` |
| `manifests/<commit>.json` | that build's manifest, kept for rollbacks | `public, max-age=31536000, immutable` |
| `current.json` | the live manifest, uploaded last | `no-cache` |

The manifest is `{"commit", "version", "published", "files": {"<path>": "<sha256>"}}`. The
server reads `current.json` about once a minute, downloads the commit it names, checks every
file against its sha256, and switches only once the whole commit has loaded. It never serves
part of one build mixed with another. If the storage cannot be reached, or the manifest or a
file is wrong, it keeps serving the last commit that loaded whole, or its bundled copy.

Options:

- `--ref <commit>`: publish an older commit of public `main` instead of its tip.
- `--allow-unpublished`: build and publish this checkout's `HEAD` in place, even if it is
  not on public `main`. Use it only for a preview. The tree must be clean.
- `--rollback <commit>`: point `current.json` back at a commit published before. It first
  checks that all of that commit's files are still in storage. No other upload happens.
- `--dry-run`: works with the other options and changes nothing.

The script refuses to publish from a tree with uncommitted changes, or a commit that is
not on public `main`, unless `--allow-unpublished` is given.

### Settings

`npm run publish:site` loads `.env` from the repository root if it exists. That file is
git-ignored; never commit it.

| Variable | Meaning |
|---|---|
| `S3_ENDPOINT` | the S3 endpoint, path-style, for example `https://media.example.com` |
| `S3_BUCKET` | the bucket |
| `S3_PREFIX` | the key prefix (default `leanprompt-site`) |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | a key allowed to read and write `<bucket>/<prefix>/*` only; the secret is never printed |
| `S3_REGION` | the signing region (default `us-east-1`) |
| `LEANPROMPT_PUBLIC_REPO` | the public repository (default `https://github.com/Podwarden/leanprompt.git`) |

The script needs Node 20.19+ and git, and has no npm dependencies. It signs requests with
AWS Signature Version 4 itself; its tests check the signer against AWS's published examples.

### The storage

The bucket allows anonymous reads of `<prefix>/*`, with no listing and no anonymous writes.
The publishing key can only put and get objects under `<prefix>/`. The LM Warden server is
configured with `VW_LEANPROMPT_SOURCE=https://<storage host>/<bucket>/<prefix>`. It fetches
the files server side and sets its own headers (CSP, caching, content type), so the bucket
needs no CORS rules.

### Checking what is live

- `https://<storage host>/<bucket>/<prefix>/current.json` names the published commit.
- A signed-in LM Warden operator can see which copy the server is serving, and which commit,
  at `GET /api/site/leanprompt/status`.
