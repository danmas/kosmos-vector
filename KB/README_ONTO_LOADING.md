# Онтология: загрузка, построение для рабочих проектов

**Назначение:** как устроен онтологический уровень kosmos-vector и **как строить онтологию для рабочего проекта** (не только пилот KOSMOS-VECTOR).

**Актуализация:** 2026-07-11  
**Версия:** 2.10.0+

---

## 1. Зачем это и главная мысль

Онтология — **верхний уровень Базы Знаний**: понятия домена (аукцион, чанк, пайплайн…) с типизированными отношениями и **grounding** (привязкой) к нижнему уровню — коду, таблицам, документам.

| Уровень | Где живёт | Что это |
|--------|-----------|---------|
| **Верх (онтология)** | MD-файлы в git (`concepts/*.md`) | Понятия, отношения, утверждения |
| **Низ (реальность)** | pipeline loaders → PostgreSQL | `ai_item`, чанки, SQL/JS/таблицы |
| **Связь** | секция Grounding + `link` (`onto_*`) | concept → код / таблица / документ |

**Критично для понимания:**

1. **MD — источник истины, PostgreSQL — индекс.** Онтология не «живёт только в БД»: правите файлы в git, загрузчик заливает в PG.
2. **Онтология не строится автоматически из кода** (v0.1). Её пишут люди (черновик может помочь AI), затем загружают и валидируют.
3. **Без grounding понятие — гипотеза** (`status: draft`). `verified` только при непустом Grounding и ревью.
4. **Сначала нижний уровень, потом онтология.** Иначе grounding не к чему привязать.

Спецификация формата: репозиторий `Ontology/` → [`ONTOLOGY_SPEC.md`](../../Ontology/ONTOLOGY_SPEC.md)  
План и принципы: [`ONTOLOGY_PLAN.md`](../../Ontology/ONTOLOGY_PLAN.md)  
Краткая шпаргалка: [`Ontology/README.md`](../../Ontology/README.md)

---

## 2. Как строится онтология для рабочего проекта (пошагово)

Это **канонический workflow** для любого `context-code` (CARL, свой продукт и т.д.).

### Шаг A. Наполнить нижний уровень

1. Создать/выбрать `context-code` и `kb-configs/{CONTEXT}.json` (`rootPath`, masks, loaders кода/SQL/MD/таблиц).
2. Запустить **Step1 → Step2** (`POST /api/pipeline/start?context-code=…`): AI Items, L0, L1-связи.
3. (Рекомендуется) **Step4** — массовые эмбеддинги L0 (`POST /api/pipeline/step/4/run?context-code=…`), чтобы работали обычный RAG и поиск по коду.

Без реальных `ai_item` (функции, таблицы, docs) grounding будет битым или только warning.

### Шаг B. Завести папку понятий

Один файл = одно понятие. Имя: `<id>.md`, `id` — kebab-case латиницей.

```text
MyProject/ontology/concepts/     # или любой путь, доступный серверу
  auction.md
  bid.md
  priority.md
```

Пилот kosmos-vector: `Ontology/concepts/` (рядом с `ONTOLOGY_SPEC.md`).

### Шаг C. Написать понятия по формату

Полный контракт — `ONTOLOGY_SPEC.md`. Минимум:

**Frontmatter:**

```yaml
---
id: auction
name: Аукцион
type: concept
context: CARL              # должен совпадать с context-code загрузки
aspects: [domain]
status: draft              # draft | verified
updated: 2026-07-11
---
```

В БД: `full_name = concept:<id>` (например `concept:auction`).

**Секции (H2):**

| Секция | Обязательность | Содержание |
|--------|----------------|------------|
| Описание | да | 1–3 абзаца сути |
| Атрибуты | нет | таблица свойств |
| Отношения | да | concept → concept |
| Grounding | да для verified | concept → реальность |
| Активности | нет | как агент / как пациент |
| Утверждения | нет | факт/гипотеза + provenance |

**Отношения** (в файле только **прямые** типы; обратные пишет loader):

