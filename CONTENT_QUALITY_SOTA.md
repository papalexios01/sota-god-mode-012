# SOTA Content Quality (Enterprise)

This build upgrades content quality + speed:

## What changed
- NeuronWriter scoring loop is capped (2 passes) to avoid 50+ minute runs.
- Long-form continuation is capped (2 continuations) for predictable runtime.
- A fast self-critique/editor pass enforces:
  - Missing NeuronWriter terms/entities/headings (when enabled)
  - Hormozi/Ferriss style (no fluff, punchy, tactical)
  - WordPress-ready HTML output

## Ranking length
We target NeuronWriter recommended length (derived from competitor analysis) + SERP heuristic.
