# Обзор проекта KOSMOS‑VECTOR / AIAN Vector

## 1. Что это за проект

**KOSMOS‑VECTOR (AIAN Vector)** — это полноценный RAG‑сервер для **семантического поиска и анализа кодовых баз и документации**.

Основная идея:

- автоматически сканировать проекты (JS/TS, PHP, SQL, Markdown, TXT и др.),
- разбивать их на **семантические чанки** (функции, классы, таблицы, процедуры, секции),
- считать эмбеддинги и сохранить их в PostgreSQL с расширением **pgvector**,
- предоставить **REST API + веб‑UI** для:
  - семантического поиска по коду,
  - просмотра структурированных сущностей (**AI Items**),
  - управления метаданными чанков, тегами, связями,
  - получения RAG‑ответов через внешние LLM‑сервисы.

Фактически, это **инфраструктурный слой контекста для AI‑агентов и разработчиков**.

---

## 2. Общая архитектура

По `README_about.md` и `KB/README_TECH.md`:

### Технологический стек

- **Bun** — рантайм и пакетный менеджер.
- **Node.js / Express** — основной веб‑сервер (`server.js`).
- **PostgreSQL + pgvector** — хранилище файлов, чанков и AI‑элементов.
- **LangChain** — абстракция для эмбеддингов и векторного стора.
- Внешние AI‑сервисы:
  - локальный сервис эмбеддингов (`simple-service`),
  - OpenAI‑эмбеддинги (`openai-service`, `text-embedding-ada-002`),
  - отдельный AI‑сервер для RAG‑ответов (`REQ_SERVER_URL`),
  - сервис Gemini для анализа логики (Logic Architect).

### Структура репозитория (важное)

- `packages/core/` — ядро:
  - `DbService.js` — слой работы с PostgreSQL/pgvector.
  - `PostgresVectorStore.js` — обёртка VectorStore поверх PG.
  - `EmbeddingsFactory.js`, `SimpleEmbeddings.js` — фабрика и локальные эмбеддинги.
  - `textSplitters.js` — разбиение текста/кода на чанки.
  - `vectorOperations.js` — высокоуровневые операции векторизации.
  - `kbConfigService.js` — работа с конфигами KB (`kb-configs/*.json`).
  - `llmClient.js`, `promptsService.js`, `naturalQueryPrompts.js` — интеграция с LLM.
- `server.js` — Express‑сервер, который поднимает REST API и UI.
- `routes/` — модули роутов: `ai.js`, `files.js`, `pipeline`, `prompts` и т.д.
- `kb-configs/` — конфиги баз знаний по `context-code`.
- `KB/` — внутренняя документация (основная база знаний по проекту).
- `docs/` — дополнительные спеки (REST‑контракт, Logic Architect, новые фичи).
- `tests/` — тестовые сценарии для пайплайнов и API.

---

## 3. Конфигурация Knowledge Base и поддержка нескольких проектов

По `KB/README_TECH.md`:

Каждая логическая база знаний задаётся файлом `./kb-configs/{context-code}.json` и обслуживается `kbConfigService`.

### Ключевые поля конфига

- `rootPath` — один или **несколько** корней проектов, например:
  - `"C:\\project\\backend,C:\\project\\frontend,D:\\shared\\libs"`.
- `includeMask` — glob для выбора файлов (`**/*.sql`, `**/*.{js,ts,php,md}`).
- `ignorePatterns` — паттерны игнора (`**/node_modules/**`, `**/dist/**` и т.п.).
- `fileSelection` — точный список выбранных файлов (`{rootPath}\./relative/path`).
- `metadata` — метаданные проекта, включая `custom_settings` (YAML).

### Поведение UI и пайплайна

1. `GET /api/project/tree?context-code=...`
   - Строит дерево файлов.
   - Один корневой узел на каждый `rootPath`.
   - Флаги `selected` определяются по `includeMask`.
   - `ignorePatterns` полностью скрывают файлы/папки.

2. Пайплайн векторизации:
   - Если `fileSelection` **не пустой** → обрабатываются только эти файлы.
   - Если пустой → сканируются все `rootPath` по `includeMask` с учётом `ignorePatterns`.
   - Пути нормализуются через `parseRootPaths()` и `parseFileSelectionPath()`.

