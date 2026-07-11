# Spec delta: ontology-builder (backend)

## ADDED Requirements

### Requirement: Suggest ontology draft from vectorized reality

Система ДОЛЖНА предоставлять эндпоинт `POST /api/ontology/build/suggest?context-code=…`,
который анализирует уже загруженную и векторизованную реальность контекста и возвращает
**черновик** онтологии без записи каких-либо файлов или строк БД.

Входные параметры (body): `maxConcepts` (default 20, диапазон 10–30), `aspects`
(фильтр, напр. `[domain]`), `seedConcepts` (список существующих `concept:*` для
дополнения, не дублирования), `depth` (`concepts` | `concepts+grounding`, default
`concepts+grounding`).

Ответ ДОЛЖЕН содержать список кандидатов-понятий, каждый с: `id` (kebab-case латиницей),
`name`, `rationale`, `aspects`, предлагаемыми `relations` (только прямые типы
`part_of|uses|manages|produces|consumes|precedes|related_to`) и, при
`depth=concepts+grounding`, списком `groundingCandidates` с `role`
(`implemented_in|stored_in|documented_in|configured_in`), `target` (реальный
`full_name` / `table:` / `doc:`), `confidence` и `source` (чем обоснован кандидат).

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

Система ДОЛЖНА предоставлять эндпоинт
`POST /api/ontology/build/materialize?context-code=…`, который принимает
отредактированный человеком черновик и пишет `concepts/<id>.md` в первую директорию из
`onto_loading.dirs` целевого контекста, строго по формату `ONTOLOGY_SPEC.md`.

Все создаваемые понятия ДОЛЖНЫ иметь `status: draft` и `context`, равный `context-code`.

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

Система ДОЛЖНА предоставлять эндпоинт `POST /api/ontology/build/apply?context-code=…`,
который для удобства «одного-двух заходов» последовательно выполняет: materialize
(если передан черновик) → onto_loading (Step1 только по онтологии) → векторизацию
`concept:*` (Step4 точечно) → `validate`, и возвращает **сводный отчёт** каждого этапа.

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
