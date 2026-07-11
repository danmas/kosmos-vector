# Tasks: add-ontology-builder-settings

> Retroactive checklist — implementation already landed; items marked complete.

## 1. Backend — config

- [x] 1.1 `packages/core/ontologyBuilderDefaults.js`: defaults (prompts, knobs),
      `renderPromptTemplate`, `getDefaultOntologyBuilderConfig`
- [x] 1.2 `appConfigService`: include `ontology_builder` in defaults; deep merge on
      get/save; validate nested fields
- [x] 1.3 Export `getDefaultOntologyBuilderConfig` from appConfigService if needed

## 2. Backend — builder wiring

- [x] 2.1 `getOntologyBuilderSettings()` with empty-string → code default fallback
- [x] 2.2 `llmProposeConcepts` uses settings model/prompts/temperature
- [x] 2.3 Anchor filter via `excludeNamePatterns` (keep tables)
- [x] 2.4 Optional `enableDescriptionPass` second LLM call
- [x] 2.5 `suggestOntology` defaults maxConcepts/depth from settings; response meta
      includes model/settingsApplied
- [x] 2.6 `llmClient.callLLM` supports `options.temperature`

## 3. UI

- [x] 3.1 `types.ts`: `OntologyBuilderConfig`, AppConfig fields
- [x] 3.2 `OntologyBuilderConfigTab.tsx`: form + save via app config API
- [x] 3.3 `SettingsDialog.tsx`: tab `ontology`
- [x] 3.4 `OntologyBuilderDialog`: banner points to Settings / shows model

## 4. Verification

- [x] 4.1 Unit: defaults/validate/renderPromptTemplate smoke
- [x] 4.2 Existing `tests/test_ontology_builder.js` still pass (25 checks)
- [x] 4.3 Manual: Settings tab visible; GET config includes ontology_builder keys

## 5. Docs (optional follow-up)

- [ ] 5.1 Note in `KB/README_ONTO_LOADING.md` § builder: Settings → model/prompts
- [ ] 5.2 CHANGELOG line under 2.11.x / next version
