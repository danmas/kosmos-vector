# Design: fix-anchor-selection-by-degree

## Context

Chain: `prepareSuggestContext` → `collectAnchors(limit 120)` (already degree-sorted per
type) + `collectTableAnchors` (ALL tables, **alphabetical**) → re-includes every table
into `anchors` → `llmProposeConcepts` → `selectAnchorsForPrompt(anchors, tables, cap)` →
`formatAnchorsCompact` → `{{anchors}}`.

`anchorCap = Math.min(32, Math.max(16, maxConcepts * 3))` (so ≥11 concepts ⇒ 32).

Current `selectAnchorsForPrompt`:
```
ordered = [...tablesList, ...classes, ...functions, ...docs, ...methods]
return ordered.slice(0, cap)
```
`tablesList` is in Map-insertion order = `tables` param order = alphabetical. With >cap
tables, `slice(0,cap)` = first `cap` tables alphabetically, zero code anchors.

## Decision — degree ranking + reserved code budget

Rewrite `selectAnchorsForPrompt(anchors, tables, cap)`:

1. Union by full_name (as today).
2. Sort each bucket by `degree` DESC, then `full_name`:
   - `tablesList`, `classes` (class+interface), `functions`, `docs`, `methods` (top 6).
3. Budget split so tables never starve code:
   - `tableBudget = Math.min(tablesList.length, Math.max(8, Math.round(cap * 0.5)))`
   - take top `tableBudget` tables (by degree)
   - fill the remaining `cap - taken` from `[...classes, ...functions, ...docs, ...methods]`
     (already degree-sorted)
   - if code anchors don't fill the remainder, backfill with more tables (by degree)
   - final `slice(0, cap)`
4. Result: central tables (by degree) + key code, on any context size.

### No regression on small contexts

KOSMOS-VECTOR: 15 tables. `tableBudget = min(15, max(8, 16)) = 15` → all 15 tables kept,
remaining 17 slots → classes/functions (as before). Output set ≈ current → P2 8/10 holds.

CARL: 242 tables. `tableBudget = min(242, 16) = 16` → top-16 tables by degree
(`auction`(123), `profile`(61), `users`(45), `inspect_report`(34), `commission`,
`workflow`, `object`, …) + 16 code anchors (functions/classes by degree). LLM finally
sees the real domain core.

### Ratio / cap

`0.5` split is a starting point; expose as a module const `TABLE_BUDGET_RATIO = 0.5` so
it is tunable without touching logic. Optionally bump `anchorCap` ceiling 32 → 40 for
big contexts (more room), but keep the ranking fix as the primary change.

## Non-Goals

- No prompt (P2) changes — P2 stays the tuning winner.
- No data cleaning of CARL — irrelevant to this bug (central tables are legit, not junk).
- No change to grounding/relation logic, only prompt anchor selection.
- Junk-table suppression (pgbench_*, tmp_*, *_bup, backups) is a **separate** optional
  concern; with degree ranking most junk sinks (low degree) — handle later only if it
  still surfaces.

## Risks

- Degree from `collectTableAnchors` is computed already (`count(DISTINCT l.id)`), so no
  new query needed — just use it for ordering.
- Backfill edge cases (few code anchors) — must still fill to `cap` with tables.
- Verify `formatAnchorsCompact` receives the newly-ordered list (it slices again by
  `limit` = cap; ensure our selection is already ≤ cap and correctly ordered).

## Verification (host-side)

1. Unit: feed 242 mock tables (varying degree) + classes/functions, cap 32 → assert
   result contains top tables by degree AND ≥ ~16 code anchors, length ≤ 32.
2. `export` on CARL: `node tune.mjs --variant P2 --context CARL --mode export` → confirm
   `auction`/`profile`/`workflow` present and functions present in the anchor list.
3. `suggest` on CARL: domain concepts (auction/bid/commission/…) appear; re-score rubric.
4. Regression: `export` on KOSMOS-VECTOR → anchor set ≈ prior (15 tables + code).
