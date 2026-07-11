# ontology-pipeline

## Purpose

Размещение построителя онтологии в лестнице шагов pipeline и правила его доступности и
статуса. Собственно построение описано в `ontology-builder`.

## Requirements

### Requirement: Ontology Builder as pipeline Step 6

Лестница шагов (`pipelineConfigService.js` → `getDefaultStepDefinitions()`) ДОЛЖНА
включать шаг `{ id: 6, name: 'ontology_builder', label: 'Ontology Builder' }`. Слоты
1–5 (parsing, dependencies, enrichment, vectorization, indexing) НЕ переиспользуются
под построитель.

#### Scenario: Шаг присутствует в определениях

- **WHEN** UI запрашивает `GET /api/pipeline/context-definition`
- **THEN** ответ содержит шаг с `id: 6`, `name: 'ontology_builder'`,
  `label: 'Ontology Builder'` и описанием, что это итерационный построитель поверх
  векторизованной реальности

#### Scenario: Построитель не занимает слот enrichment

- **WHEN** проверяется определение шага 3
- **THEN** шаг 3 остаётся `enrichment (L2)`, а построитель имеет отдельный `id: 6`

### Requirement: Builder gated on vectorization

Step 6 ДОЛЖЕН быть доступен (для запуска suggest/apply) только после успешного Step4
для того же контекста; иначе построитель отказывает с понятной причиной.

#### Scenario: Блокировка до векторизации

- **WHEN** Step4 для контекста не завершён и вызывается suggest/apply
- **THEN** система возвращает ошибку «требуется Step4», а статус шага 6 отражает
  «заблокирован: нет векторизации»

### Requirement: Builder step status reflects last build/validate

Статус Step 6 в `GET /api/pipeline/steps/status` ДОЛЖЕН отражать сводку последнего
запуска построителя: число понятий (`draft`/`verified`), результат последнего validate
(есть ли `brokenGrounding`/`staleGrounding`), время. Построитель НЕ помечается
`completed` как одноразовый линейный шаг — это повторяемая петля.

#### Scenario: Сводка после apply

- **WHEN** `apply` завершился с непустым отчётом validate
- **THEN** статус шага 6 содержит счётчики понятий и флаг наличия проблем grounding,
  и остаётся перезапускаемым (не «финальный»)
