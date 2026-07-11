# Spec delta: ontology-builder-byo (external LLM)

## ADDED Requirements

### Requirement: Export suggest prompt without calling LLM

Система MUST предоставить `POST /api/ontology/build/suggest/export-prompt?context-code=:`
который собирает system/user (и combined) промпты с якорями и settings **без** вызова LLM.

#### Scenario: Export for current form options

- **WHEN** клиент передаёт maxConcepts/depth/seedConcepts (как у suggest)
- **THEN** ответ содержит `systemPrompt`, `userPrompt`, `combinedForChat`, meta
  (anchorsInPrompt, seedMode, …) и инструкции howTo

### Requirement: Import external LLM response as suggest draft

Система MUST предоставить `POST /api/ontology/build/suggest/import` с body
`{ text: string, ...suggestOptions }`, парсить JSON concepts (в т.ч. из markdown fence /
частично обрезанный JSON) и возвращать draft **того же shape**, что suggest
(grounding + lift relations), с `source: "external-llm"`.

#### Scenario: Successful import

- **WHEN** text содержит `{"concepts":[...]}` с валидными id
- **THEN** ответ 200 с concepts и groundingCandidates (если depth=concepts+grounding)

#### Scenario: Empty or unparseable text

- **WHEN** text пуст или JSON невосстановим
- **THEN** user-facing error (400/502), без silent heuristic draft