`part_of`, `uses`, `manages`, `produces`, `consumes`, `precedes`, `related_to`  
→ в БД: `onto_part_of`, `onto_uses`, … + inverse (`onto_has_part`, …).

Пример:

```md
| Тип | Понятие | Комментарий |
|---|---|---|
| uses | concept:bid | |
| part_of | concept:trading | |
```

**Grounding:**

| Роль MD | link_type | Типичная цель |
|---------|-----------|---------------|
| `implemented_in` | `onto_implemented_in` | `full_name` или `file:path#symbol` |
| `stored_in` | `onto_stored_in` | `table:schema.table` |
| `documented_in` | `onto_documented_in` | `doc:…` |
| `configured_in` | `onto_configured_in` | конфиг |

Пример:

```md
| Роль | Цель | Комментарий |
|---|---|---|
| implemented_in | carl_auct._calcAuctPriority | |
| stored_in | table:carl_auct.auction | |
| documented_in | doc:README_AUCTION.md | |
```

### Шаг D. Подключить в kb-config

В `metadata.custom_settings` (YAML-строка) целевого контекста:

```yaml
onto_loading:
  enabled: true
  dirs:
    - C:\path\to\MyProject\ontology\concepts
    # или путь относительно первого rootPath
```

Пример пилота: `kb-configs/KOSMOS-VECTOR.json`.

**Один раз на БД:** миграция типов связей  
`tmp/add_onto_link_types.sql` — иначе loader откажется писать `onto_*` links.

### Шаг E. Загрузить онтологию (Step1)

`onto_loading` обрабатывается в **Step1** (`step1Runner` → `loadOntologyFromDir`):

1. Парсинг всех `*.md` в `dirs`.
2. Кросс-валидация (уникальные id, резолв `concept:…`, циклы `part_of`…).
3. При **ошибках** — загрузка **отменяется** (отчёт в pipeline).
4. Upsert `ai_item` (`type=concept`) + L0-чанк = **весь текст MD** (для semantic search).
5. Перезапись onto-связей: concept↔concept и concept→grounding.
6. Нерезолвящийся grounding: **warning** для `draft`, **error** для `verified`.

Запуск: UI Processing (шаг 1) или API pipeline step 1 / `pipeline/start` (1→2).

### Шаг F. Векторизовать понятия

Без эмбеддингов **concept-first retrieval не находит понятия**.

Варианты:

- `POST /api/pipeline/step/4/run?context-code=…` — массово все невекторизованные L0 (включая concept);
- или точечно vectorize AI items с `fullNames: ["concept:auction", …]`.

**Важно:** перезагрузка онтологии (новый L0-чанк понятия) обычно **обнуляет/требует заново** эмбеддинги этих concept-чанков — после правок MD снова Step4 или vectorize по `concept:*`.

### Шаг G. Validate

```http
GET /api/ontology/validate?context-code=CARL
GET /api/ontology/validate?context-code=CARL&dir=C:\path\to\concepts
```

Отчёт:

| Поле | Смысл |
|------|--------|
| `brokenGrounding` | цель grounding нет в `ai_item` |
| `staleGrounding` | у цели `needs_rebuild = true` |
| `conceptsWithoutGrounding` | гипотезы без привязки |
| `danglingRelations` | `concept:x` в отношениях без ai_item |
| `coverageByType` | сколько class/function/table/… покрыто понятиями |
| `uncoveredSamples` | крупные непокрытые items |
| `fileValidation` | ошибки формата MD (если передан `dir`) |

### Шаг H. Пользоваться

```http
POST /api/ontology/ask?context-code=CARL
Content-Type: application/json

{
  "question": "Как считается приоритет аукциона?",
  "maxConcepts": 3,
  "maxChunks": 8,
  "generateAnswer": true
}
```

Цепочка retrieval:

```text
вопрос → top-K понятий (embedding concept-чанков)
      → onto_* связи + grounding
      → L0-чанки реализации
      → (опц.) LLM-ответ с provenance «понятие → отношение → код»
```

