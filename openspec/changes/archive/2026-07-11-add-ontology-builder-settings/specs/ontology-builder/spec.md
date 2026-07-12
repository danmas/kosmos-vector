# Spec delta: ontology-builder (settings-aware suggest)

## ADDED Requirements

### Requirement: Suggest uses configurable model and prompts

`POST /api/ontology/build/suggest` MUST использовать настройки `ontology_builder` из
app config: модель (или fallback `KOSMOS_MODEL`), system prompt, user prompt template
с подстановкой плейсхолдеров `{{maxConcepts}}`, `{{contextCode}}`, `{{seedConcepts}}`,
`{{anchors}}`, и temperature при вызове LLM.

#### Scenario: Empty stored prompts fall back to code defaults

- **WHEN** в config сохранены пустые `systemPrompt` / `userPromptTemplate`
- **THEN** suggest использует встроенные defaults из `ontologyBuilderDefaults.js`,
  а не отправляет пустые system/user сообщения

#### Scenario: Request overrides settings maxConcepts/depth

- **WHEN** body suggest содержит `maxConcepts` и/или `depth`
- **THEN** эти значения имеют приоритет над defaults из `ontology_builder` для данного запроса

#### Scenario: Exclude patterns filter util anchors but keep tables

- **WHEN** заданы `excludeNamePatterns` (например `^validate[A-Z]`)
- **THEN** соответствующие non-table якоря не передаются в LLM, а items с `type=table`
  остаются доступны для кластеризации

### Requirement: Optional description pass

The system MUST support an optional second LLM description pass controlled by
`enableDescriptionPass`. When `enableDescriptionPass` is true, after a successful
concepts JSON response the system MUST run a second LLM call using settings
description prompts. On second-pass failure, suggest MUST stop (fail-fast) and
MUST NOT return a successful draft.

#### Scenario: Description pass disabled by default

- **WHEN** `enableDescriptionPass` is false or absent
- **THEN** only one LLM clustering call runs

#### Scenario: Description pass fails hard

- **WHEN** `enableDescriptionPass` is true and the second LLM call fails
- **THEN** suggest returns a user-facing error and does not return a successful draft

### Requirement: Runtime prompts only from settings

Suggest and export MUST read system/user/outputRules/retry/byo/description texts from
`ontology_builder` app config (normalized via GET/PATCH). The system MUST NOT use inline
route-hardcoded prompt bodies as the primary runtime source when config is available.

#### Scenario: Missing system/user prompts

- **WHEN** after normalize `systemPrompt` or `userPromptTemplate` is empty
- **THEN** suggest fails with a user-facing error pointing to Settings → factory defaults

### Requirement: Seed mode user-only by default

The prompt avoid-list MUST default to user-provided seed only (`seedMode: user-only`),
not all concept ids in the DB. Existing concept ids MUST be listable as reusable/refinable
separately from the avoid-list.

#### Scenario: user-only does not dump all concepts into avoid

- **WHEN** seedMode is user-only and body.seedConcepts is empty
- **THEN** export-prompt avoid-list is empty (or only explicit seeds), while existing
  concepts may appear in a separate “may reuse” section

### Requirement: Fail-fast on LLM / bad JSON for suggest

When the internal LLM fails or returns unrecoverable JSON, the system MUST return a
user-facing error (`LLM_REQUIRED` / `LLM_BAD_JSON`) and MUST NOT present a heuristic
draft as a successful suggest.

#### Scenario: Unrecoverable LLM or JSON failure

- **WHEN** internal LLM fails or JSON cannot be salvaged into any concept
- **THEN** API returns user-facing error codes `LLM_REQUIRED` or `LLM_BAD_JSON` without
  a success payload of heuristic concepts

#### Scenario: Truncated JSON partially recoverable

- **WHEN** response is truncated but at least one complete concept object exists
- **THEN** the system MUST salvage complete concepts when possible and continue; if none
  are recoverable, it MUST fail with `LLM_BAD_JSON`
