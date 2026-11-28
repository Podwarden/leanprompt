# Audits

One folder per published audit, `site/audits/<owner>__<repo>/`, holding:

| File | What it is |
|------|------------|
| `meta.yaml` | The audit's facts, headline, figure and diagram. Every key is explained in [`_template/meta.yaml`](_template/meta.yaml). |
| `findings.json` | The findings `/leanprompt audit` wrote to `.leanprompt/findings.json`. |

`npm run build:site` checks every rule in [`site/src/audits.ts`](../src/audits.ts) and fails on any audit that breaks one, including a `diagram:` with a missing key, a too long string or a key its kind does not take.

The page's share image (Open Graph and Twitter) is not a source file. The build draws a 1200x630 `og.png` for every audit from its `meta.yaml` and `findings.json` (kind, headline, repo, big number, status badge, the leanprompt mark) with [`site/src/og.ts`](../src/og.ts), so it always matches the page and needs nothing from you. Long headlines wrap and shrink to fit.

## The diagram

The picture on the audit page, the audits list and the home page is a mechanism diagram that the build draws (inline SVG, no image, [`site/src/diagram.ts`](../src/diagram.ts)): a left-to-right flow of 3 or 4 boxes (the app, the request, the provider, what comes back, what the app does with it) with the one step where the mistake happens in the accent colour and a short label saying what goes wrong. There is one template per kind; `diagram:` in `meta.yaml` fills it with this audit's own specifics:

```yaml
kind: Cut-off answer
diagram:
  cap: "1,024 tokens, fixed in the code"
  then: "Posted as the final reply"
  wrong: "Only an empty reply is noticed"
```

- The keys each kind takes are listed in [`_template/meta.yaml`](_template/meta.yaml) and enforced by `DIAGRAM_KEYS` in `audits.ts`; a missing, unknown or too long one (56 characters, `wrong` 64) fails the build.
- Every string must be literally true to the audit's `findings.json`: copy numbers from the finding, keep "about" on estimates, keep "probably" where the finding says it. If the kind does not fit what the audit found, say what the audit says anyway, and pick the nearest kind.
- The diagram's `aria-label` is built from the same strings, so the page reads the mechanism aloud.
- The old generated illustration (`illustration:` scene and alt, `illustration.webp`) is optional and unused: nothing requires or shows it. The `npm run illustrations` script remains only for anyone who wants the old pictures.

## Before a release

- `npm run build:site` and `npx vitest run site/test` pass.
