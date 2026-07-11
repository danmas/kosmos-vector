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

Если `enableDescriptionPass` = true, после успешного JSON-ответа с concepts система
MAY выполнить второй LLM-вызов по `descriptionPrompt` и обогатить `rationale`/
`description` понятий; при ошибке второго прохода suggest MUST всё равно вернуть
черновик первого прохода (degraded, без 5xx только из-за description pass).

#### Scenario: Description pass disabled by default

- **WHEN** `enableDescriptionPass` false или отсутствует
- **THEN** выполняется только один LLM-вызов кластеризации
