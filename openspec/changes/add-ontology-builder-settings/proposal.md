# Change: add-ontology-builder-settings

## Why

Ontology Builder (Step 6, change `add-ontology-builder`) hardcodes LLM system/user
prompts and always uses global `KOSMOS_MODEL`. Tuning concept quality (domain vs util
noise, maxConcepts, second-pass descriptions) requires code changes and redeploy.

Operators need the same control surface as other product features: **App Config**
already has per-feature models (`KOSMOS_LOGIC_ARHITECT_MODEL`); **Prompts Config**
edits enrichment prompts. Builder must fit that pattern — editable model, prompts, and
knobs without touching `ontologyBuilder.js`.

## What Changes

- **MODIFIED** capability `app-config` (backend): nested section `ontology_builder` in
  `config.json` via `packages/core/appConfigService.js` — defaults, validation, deep-merge
  on PATCH; defaults module `packages/core/ontologyBuilderDefaults.js` (system/user/
  description prompts, exclude patterns, maxConcepts, depth, temperature).
- **MODIFIED** capability `ontology-builder` (backend): `suggest` reads
  `ontology_builder` (model override, prompts with placeholders, excludeNamePatterns,
  optional description pass); `llmClient.callLLM` accepts `temperature`; empty prompt
  strings fall back to code defaults.
- **NEW** capability `ontology-builder-settings-ui` (`../kosmos-vector-UI`): System
  Settings tab **Ontology Builder** (`OntologyBuilderConfigTab`) — edit/save section
  through existing `GET/PATCH /api/config`; types `OntologyBuilderConfig`; dialog banner
  points to Settings after suggest.

## Impact

- Backend: `appConfigService.js`, `ontologyBuilderDefaults.js` (new), `llmClient.js`,
  `routes/ontology/ontologyBuilder.js`.
- UI: `SettingsDialog.tsx`, `components/settings/OntologyBuilderConfigTab.tsx` (new),
  `types.ts`, minor `OntologyBuilderDialog.tsx`.
- Config: optional `ontology_builder` key in `config.json` (merged at read time if absent).
- Out of scope: per-context kb-config dirs (`onto_loading`), embedding model, run UI for
  suggest (stays Pipeline Step 6).

## Status

**Implemented** (retroactive OpenSpec after code landed). Tasks below mark completed work.
