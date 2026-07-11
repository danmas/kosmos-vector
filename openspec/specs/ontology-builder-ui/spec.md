# ontology-builder-ui

## Purpose

UI построителя онтологии в `../kosmos-vector-UI`: диалог итерационной петли, карточка
Step 6 в ленте pipeline, клиент API и типы. Backend-контракт — в `ontology-builder`.

## Requirements

### Requirement: Ontology Builder dialog

UI ДОЛЖЕН предоставлять компонент `OntologyBuilderDialog` (`components/OntologyBuilderDialog.tsx`),
реализующий итерационную петлю построения онтологии за один-два захода:
конфиг → suggest → ревью кандидатов → materialize → apply → отчёт.

#### Scenario: Конфигурация и запрос черновика

- **WHEN** пользователь открывает диалог и задаёт `maxConcepts`, `aspects`, `seedConcepts`,
  `depth` и жмёт «Предложить»
- **THEN** UI вызывает `apiClient.ontologyBuildSuggest(...)` и показывает таблицу
  кандидатов-понятий с их `rationale`, отношениями и grounding-кандидатами

#### Scenario: Ревью и правка кандидатов

- **WHEN** отображён черновик
- **THEN** пользователь может принять/отклонить каждое понятие, отредактировать `id`/`name`,
  добавить/удалить отношения и grounding-цели, увидеть `confidence` и `source` каждого
  grounding-кандидата
- **AND** неоднозначные grounding-цели визуально помечены и требуют выбора перед
  materialize

#### Scenario: Материализация и применение петли

- **WHEN** пользователь подтверждает отобранные понятия
- **THEN** «Записать» вызывает `apiClient.ontologyBuildMaterialize(...)` и показывает
  список записанных `concepts/*.md` и diff
- **AND** «Применить» вызывает `apiClient.ontologyBuildApply(...)` и показывает сводный
  отчёт загрузки, векторизации понятий и validate

#### Scenario: Coverage ведёт к следующему заходу

- **WHEN** получен отчёт validate с `coverageByType` и `uncoveredSamples`
- **THEN** UI показывает, что ещё не покрыто, и позволяет вернуться к шагу suggest с
  этими понятиями как `seedConcepts` (второй заход петли)

### Requirement: Pipeline Step 6 card opens builder

`components/PipelineView.tsx` ДОЛЖЕН отрисовывать карточку шага 6 «Ontology Builder»
из `context-definition`; действие карточки открывает `OntologyBuilderDialog`, а не
обычный `runPipelineStep`.

#### Scenario: Открытие построителя из ленты шагов

- **WHEN** пользователь нажимает карточку шага 6
- **THEN** открывается `OntologyBuilderDialog` (не отправляется прямой запуск раннера)
- **AND** карточка отражает статус построителя (число понятий, наличие проблем grounding)

#### Scenario: Шаг 6 заблокирован без векторизации

- **WHEN** Step4 для контекста не завершён
- **THEN** карточка шага 6 показана как заблокированная с подсказкой «сначала
  векторизация»

### Requirement: apiClient methods and types for builder

`services/apiClient.ts` ДОЛЖЕН предоставлять методы `ontologyBuildSuggest`,
`ontologyBuildMaterialize`, `ontologyBuildApply`, а `types.ts` — типы запросов/ответов
(`OntologyBuildSuggestRequest/Response`, кандидат понятия, grounding-кандидат,
`OntologyBuildApplyResponse`).

#### Scenario: Типизированные вызовы

- **WHEN** вызывается любой из трёх методов
- **THEN** запрос уходит на соответствующий `/api/ontology/build/*` с `context-code`,
  а ответ типизирован (без `any` в публичной сигнатуре)