**UI (kosmos-vector-UI):** RAG Test → стратегия **Ontology (concept-first)**; панель concepts + chain.

---

## 3. Как выбирать понятия на рабочем домене

Не «каждой SQL-функции — concept», а **язык домена + якоря в коде**.

1. **10–30 понятий**, о которых говорят аналитики/разработчики (сущность, процесс, артефакт).
2. **Якоря:** публичные API, ключевые таблицы, центральные процедуры/модули.
3. **Отношения:** процесс (`precedes`), состав (`part_of`), использование (`uses`).
4. **Grounding:** 1–N реальных `full_name` / `table:` / `doc:` после Step1.
5. **Итерации:** `validate` → coverage → дописать draft → уточнить grounding → `verified` после ревью.
6. **Контрольные вопросы:** сравнить `/api/ontology/ask` и обычный RAG — где concept-first даёт лучший путь к коду.

Автопокрытия всех `ai_item` понятиями **нет**. `coverage*` — сигнал «что ещё описать», не задача генератора.

План работ (пилот kosmos-vector → второй домен): `Ontology/ONTOLOGY_PLAN.md`, этап 5.

---

## 4. Чеклист нового проекта

- [ ] Нижний уровень: Step1 + Step2 для `context-code`
- [ ] (Рекомендуется) Step4 для кода
- [ ] Папка `concepts/*.md` по `ONTOLOGY_SPEC.md`
- [ ] `context` во frontmatter = `context-code`
- [ ] `onto_loading.enabled` + `dirs` в kb-config
- [ ] Миграция `tmp/add_onto_link_types.sql` выполнена
- [ ] Step1 (загрузка ontology)
- [ ] Векторизация concept / Step4
- [ ] `GET /api/ontology/validate` без критичных ошибок
- [ ] 3–5 контрольных вопросов через `/api/ontology/ask` или UI Ontology
- [ ] `verified` только после human-review + непустой Grounding

---

## 5. Техническая реализация (куда смотреть в коде)

| Компонент | Путь |
|-----------|------|
| Loader | `routes/loaders/ontoLoader.js` |
| Включение в pipeline | `routes/pipeline/step1Runner.js` → `parseOntoLoadingConfig`, `loadOntologyFromDir` |
| Validate + Ask API | `routes/ontology.js` (mount: `/api/ontology`) |
| Массовая векторизация | `routes/pipeline/step4Vectorize.js` |
| Миграция link_type | `tmp/add_onto_link_types.sql` |
| Пример kb-config | `kb-configs/KOSMOS-VECTOR.json` |
| UI strategy Ontology | `kosmos-vector-UI/components/RAGTestDialog.tsx`, `apiClient.ontologyAsk` |

**Запись в БД:**

- `ai_item`: `type='concept'`, `full_name='concept:<id>'`, `s_name=id`, `h_name=name`
- `chunk_vector`: L0, `type='concept'`, текст = raw MD
- `link` + `link_type` с кодами `onto_*`

### 5.1 Правила резолва grounding-целей (resolveGroundingTarget)

Как загрузчик превращает цель из MD в `full_name` реального `ai_item`:

| Формат цели | Правило резолва |
|-------------|-----------------|
| `doc:<файл>` | точное совпадение full_name ИЛИ любая секция `doc:<файл>#...` (если документ начинается с H1, item `doc:<файл>` без секции не существует) |
| `table:<schema.table>` | точное совпадение full_name (без префикса `table:`) |
| `file:<путь>#<символ>` | точное имя символа или суффикс full_name; **при ≥2 кандидатах — не резолвится** (в warning перечисляются кандидаты) |
| `file:<путь>` без символа | (1) item по имени файла без расширения (модуль/класс: `EmbeddingsFactory.js` → `EmbeddingsFactory`); (2) иначе файл в `kosmos.files`; (3) иначе warning |
| голый `full_name` | точное совпадение в контексте |

