# Tuning the "suggested categories" prompt

`public/AGENTS.md` tells agents how to add suggested categories (a facet with `"source": "suggested"`) when a conference has none. The wording there was chosen by testing prompts on a conference that *does* have organizer categories, with those categories hidden.

## Method

- **Data:** ASHG 2026 (`local/ashg-2026.conference.json.gz`, from `scripts/convert-ashg.ts`).
  - 3,099 presentations carry the organizers' `track` facet: 13 tracks, about 1.7 per presentation.
  - `make_sample.py` draws 240 presentations (seed 7), re-numbers them `i001…`, and writes `items.json` (title + abstract, truncated to 900 characters) and `truth.json`.
  - A replicate sample uses seed 11 (19 of 240 presentations overlap with the first).
- **Runs:** one fresh agent per prompt. Each reads only `items.json`, categorizes by hand (no keyword rules or clustering code), and writes `prediction.json`.
- **Score** (`score.py`), multi-label:
  - match-recall: for each real track with at least 5 items, the F1 of its best-matching suggested category, averaged;
  - match-precision: for each suggested category, the F1 with its best-matching real track, averaged;
  - score: the harmonic mean of the two.

  The real tracks score 1.0. Putting everything in one category scores 0.35.

## Results

| Prompt | Idea | Seed 7 | Seed 11 |
|---|---|---|---|
| `v8-disease-class` | v7 + coarse disease-class domains + standard translational / population-health tracks | **0.574** | **0.570** |
| `v7-submission-form-calibrated` | v6 + ~1.5–2 labels per item + size check | 0.540 | 0.556 |
| `v6-submission-form` | "the abstract submission form's track dropdown", chosen as authors would | 0.529 | 0.544 |
| `v5-axes-coarse` | v4 + "tracks are coarse" | 0.513 | |
| `v10-titles-only` | v7 with titles only, no abstracts | 0.512 | |
| `v4-axes` | approach categories + application categories | 0.478 | |
| `v9-split-design` | one agent writes the categories and definitions, a fresh agent assigns | 0.467 | |
| `v2-program-committee` | "act as the program committee" | 0.425 | |
| `v1-minimal` | "propose 8–15 topics, assign 1–2" | 0.421 | |
| `v3-two-pass` | draft, assign, merge/split by size | 0.403 | |

What moved the score:
- **The submission-form framing (+0.05).** Earlier prompts invented narrow topical categories (single-cell, long-read, epigenetics, neuro/psychiatric) that organizers don't use. Framing the task as a dropdown that authors pick from keeps categories coarse.
- **Coarse domains plus standard cross-cutting tracks (+0.03).** v8 stopped inventing organ-system tracks and recovered "Public Health".
- **Abstracts** are worth about 0.03 over titles alone.
- **Splitting design from assignment hurt.**

## Limits

- **One ground truth.** ASHG is the only conference available with real categories, and v8's extra guidance was written after seeing which ASHG tracks earlier prompts missed. The replicate sample checks sampling noise, not overfitting to ASHG or to human genetics.
- **No repeats.** Each prompt ran once per sample. Gaps under about 0.02 are within run-to-run variation.
- **ASHG's own tracks aren't the only good answer.** Its biggest track, "Genomic and Precision Medicine", is a broad catch-all that no prompt fully recovered (best F1 0.42).

## Rerun

```sh
uv run scripts/suggest-eval/make_sample.py local/ashg-2026.conference.json.gz --facet track --n 240 --seed 7 --out local/suggest-eval
# give an agent local/suggest-eval/runs/<name>/items.json and a prompt from prompts/, then:
uv run scripts/suggest-eval/score.py local/suggest-eval/truth.json local/suggest-eval/runs/*/prediction.json --detail
```
