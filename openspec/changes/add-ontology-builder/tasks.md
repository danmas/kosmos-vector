# Tasks: add-ontology-builder

## 1. Backend — pipeline definition

- [x] 1.1 Добавить Step 6 `{ id: 6, name: 'ontology_builder', label: 'Ontology Builder' }`
      в `packages/core/pipelineConfigService.js` (`getDefaultStepDefinitions`, при
      необходимости `getDefaultPipelineConfig`)
- [x] 1.2 Убедиться, что `GET /api/pipeline/context-definition` и `steps/status`
      возвращают шаг 6; статус = сводка последнего build/validate
- [x] 1.3 Гейт: suggest/apply отказывают, если Step4 не завершён для контекста

## 2. Backend — builder core

- [x] 2.1 `routes/ontology/ontologyBuilder.js`: генерация кандидатов понятий
      (кластеризация непокрытых `ai_item` по эмбеддингу, якоря по L1/doc-термам, LLM-лейблинг)
- [x] 2.2 Grounding-кандидаты: ближайшие `ai_item` + обратный `resolveGroundingTarget`,
      `confidence`, `source`, пометка неоднозначных
- [x] 2.3 Подъём L1-связей до отношений понятий (`uses`/`part_of`/`precedes`)
- [x] 2.4 Сериализация черновика в MD по `ONTOLOGY_SPEC.md` (frontmatter + H2-секции,
      `status: draft`)

## 3. Backend — endpoints (routes/ontology.js)

- [x] 3.1 `POST /api/ontology/build/suggest` — read-only, отдаёт черновик
- [x] 3.2 `POST /api/ontology/build/materialize` — пишет `concepts/*.md` в первую
      `onto_loading.dirs`, конфликт id без `overwrite` → 409
- [x] 3.3 `POST /api/ontology/build/apply` — materialize → onto_loading (Step1) →
      векторизация `concept:*` (Step4) → `validate`, сводный отчёт; ошибка загрузки
      прерывает петлю
- [x] 3.4 Гарантировать повторную векторизацию `concept:*` в apply

## 4. UI (../kosmos-vector-UI)

- [x] 4.1 `services/apiClient.ts`: `ontologyBuildSuggest`, `ontologyBuildMaterialize`,
      `ontologyBuildApply`
- [x] 4.2 `types.ts`: типы запросов/ответов (кандидат понятия, grounding-кандидат,
      отчёт apply)
- [x] 4.3 `components/OntologyBuilderDialog.tsx`: конфиг → suggest → ревью-таблица →
      materialize → apply → отчёт validate + coverage; повторный заход через `seedConcepts`
- [x] 4.4 `components/PipelineView.tsx`: карточка шага 6 открывает диалог (не runner);
      блокировка без Step4; статус построителя
- [x] 4.5 (Опц.) переиспользовать concept-chain viewer из `RAGTestDialog.tsx` для
      предпросмотра grounding

## 5. Docs

- [x] 5.1 `KB/README_ONTO_LOADING.md`: раздел «Построитель (Step 6)» + место в петле
- [x] 5.2 Строка в `KB/README_INDEX.md`, запись в `CHANGELOG.md`, строка в корневом
      `README.md`
- [x] 5.3 `docs/api-contract.yaml`: три `/api/ontology/build/*` эндпоинта

## 6. Verification

- [x] 6.1 suggest на пилоте `KOSMOS-VECTOR` не пишет состояние (проверка БД/git до/после)
- [x] 6.2 apply замыкает петлю, `validate` без критичных ошибок; concept-first `ask`
      находит новые понятия (значит векторизация прошла)
- [x] 6.3 Тесты в `tests/` для трёх эндпоинтов (гейт Step4, конфликт id, прерывание при
      ошибке загрузки)
- [x] 6.4 UI smoke: карточка шага 6 → диалог → полный заход на пилоте