При успешном резолве в `link.target` пишется **найденный** full_name (цель может отличаться от строки в MD); при неуспехе — исходная строка (протухание потом ловит validate).

---


---

## 5.2 Построитель онтологии (Step 6)

Интерактивный цикл **suggest → review → materialize → apply**, а не batch-runner.

### Зачем

Автоматический черновик понятий из **уже векторизованной** реальности (после Step4), с grounding-кандидатами и подъёмом L1-связей до отношений понятий. Человек правит черновик; MD остаётся source of truth (`status: draft` до review).

### Место в петле

```text
Step1/2 (реальность) → Step4 (векторы)
        → Step6 Ontology Builder (suggest/materialize/apply)
        → onto_loading (повтор) + vectorize concept:*
        → validate / ask
```

Шаг 6 **не занимает** слот enrichment (id 3). В pipeline-definition: `{ id: 6, name: ontology_builder }`.

### API

| Метод | Назначение |
|-------|------------|
| `POST /api/ontology/build/suggest?context-code=` | read-only черновик (maxConcepts, depth, seedConcepts, aspects) |
| `POST /api/ontology/build/materialize?context-code=` | пишет `concepts/<id>.md` в первую `onto_loading.dirs` (`status: draft`); конфликт id → 409 без overwrite |
| `POST /api/ontology/build/apply?context-code=` | materialize → onto_loading → force vectorize `concept:*` → validate; ошибка загрузки обрывает |
| `GET /api/ontology/build/status?context-code=` | снимок для карточки шага 6 (gate Step4, счётчики) |

**Гейт:** suggest/apply отвечают 409, если нет векторизованных non-concept items.

### UI

В `kosmos-vector-UI`: карточка Step 6 в PipelineView открывает `OntologyBuilderDialog` (не `runPipelineStep`).

### Важно

- suggest **не пишет** файлы и БД.
- После apply concept-чанки **обязательно** перевекторизуются (`force` + filter concept).
- `verified` только вручную после review.


## 6. Чего нет в v0.1 (сознательно)

- Автогенерация онтологии из AST/кода  
- Reasoner / иерархия классов понятий  
- Исполняемая логика «Активностей»  
- Отдельный индекс атрибутов (они внутри L0-текста понятия)
- Инкрементальность на уровне набора понятий: при каждой загрузке набор перезаписывается целиком (upsert + пересоздание onto-связей), **эмбеддинги concept-чанков обнуляются**; исчезнувшие из папки понятия из БД автоматически НЕ удаляются (вручную или полной перезагрузкой)

См. `ONTOLOGY_SPEC.md` §9, `ONTOLOGY_PLAN.md` «Отложено».

---

## 7. Схема потока (одной картинкой)

```text
[Домен / эксперты]
        │  пишут MD по SPEC
        ▼
 concepts/*.md  (git = source of truth)
        │  onto_loading + Step1
        ▼
 ai_item(concept) + onto_* links + L0 MD-chunk
        │  Step4 / vectorize
        ▼
 validate ──► ontology/ask ──► ответ с цепочкой к коду
                    ▲
                    │  grounding
              ai_item (код, таблицы, docs)
```

---

## Связанная документация

- [`README_LOADING_FILES.md`](./README_LOADING_FILES.md) — общий pipeline Step1/Step2/Step4  
- [`README_AI_ITEM_COMPLETE.md`](./README_AI_ITEM_COMPLETE.md) — модель AiItem  
- [`README_links.md`](./README_links.md) — граф связей L1  
- [`README_INDEX.md`](./README_INDEX.md) — оглавление KB  
- `Ontology/ONTOLOGY_SPEC.md` — формат MD  
- `Ontology/ONTOLOGY_PLAN.md` — этапы внедрения  
- `Ontology/README.md` — краткая шпаргалка  
- `CHANGELOG.md` §2.10.0 — релиз онтологии  
- `docs/README_Frontend_RAG_Integration.md` — RAG (классический); Ontology — отдельный API/стратегия UI  
