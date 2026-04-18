# Mode: classify — Role classification

## Step 1 — Extract role metadata

Read the JD from `$input.jd` and extract these fields:

- `title` (string): the exact role title
- `seniority` (enum: junior | mid | senior | staff | principal)
- `comp_range` (object with `min` and `max`, both numbers in USD)

Return JSON with those three fields. If any field is missing, set it to `null`.

## Step 2 — Classify archetype

Pick exactly one archetype from this list based on Step 1 output:

- `ic-swe` — individual contributor engineer
- `platform` — platform / infrastructure
- `ml` — machine learning / data
- `eng-mgr` — engineering manager

Return the archetype string.
