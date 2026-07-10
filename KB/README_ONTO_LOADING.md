# Загрузка онтологии (onto-loader)

**Версия:** 1.0 (2026-07-10)
**Спецификация формата понятий:** `../../Ontology/ONTOLOGY_SPEC.md`

## Назначение

Онтология — верхний уровень знаний: понятия домена с типизированными отношениями и привязкой (grounding) к нижнему уровню (ai_items: код, таблицы, документы). Источник истины — MD-файлы понятий в репозитории; загрузчик переносит их в PostgreSQL.

## Модель данных

- Понятие → `ai_item` с `type='concept'`, `full_name = concept:<id>`
- Текст понятия → L0-чанк (`type='concept'`, `level='0-исходник'`) с эмбеддингом на Step2
- Отношения понятие→понятие → `link` с типами `onto_part_of`, `onto_uses`, `onto_manages`, `onto_produces`, `onto_consumes`, `onto_precedes`, `onto_related_to` (+ автоматические обратные: `onto_has_part`, `onto_used_by` и т.д.)
- Grounding понятие→реальность → `link` с типами `onto_implemented_in`, `onto_stored_in`, `onto_documented_in`, `onto_configured_in`

## Настройка

### 1. Миграция БД (один раз)

```bash
psql -U postgres -d your_db -f tmp/add_onto_link_types.sql
```

### 2. Конфигурация kb-config

В `metadata.custom_settings` (YAML):

```yaml
onto_loading:
  enabled: true
  dirs:
    - C:\ERV\projects-ex\Ontology\concepts   # абсолютный путь или относительный к первому rootPath
```

## Поведение загрузчика

Реализация: `routes/loaders/ontoLoader.js`, врезка в `routes/pipeline/step1Runner.js` (задача типа `onto`).

1. Читает все `*.md` из каждой директории `dirs`.
2. Парсит frontmatter и секции, валидирует ВЕСЬ набор до записи:
   - уникальность `id` в контексте;
   - резолв ссылок `concept:<id>`;
   - допустимость типов отношений и ролей grounding;
   - отсутствие циклов `part_of`;
   - `status: verified` требует непустой Grounding.
3. При любой ошибке валидации набор НЕ загружается (отчёт в `report.details.ontology`).
4. При успехе: создаёт ai_items, L0-чанки, прямые и обратные связи, grounding-связи.
5. Grounding-цели резолвятся в существующие ai_items:
   - `doc:<файл>` — точное совпадение full_name;
   - `table:<schema.table>` — точное совпадение;
   - `file:<путь>#<символ>` — по символу (точно или суффиксом); неоднозначность = не резолвится;
   - нерезолвящиеся цели: warning для draft, error для verified; связь пишется в любом случае.

## table_loading.source (для grounding на собственные таблицы)

Чтобы цели `table:kosmos.*` резолвились, таблицы собственной БД сервера должны быть загружены как ai_items. По умолчанию table-loader читает **клиентскую** БД через pg-mcp (`source: client`). Для чтения собственной БД сервера (PGHOST/PGDATABASE из .env):

```yaml
table_loading:
  enabled: true
  source: self      # client (по умолчанию) | self
  schema: kosmos
```

## Валидация: GET /api/ontology/validate

Реализация: `routes/ontology.js`. Параметры: `context-code` (обязателен), `dir` (опционально — путь к папке понятий для файловой валидации без загрузки).

Проверки по БД: `brokenGrounding` (цель не резолвится), `staleGrounding` (у цели needs_rebuild=true), `conceptsWithoutGrounding`, `danglingRelations`, `coverageByType` + `uncoveredSamples` (top-20 непокрытых понятиями class/table/md_doc по числу чанков). `summary.ok = true`, если нет битого grounding, висячих отношений и файловых ошибок.

```powershell
Invoke-RestMethod "http://localhost:3005/api/ontology/validate?context-code=KOSMOS-VECTOR&dir=C:\ERV\projects-ex\Ontology\concepts"
```

## Concept-first retrieval: POST /api/ontology/ask

Реализация: `routes/ontology.js`. Query: `context-code`. Body: `{ question, maxConcepts=3, maxChunks=8, generateAnswer=true }`.

Алгоритм: вопрос → эмбеддинг → ближайшие понятия (чанки type='concept') → их отношения и grounding-связи → L0-чанки заземлённых items, ранжированные по близости к вопросу → контекст «понятия + связи + реальность» → ответ через callLLM (или `contextText` при `generateAnswer=false`). Ответ содержит `concepts` (с similarity), `chain` (понятие → отношение → цель) и `chunks` (источники).

```powershell
Invoke-RestMethod -Method POST "http://localhost:3200/api/ontology/ask?context-code=KOSMOS-VECTOR" -ContentType 'application/json' -Body (@{ question = 'Как чанки связаны с AI Items и где они хранятся?' } | ConvertTo-Json)
```

## Отчёт

В `report.details.ontology[]`: `filesFound, conceptsLoaded, linksCreated, groundingResolved, groundingUnresolved, errors[], warnings[]`.

## Ограничения v1.0

- Инкрементальность на уровне набора (набор перезаписывается через ON CONFLICT DO UPDATE, без удаления исчезнувших понятий — удаление вручную или полной перезагрузкой).
- Атрибуты и Утверждения не индексируются отдельно — ищутся семантически через L0-чанк.
- Протухание grounding (`needs_rebuild` → `stale_grounding`) — план Этапа 3, см. `../../Ontology/ONTOLOGY_PLAN.md`.
