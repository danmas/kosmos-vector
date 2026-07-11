# Change: add-ontology-builder

## Why

Сегодня понятия онтологии пишутся полностью вручную: человек создаёт `concepts/*.md`,
сам подбирает grounding-цели (`full_name` / `table:` / `doc:`) и отношения. Загрузка
(`onto_loading` в Step1) и валидация есть, а **построения нет** — это самый дорогой и
медленный этап входа нового домена (см. `KB/README_ONTO_LOADING.md`, раздел «Чего нет
в v0.1»).

Нужен **полуавтомат-построитель**: он опирается на уже загруженную и векторизованную
реальность, предлагает черновик понятий с кандидатами grounding и отношений, человек
правит за один-два захода, после чего работает существующая петля
загрузка → векторизация → валидация.

Ключевой архитектурный факт (определяет размещение): в лестнице шагов
(`pipelineConfigService.js`) слоты 1–5 уже заняты — 3 это `enrichment (L2)`, 5 это
`indexing`. Построитель питается результатом векторизации, поэтому он **не может стоять
до Step4** и не должен занимать слот 3. Он добавляется как **Step 6: Ontology Builder**
и работает как итерационная петля поверх готового низа, а не как линейный авто-раннер.

## What Changes

- **NEW** capability `ontology-builder` (backend): эндпоинты
  `POST /api/ontology/build/suggest`, `POST /api/ontology/build/materialize`,
  `POST /api/ontology/build/apply`. `suggest` анализирует векторизованную реальность и
  возвращает черновик (понятия + grounding-кандидаты + отношения) **без записи**;
  `materialize` пишет одобренные `concepts/*.md` (`status: draft`); `apply` замыкает
  петлю (materialize → onto_loading → векторизация `concept:*` → validate) и отдаёт
  сводный отчёт.
- **MODIFIED** capability `ontology-pipeline`: в лестницу добавляется **Step 6
  `ontology_builder`**; шаг доступен только после успешного Step4; статус шага =
  сводка последнего build/validate. Петля перезагрузки понятий обязана заново
  векторизовать `concept:*` (иначе concept-first retrieval теряет правки).
- **NEW** capability `ontology-builder-ui` (`../kosmos-vector-UI`): диалог
  `OntologyBuilderDialog` (конфиг → suggest → ревью-таблица кандидатов → materialize →
  apply → отчёт validate + coverage), карточка Step 6 в `PipelineView`, методы
  `apiClient`, типы.

## Impact

- Backend: `routes/ontology.js` (+build-роуты), новый
  `routes/ontology/ontologyBuilder.js`, `packages/core/pipelineConfigService.js`
  (Step 6 в дефолтных определениях), переиспользование `ontoLoader.js`,
  `step4Vectorize.js`, `validateOntology`.
- UI (`../kosmos-vector-UI`): `components/OntologyBuilderDialog.tsx` (new),
  `components/PipelineView.tsx`, `services/apiClient.ts`, `types.ts`.
- Docs: `KB/README_ONTO_LOADING.md` (раздел построителя), `CHANGELOG.md`,
  `docs/api-contract.yaml`.
- Данные: только запись `concepts/*.md` (draft) + существующие onto-таблицы. Новых
  таблиц нет. `verified` по-прежнему только после human-review.
