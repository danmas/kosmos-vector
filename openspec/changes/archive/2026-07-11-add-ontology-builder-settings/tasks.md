# Tasks: add-ontology-builder-settings

## 1. Backend — config

- [x] 1.1 `ontologyBuilderDefaults.js`: factory prompts + knobs + `renderPromptTemplate`
- [x] 1.2 `appConfigService`: `ontology_builder` defaults, normalize empty→factory, deep merge, validate
- [x] 1.3 Extra prompt fields: outputRulesSuffix, retry*, byoInstruction, descriptionSystemPrompt, seedMode

## 2. Backend — builder core

- [x] 2.1 `getOntologyBuilderSettings()` from app config only (runtime)
- [x] 2.2 suggest uses settings model/prompts/temperature/max_tokens
- [x] 2.3 excludeNamePatterns + tables always kept
- [x] 2.4 enableDescriptionPass second LLM call (settings prompts)
- [x] 2.5 seedMode user-only | all-existing; existing ids listed as “may reuse”
- [x] 2.6 domain-first anchors (table→class→function; methods limited)
- [x] 2.7 JSON parse / salvage truncated concepts / retry with settings retry prompts
- [x] 2.8 Fail-fast LLM_REQUIRED / LLM_BAD_JSON (no heuristic suggest success)

## 3. Backend — BYO + clear

- [x] 3.1 `POST /api/ontology/build/suggest/export-prompt`
- [x] 3.2 `POST /api/ontology/build/suggest/import` (same finalize as suggest)
- [x] 3.3 `POST /api/ontology/clear` { confirm, deleteDb, deleteFiles, dryRun }

## 4. UI

- [x] 4.1 types + apiClient for config, export, import, clear
- [x] 4.2 `OntologyBuilderConfigTab` + Settings tab (all prompt fields visible/editable)
- [x] 4.3 OntologyBuilderDialog: steps 1|2|3, BYO panel, clear ontology + UI draft
- [x] 4.4 PipelineView: no setState side-effects; Step 6 card
- [x] 4.5 Sidebar motto «Без ИИ жизни нет!»

## 5. Docs / OpenSpec

- [x] 5.1 `KB/README_PRINCIPLES.md` (LLM fail-stop + prompts-from-settings)
- [x] 5.2 `KB/README_ONTO_LOADING.md` builder notes (settings, clear, BYO-related)
- [x] 5.3 `KB/README_INDEX.md`, root `README.md`, `AGENTS.md`
- [x] 5.4 OpenSpec artifacts updated for follow-ups; ready to archive

## 6. Verification

- [x] 6.1 `tests/test_ontology_builder.js` pass
- [x] 6.2 Manual: Settings prompts; suggest/export/import; clear ontology
