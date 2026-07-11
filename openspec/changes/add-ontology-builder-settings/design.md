# Design: add-ontology-builder-settings

## Context

- Step 6 builder: `POST /api/ontology/build/suggest|materialize|apply`.
- Global app config: `config.json` + `GET/PATCH /api/config` + UI App Config tab.
- Feature-specific model precedent: `KOSMOS_LOGIC_ARHITECT_MODEL`.
- Hardcoded suggest prompt previously lived only in `llmProposeConcepts()`.

## Goals

- Operators edit builder **model**, **prompts**, and **knobs** in System Settings.
- Defaults remain in code; empty stored prompts → runtime defaults (safe reset).
- Partial PATCH of `ontology_builder` must not wipe sibling prompt fields (deep merge).
- Suggest continues to work if `ontology_builder` missing (merge with defaults on read).

## Non-Goals

- Per-`context-code` ontology_builder (kb-config) — global only in v1.
- Prompt history / versioning (unlike prompts-config history).
- Moving `onto_loading.dirs` into System Settings.
- Live “test suggest” button inside Settings (optional later).

## Key Decisions

### Storage: `config.json.ontology_builder` (not prompts-config)

Keeps L1/L2 enrichment prompts separate from ontology design prompts. Single
`PATCH /api/config` already used by App Config tab; nested object is enough.

Shape:

```json
{
  "ontology_builder": {
    "model": null,
    "maxConcepts": 12,
    "depth": "concepts+grounding",
    "temperature": 0,
    "systemPrompt": "...",
    "userPromptTemplate": "...",
    "descriptionPrompt": "...",
    "excludeNamePatterns": ["^format[A-Z]", "^validate[A-Z]", "..."],
    "enableDescriptionPass": false
  }
}
```

- `model: null` → `KOSMOS_MODEL`.
- Placeholders in templates: `{{maxConcepts}}`, `{{contextCode}}`, `{{seedConcepts}}`,
  `{{anchors}}`, `{{concepts}}`.

### Defaults module

`packages/core/ontologyBuilderDefaults.js` owns default prompt text and
`getDefaultOntologyBuilderConfig()` / `renderPromptTemplate()` so appConfigService and
builder share one source.

### Deep merge on save/read

- `getConfig()`: shallow app keys + deep `ontology_builder`.
- `saveConfig(updates)`: if `updates.ontology_builder` present, merge onto current
  section + defaults (partial tab save does not erase prompts).

### Suggest wiring

1. Load settings via `getOntologyBuilderSettings()`.
2. Filter anchors by `excludeNamePatterns` (tables always re-included).
3. `callLLM(system, user, model, { jsonMode, temperature })`.
4. Optional second pass if `enableDescriptionPass` — batch descriptions JSON.
5. Request body `maxConcepts`/`depth` still override settings defaults for a single run.

### UI tab

`SettingsDialog` tab id `ontology` → `OntologyBuilderConfigTab` reuses `useAppConfig()`
`updateConfig({ ontology_builder })`. Pipeline dialog only surfaces model/source and
points to Settings for editing.

## Risks

| Risk | Mitigation |
|------|------------|
| Bad prompt → invalid JSON | heuristic fallback already in suggest |
| Empty prompts after “reset section” | runtime treats empty as code defaults |
| Huge prompts in config.json | acceptable; no size limit v1 |

## Rollout

1. Deploy backend (defaults merge on GET without writing file).
2. Deploy UI tab; operators save overrides as needed.
3. Re-run suggest on FULL_TEST after prompt tuning.

## Open Questions

- Prompt history table (like prompts-config)? Deferred.
- Per-context overrides in kb-config? Deferred.
