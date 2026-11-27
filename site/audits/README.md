# Audits

One folder per published audit, `site/audits/<owner>__<repo>/`, holding:

| File | What it is |
|------|------------|
| `meta.yaml` | The audit's facts, headline, figure and illustration. Every key is explained in [`_template/meta.yaml`](_template/meta.yaml). |
| `findings.json` | The findings `/leanprompt audit` wrote to `.leanprompt/findings.json`. |
| `illustration.webp` | The picture beside the headline on the [audits list](https://lmwarden.com/leanprompt/audits/) and the audit page, 1408x736. |
| `og.jpg` | The page's share image (Open Graph and Twitter), 1200x630, progressive JPEG, under about 150 KB. |

`npm run build:site` checks every rule in [`site/src/audits.ts`](../src/audits.ts) and fails on any audit that breaks one, including an illustration without a scene or alt text, or a missing image, or one of the wrong size.

## The illustration

Every published audit, the demonstration too, has one. In `meta.yaml`:

```yaml
illustration:
  scene: "a small desktop machine feeding out three identical long paper strips side by side, a guillotine blade slicing every strip off at exactly the same point"
  alt: "A cream desktop machine feeds out three paper strips side by side while a steel blade cuts every strip off at the same point."
```

- **scene**: what the picture shows. Objects only: a concrete metaphor for the mistake in the headline (a till printing a full-price receipt for goods already marked paid; a clock glued to a handbook so no copy is ever the same). No text or lettering, no logos, no people's faces. Leave style words out: the illustration service adds the house style.
- **alt**: one plain sentence describing the picture for screen readers, written after looking at it.

The picture is reproducible: the service seeds it from the folder name, so the same folder and scene give the same picture. Once an audit has its files, do not edit its scene; a new scene is a new picture.

## Making the images

```sh
export IMGEN_URL=...           # the illustration service's base URL (not published; ask the maintainers)
export IMGEN_API_TOKEN=...     # optional: only needed to draw a new scene
npm run illustrations                              # every audit with a scene and no images
npm run illustrations -- --only <owner>__<repo>    # one audit, even if it has its images
npm run illustrations -- --force                   # every audit, again
```

Instead of exporting them, you can put both lines (without `export`) in a `.env` file at the repository root; `npm run illustrations` loads it (Node 22.9 or later). `.env` is in `.gitignore` and outside the npm package's `files`: never commit it, and keep it readable only by you (`chmod 600 .env`).

With a token, the script asks the service to draw each scene, waits for the job and writes `illustration.webp` and `og.jpg` into the folder (the service makes og.png; the script converts it to JPEG locally with `ffmpeg` or, on macOS, `sips`, and stops with a message if neither is installed). Without one, it downloads the picture the service already drew for that folder and that exact scene, and exits 1 naming any audit that has none yet. It checks both images' sizes before writing them, and never prints the token.

Check the picture before committing: it must read as the headline's mistake, and the alt must describe what is actually drawn.

## Before a release

- `ILLUSTRATIONS_PENDING` in [`site/src/audits.ts`](../src/audits.ts) must be empty. It lets a named audit build without its two images while they wait to be drawn; a site test fails as soon as an entry's images exist, so the entry is removed with the commit that adds them.
- `npm run build:site` and `npx vitest run site/test` pass.