### Основные эндпоинты

- `GET /api/kb-config?context-code=...`
- `POST /api/kb-config?context-code=...`
- `GET /api/project/tree?context-code=...`
- `POST /api/project/selection?context-code=...`

Это позволяет поддерживать **мульти‑проектные конфигурации** в рамках одной базы знаний через `context-code`.

---

## 4. Схема БД и хранилище векторов

По `KB/README_DB-VECTOR.md`:

### Основные таблицы

#### 1. `files` — документы

- `id UUID PK`
- `context_code TEXT NOT NULL`
- `filename TEXT`
- `file_url TEXT`
- `content TEXT` (опционально)
- `modified_at`, `created_at`

#### 2. `chunk_vector` — чанки с эмбеддингами (все уровни L0/L1/L2)

- `id UUID PK`
- `file_id UUID NOT NULL → files (ON DELETE CASCADE)`
- `embedding VECTOR(1536)`
- `chunk_content JSONB NOT NULL` (основное содержимое чанка)
- `chunk_index INTEGER`
- `content JSONB` (дополнительные/legacy данные)
- `type TEXT default 'текст'` (тип чанка)
- `level TEXT default '0-исходник'` (уровень иерархии)
- `parent_chunk_id UUID → chunk_vector`
- `s_name`, `h_name`, `full_name`
- `ai_item_id INTEGER → ai_item`
- таймстемпы

#### 3. `ai_item` — сущности кода (функции, классы, таблицы и т.д.)

- `id SERIAL PK`
- `full_name TEXT NOT NULL`
- `context_code TEXT NOT NULL`
- `type`, `s_name`, `h_name`
- `file_id UUID NOT NULL → files`
- `UNIQUE(full_name, context_code)`

#### 4. `ai_comment` — текстовые комментарии к AI‑элементам

- `(context_code, full_name)` уникальны

#### 5. `link_type` / `link` — граф связей между AI‑элементами

- `link_type` — справочник типов (code, label, description, is_active)
- `link` — ребра: `context_code`, `source`, `target`, `link_type_id`, опциональные ссылки на `ai_item`/`file`

### Индексация и workflow

- Основной путь: `files` → `chunk_vector` → `ai_item` (+ `ai_comment`, `link`)
- Индексы на:
  - `chunk_vector.file_id`, `parent_chunk_id`, `ai_item_id`, `level`, `type`, `embedding` (ivfflat cosine)
  - `ai_item` по `(context_code, full_name)`
  - `files` по `context_code`
  - `link` — составные индексы по контексту/источнику/цели/типу

---

## 5. Потоки данных

По `KB/README_TECH.md`:

### 5.1 Инициализация

- Подключение к PostgreSQL
- `CREATE EXTENSION IF NOT EXISTS vector;`
- Выбор модели эмбеддингов:
  - `USE_OPENAI=true` → OpenAI‑обёртка
  - иначе → `SimpleEmbeddings`
- Инициализация `PostgresVectorStore(embeddings, dbService)`
- При желании — авто‑векторизация `DOCS_DIR` (`vectorizeAllFiles`) с пропуском неизменённых файлов

#### Переменные окружения

