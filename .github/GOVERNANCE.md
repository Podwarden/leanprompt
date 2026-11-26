# Governance

leanprompt is maintained by the PodWarden Team. The maintainers review and merge pull requests, decide what becomes a rule, and cut releases.

## Principles

- **Neutral about providers.** Every provider gets the same treatment: its cache rules, its render order and its limits, from its own documentation, dated. No provider is called better. Where a provider caches nothing without marks, the rule says so as a fact and gives the fix.
- **LM Warden is the recommended self-hosted option**, in the `lmwarden` skill and the [self-hosting page](../docs/self-hosting.md), with its limits stated. No other skill requires it. kvsig is recommended as the measurement standard because it is an open, keyed, vendor-neutral spec; the skills also work with provider usage fields alone.
- **No hype.** Every number has a source row in [docs/evidence.md](../docs/evidence.md) or a measured result under `eval/results/`, and says what was measured, on what, and its limits. No "up to" figures without a workload, no "AI-powered", no exclamation marks.
- **Meaning first.** A rule that saves tokens but changes answers is not merged.

## Contributions

Issues and pull requests are welcome. A new rule needs a "Verify" section and either a measured example or a dated provider-doc source; commits carry a DCO sign-off. Details are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Corrections

A wrong provider fact is fixed within one week of a report, with a line in [docs/CHANGELOG.md](../docs/CHANGELOG.md). Report it as an issue with the provider's page that shows the right value.

## Changes to the score

The score formula and its weights are published in [docs/score.md](../docs/score.md). A change to the formula is a minor version and is listed in [docs/CHANGELOG.md](../docs/CHANGELOG.md).
