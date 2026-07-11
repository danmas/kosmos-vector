# ontology-builder

## Purpose

Полуавтомат построения онтологии: анализирует уже загруженную и **векторизованную**
реальность контекста и помогает получить черновик понятий (`concept:*`) с кандидатами
grounding и отношений за один-два захода. Черновик правит человек; запись идёт в
`concepts/*.md` (`status: draft`), после чего работает петля загрузка → векторизация →
валидация. Зависит от `ontology-pipeline` (Step 6, гейт Step4).
## Requirements
### Requirement: Suggest ontology draft from vectorized reality

The system MUST provide endpoint `POST /api/ontology/build/suggest?context-code=…`,
which analyzes already loaded and vectorized context reality and returns an ontology
**draft** without writing any files or DB rows.

Входные параметры (body): `maxConcepts` (default 20, диапазон 10–30), `aspects`
(фильтр, напр. `[domain]`), `seedConcepts` (список существующих `concept:*` для
дополнения, не дублирования), `depth` (`concepts` | `concepts+grounding`, default
`concepts+grounding`).

The response MUST contain a list of concept candidates, each with: `id` (kebab-case
Latin), `name`, `rationale`, `aspects`, proposed `relations` (only direct types
`part_of|uses|manages|produces|consumes|precedes|related_to`) and, when
`depth=concepts+grounding`, a list of `groundingCandidates` with `role`
(`implemented_in|stored_in|documented_in|configured_in`), `target` (real
`full_name` / `table:` / `doc:`), `confidence` and `source` (why the candidate).

#### Scenario: Кандидаты понятий из кластеров кода

- **WHEN** вызван `suggest` для контекста, где Step4 завершён и есть векторизованные
  `ai_item` без покрытия понятиями
- **THEN** ответ содержит от 1 до `maxConcepts` кандидатов, отсортированных по значимости
  (якоря: публичные API, центральные таблицы по входящей степени L1, high-fan модули,
  доменные термины из doc-чанков)
- **AND** ни один `concept:*`, уже присутствующий в `seedConcepts`, не дублируется как
  новый кандидат

#### Scenario: Grounding-кандидаты с обоснованием

- **WHEN** `depth=concepts+grounding` и для понятия найдены близкие по эмбеддингу
  `ai_item`
- **THEN** каждый `groundingCandidate.target` резолвится существующим
  `resolveGroundingTarget` в реальный `full_name` (при ≥2 равнозначных кандидатах цель
  помечается неоднозначной, а не выбирается вслепую)
- **AND** каждый кандидат имеет `confidence` в диапазоне 0..1 и человекочитаемый `source`

#### Scenario: Реальность не готова

- **WHEN** для контекста нет векторизованных `ai_item` (Step4 не выполнялся)
- **THEN** система возвращает ошибку с кодом, объясняющим, что нужно сначала выполнить
  Step1–2 и Step4, и НЕ возвращает пустой черновик как успех

#### Scenario: Suggest не пишет состояние

- **WHEN** `suggest` завершается успешно
- **THEN** ни один файл `concepts/*.md` не создан/изменён и ни одна строка
  `ai_item` / `link` / `chunk_vector` не записана

### Requirement: Materialize approved draft to concept files

The system MUST provide endpoint
`POST /api/ontology/build/materialize?context-code=…`, which accepts a human-edited
draft and writes `concepts/<id>.md` into the first directory from
`onto_loading.dirs` of the target context, strictly per `ONTOLOGY_SPEC.md` format.

All created concepts MUST have `status: draft` and `context` equal to `context-code`.

#### Scenario: Запись валидных MD-файлов

- **WHEN** передан черновик из N одобренных понятий
- **THEN** создаётся ровно N файлов `<id>.md` с frontmatter (`id`, `name`, `type:
  concept`, `context`, `aspects`, `status: draft`, `updated`) и секциями H2 (Описание,
  Отношения, Grounding при наличии кандидатов)
- **AND** ответ содержит список записанных путей и diff-предпросмотр

#### Scenario: Отказ при конфликте id

- **WHEN** одобренный `id` уже существует как файл понятия, а флаг `overwrite` не задан
- **THEN** система не перезаписывает файл и возвращает конфликт с перечнем
  затронутых id

#### Scenario: Draft не повышается до verified автоматически

- **WHEN** materialize пишет понятие с непустым Grounding
- **THEN** `status` остаётся `draft` (повышение до `verified` возможно только вручную
  после ревью)

### Requirement: Apply ontology loop in one call

The system MUST provide endpoint `POST /api/ontology/build/apply?context-code=…`,
which for a one-or-two-pass convenience flow sequentially runs: materialize
(if a draft is provided) → onto_loading (Step1 ontology only) → vectorize
`concept:*` (targeted Step4) → `validate`, and MUST return a **summary report**
for each stage.

#### Scenario: Замыкание петли и повторная векторизация понятий

- **WHEN** вызван `apply` после правки понятий
- **THEN** concept-чанки перезагружаются и **обязательно** повторно векторизуются
  (по `concept:*`), чтобы concept-first retrieval видел правки
- **AND** итоговый отчёт содержит результат validate (`brokenGrounding`,
  `staleGrounding`, `conceptsWithoutGrounding`, `coverageByType`, `uncoveredSamples`)

#### Scenario: Ошибка загрузки прерывает применение

- **WHEN** onto_loading падает на кросс-валидации (дубли id, циклы `part_of`,
  нерезолвящийся grounding у `verified`)
- **THEN** `apply` прекращается на этапе загрузки, отдаёт отчёт загрузчика и НЕ
  векторизует и НЕ помечает петлю успешной

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