- Сервер: `PORT`, `BASE_URL`, `DOCS_DIR`, `OUTPUT_DOCS_DIR`
- PostgreSQL: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`
- Эмбеддинги: `USE_OPENAI`, `OPENAI_API_KEY`
- Внешний AI: `REQ_SERVER_URL`, `DEFAULT_MODEL_NAME`, `MAX_RESULTS`

### 5.2 Векторизация файла

Функция уровня ядра:  
`vectorizeFile(fileName, dbService, embeddingsModel, vectorStore, contextCode, params)`:

1. Загрузка содержимого файла
2. Определение стратегии разбиения:
   - специализированные лоадеры:
     - `jsFunctionLoader`, `tsFunctionLoader`, `phpFunctionLoader`, `sqlFunctionLoader`
   - Markdown‑сплиттер с учётом заголовков
   - общий текстовый сплиттер
3. Формирование чанков с метаданными (уровни L0/L1/L2, имена, связи)
4. `embedDocuments(chunks)` → эмбеддинги
5. Сохранение:
   - `DbService.saveChunkVector(...)` в PG
   - опционально — `PostgresVectorStore.addDocuments()`

Есть поддержка ревекторизации с очисткой старых чанков (`forceRevectorization`).

### 5.3 Семантический поиск и RAG‑ответы

- `PostgresVectorStore.similaritySearchVectorWithScore()` → через `DbService.similaritySearch()`
- Фильтры:
  - `context_code`
  - `chunk_type`
  - `chunk_level`
- Для финальных текстовых ответов используется внешний AI‑сервер по `REQ_SERVER_URL` (например, `/api/send-request`), который строит ответы на основе найденного контекста (RAG без сложной рекурсии)

---

## 6. Расширенные возможности: теги и Logic Architect

### 6.1 Массовое управление тегами

По `docs/BACKEND_IMPLEMENTATION_v2.5.1.md`:

Новые эндпоинты:

- `POST /api/ai-items/bulk/tags/add`
- `POST /api/ai-items/bulk/tags/remove`

Назначение: массово добавлять/удалять теги у множества `AiItem`:

- Request:
  - `itemIds`: массив `full_name` AI‑элементов
  - `tagCodes`: массив кодов тегов
- Response:
  - `success`, `processedItems`, массив `failedItems` при необходимости

#### Схема БД для тегов

- `tags` — справочник тегов (code, name, description, context_code)
- `ai_item_tags` — связь `item_full_name` ↔ `tag_id` + `context_code`

Это даёт **систему тегов** поверх `ai_item` (например: `deprecated`, `needs-review`, `critical` и др.).

### 6.2 Logic Architect — анализ логики функций

По `docs/README_Logic_Architect_API.md`:

- Эндпоинт: `POST /api/items/{id}/analyze-logic?context-code=...`
  - `id` = `full_name` `AiItem`
- Сервер:
  1. Загружает AI‑элемент из БД (`getAiItemById`)
  2. Формирует метаданные (`l0_code`, `l1_out`, `l2_desc` и др.)
  3. Вызывает Gemini через `analyzeLogicWithGemini(body, metadata)`
  4. Возвращает JSON:
     - `logic` — формальное описание логики функции на русском
     - `graph` — узлы/рёбра потока управления (`start`, `decision`, `process`, `db_call`, `end`, `exception`)

Дополнительные эндпоинты:

- `GET/POST/PUT/DELETE /api/items/{id}/logic-graph` — хранение/получение результата анализа

Таким образом, поверх "сырых" чанков и AI‑элементов есть ещё **слой формализованного описания логики и графов управления**, который UI визуализирует.

---

## 7. Рабочий процесс разработки

По `AGENTS.md`:

- Установка: `bun install`
- Запуск сервера: `bun start`
- Основные тесты (примеры):
  - `bun tests/test_agent_script.js`
  - `bun tests/test-sql-order-system.js`
  - `node tests/run_all_tests.js`

### Типичный сценарий для нового проекта

1. Создать `kb-configs/{CONTEXT}.json` с `rootPath`, масками и игнорами
2. Через UI посмотреть `/api/project/tree`, скорректировать `fileSelection`
3. Запустить пайплайн векторизации
4. Проводить семантический поиск и задавать естественные запросы (через UI или REST)
5. При необходимости:
   - навешивать теги
   - использовать Logic Architect
   - расширять граф зависимостей

---

## 8. Резюме: что даёт проект

KOSMOS‑VECTOR — это не просто "векторизация файлов":

- Он **моделирует код как граф сущностей**: `files` → `chunk_vector` → `ai_item` → `link`/`tags`/`comments`
- Поддерживает **мульти‑репо, мульти‑корневые проекты** в единой логической KB через `context-code`
- Предоставляет **богатый REST API** и готов к интеграции с внешними LLM
- Папка `KB/` — это хорошо поддерживаемая база знаний на русском языке, объясняющая:
  - архитектуру (`README_TECH`)
  - схему БД (`README_DB-VECTOR`)
  - эмбеддинги (`README_EMBEDDING`)
  - тесты, REST и др.

---

Если вы хотите что-то конкретное (например, "запустить end-to-end тест", "добавить новый тип файлов", "расширить схему БД", "подключить другую модель эмбеддингов"), можно пройтись по конкретным частям кода (`DbService`, `PostgresVectorStore`, роуты, тесты), которые нужно затронуть.
