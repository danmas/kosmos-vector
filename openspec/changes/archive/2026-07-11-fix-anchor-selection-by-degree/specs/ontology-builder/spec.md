# Spec delta: ontology-builder

## ADDED Requirements

### Requirement: Prompt anchors ranked by degree with reserved code budget

When assembling the anchor sample for `suggest` (within `anchorCap`), the system MUST
select **tables by descending L1 degree** (not alphabetically), and MUST reserve part of
the cap for non-table anchors so tables cannot consume every slot. Central tables and key
code anchors MUST both reach the prompt on large contexts.

#### Scenario: Central tables reach the prompt on a large context

- **WHEN** a context has more tables than the anchor cap (e.g. CARL, 242 tables, cap 32)
- **THEN** the highest-degree tables (e.g. `carl_data.auction` degree 123) are included
  in the anchor sample
- **AND** low-relevance alphabetically-early tables are NOT chosen merely for their name

#### Scenario: Code anchors are not starved by tables

- **WHEN** the number of tables exceeds the cap
- **THEN** a reserved share of the cap (at least ~40%) is filled with non-table anchors
  (classes/interfaces/functions/docs by degree), so process concepts remain derivable
- **AND** the total anchor sample size does not exceed the cap

#### Scenario: Small context unchanged

- **WHEN** a context has fewer tables than the table budget (e.g. KOSMOS-VECTOR, 15
  tables)
- **THEN** all its tables are kept and remaining slots go to code anchors, matching prior
  behavior (no regression)

#### Scenario: Backfill when few code anchors

- **WHEN** the reserved code budget cannot be filled (too few class/function anchors)
- **THEN** the remaining slots are backfilled with additional tables by degree, up to the
  cap (no empty slots)
