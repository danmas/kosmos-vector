# Change: add-ontology-builder-settings

## Why

Ontology Builder (Step 6) initially hard-coded LLM prompts/model and lacked operator
controls. Quality of generated ontologies and operability (external LLM, rebuild from
scratch, fail-fast on LLM errors) needed first-class product support aligned with
App Config / Prompts Config patterns and the principle **«Без ИИ жизни нет!»**.

## What Changes

### Core (original scope)

- **MODIFIED** `app-config`: nested `ontology_builder` in `config.json` (defaults,
  validation, deep-merge PATCH; factory in `ontologyBuilderDefaults.js`).
- **MODIFIED** `ontology-builder`: suggest reads settings (model, prompts, knobs).
- **NEW** `ontology-builder-settings-ui`: System Settings tab **Ontology Builder**.

### Follow-ups landed in the same change (expanded scope)

- **MODIFIED** `ontology-builder`:
  - prompts runtime **only** from Settings (factory = seed, not silent hardcode path);
  - fields: system/user, outputRulesSuffix, retry prompts, byoInstruction, description
    system/user, seedMode, excludeNamePatterns, enableDescriptionPass;
  - seedMode `user-only` (default) vs `all-existing` (legacy avoid-list dump);
  - domain-first anchors (tables first; methods deprioritized);
  - robust LLM JSON parse/salvage/retry + `max_tokens`;
  - fail-fast on LLM / bad JSON (no heuristic success);
  - **BYO LLM**: `POST .../suggest/export-prompt`, `POST .../suggest/import`;
  - **clear ontology**: `POST /api/ontology/clear` (concepts + onto links + MD).
- **MODIFIED** `ontology-builder-ui`:
  - numbered actions 1 (suggest built-in | external) → 2 MD → 3 apply;
  - BYO panel; clear ontology + clear UI draft;
  - draft persistence (localStorage); React loop fixes;
  - motto «Без ИИ жизни нет!» in sidebar.
- **Docs**: `KB/README_PRINCIPLES.md`, ONTO/INDEX/README/AGENTS notes.

## Impact

- Backend: `appConfigService`, `ontologyBuilderDefaults`, `llmClient`,
  `routes/ontology.js`, `routes/ontology/ontologyBuilder.js`, tests.
- UI (`../kosmos-vector-UI`): Settings tab, OntologyBuilderDialog, PipelineView,
  apiClient, types, Sidebar.
- Not in scope: per-context ontology_builder in kb-config; embedding model; full
  ontology graph viewer (use Graph/Inspector/validate).

## Status

**Implementation complete** (including follow-ups). Ready to archive.
