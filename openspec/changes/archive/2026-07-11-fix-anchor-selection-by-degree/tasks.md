# Tasks: fix-anchor-selection-by-degree

## 1. Core fix

- [x] 1.1 In `selectAnchorsForPrompt` (`routes/ontology/ontologyBuilder.js`) sort each
      bucket by `degree` DESC, tie-break `full_name` (tables, classes+interfaces,
      functions, docs, methods)
- [x] 1.2 Reserve code budget: `tableBudget = min(tables.length, max(8, round(cap*0.5)))`;
      take top tables by degree, fill remainder with code anchors, backfill remaining with
      more tables by degree; final length ≤ cap
- [x] 1.3 Extract `TABLE_BUDGET_RATIO = 0.5` as a module const
- [x] 1.4 (Optional) sort `collectTableAnchors` SQL by `degree DESC, full_name` too, so
      downstream `tableAnchors` order is already central-first

## 2. Regression safety

- [x] 2.1 Confirm small contexts (≤ budget tables) keep all tables + code (KOSMOS-VECTOR
      parity)
- [x] 2.2 Confirm total sample never exceeds `anchorCap`

## 3. Verification (host-side)

- [x] 3.1 Unit test with 242 mock tables (varied degree) + code anchors, cap 32 → top
      tables by degree present AND ≥ ~16 code anchors, length ≤ 32
- [x] 3.2 `node tune.mjs --variant P2 --context CARL --mode export` → anchor list contains
      `carl_data.auction`, `profile`, `workflow` and function anchors
      (post-restart: auction/profile/users + 16 functions; workflow outside top-16 by
      measured degree; also fixed collectAnchors to exclude tables so code is not starved)
- [x] 3.3 `node tune.mjs --variant P2 --context CARL --runs 2 --model RICH-KOSMOS-INSTRUCT
      --max 16 --restore` → `out/carl-post-fix/P2.suggest.*.json`
- [x] 3.4 `export` on KOSMOS-VECTOR unchanged (15 tables + code; tables now degree-ordered)

## 4. Docs

- [x] 4.1 Note the anchor-selection behavior in `docs/ONTOLOGY_BUILDER_TUNING.md`
      (anchors = central-by-degree + reserved code budget)
- [x] 4.2 `CHANGELOG.md`
