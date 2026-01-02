# Техническая документация AIAN Vector

Цель: описать архитектуру, модель данных, взаимодействия и нюансы переноса/переписывания проекта без потери функциональности.

## Архитектура

- Node.js/Express (`server.js`) — REST API + статика UI
- PostgreSQL + pgvector — хранилище файлов, чанков и AI Items
- LangChain — обёртки для эмбеддингов и ретривера; собственный `PostgresVectorStore`
- Микросервисы эмбеддингов:
  - `simple-service` — детерминированные локальные эмбеддинги (1536-мерные)
  - `openai-service` — эмбеддинги OpenAI (`@langchain/openai`)

Основной сервер импортирует из `microservices/common-service/src/index.js`: `DbService`, `PostgresVectorStore`, `vectorizeFile`, `updateChunkMetadata`, `updateChunkNames` и хелперы для AI Item.

## Переменные окружения (.env)

- Сервер: `PORT`, `BASE_URL`, `DOCS_DIR`, `OUTPUT_DOCS_DIR`
- PostgreSQL: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`
- Эмбеддинги: `USE_OPENAI` (`true|false`), `OPENAI_API_KEY`
- Внешний AI-сервер: `REQ_SERVER_URL`, `DEFAULT_MODEL_NAME`, `MAX_RESULTS`
- Конфиг для UI (шаблоны SQL L1/L2): `SQL_L*_...`

## Knowledge Base Configuration

Конфигурация Knowledge Base хранится в `./kb-configs/{context-code}.json` и управляется через `packages/core/kbConfigService.js`.

**Структура конфигурации:**
- `rootPath` — абсолютный путь к проекту
- `includeMask` — glob-паттерн для фильтрации файлов (например, `**/*.sql`)
- `ignorePatterns` — паттерны игнорирования (через запятую)
- `fileSelection` — точный список выбранных файлов (массив относительных путей с `./`)
- `metadata` — метаданные проекта (включая `custom_settings` в YAML формате)

**Логика работы:**

1. **Дерево файлов (`GET /api/project/tree`):**
   - Использует `includeMask` для определения флага `selected` у файлов
   - Файлы, соответствующие маске → `selected: true`
   - Остальные → `selected: false`

2. **Pipeline обработка (`step1Runner.js`):**
   - Если `fileSelection.length > 0` → используется только список из `fileSelection` (приоритет)
   - Если `fileSelection` пуст → сканирование по `includeMask` с учетом `ignorePatterns`

**API endpoints:**
- `GET /api/kb-config?context-code=...` — получить конфигурацию
- `POST /api/kb-config?context-code=...` — обновить конфигурацию (частичный патч)
- `GET /api/project/tree?context-code=...` — дерево файлов с учетом `includeMask`
- `POST /api/project/selection?context-code=...` — сохранить выбор файлов в `fileSelection`

## Схема БД (создаётся в рантайме)

Создаётся при `DbService.initializeSchema()`:

- `public.files`:
  - `id serial pk`
  - `filename text unique`
  - `context_code text default 'DEFAULT'`
  - `file_hash text` (для совместимости)
  - `file_url text` (для совместимости)
  - `content text` (для совместимости)
  - `created_at timestamptz default now()`
  - `modified_at timestamptz default now()`

- `public.ai_item`:
  - `id serial pk`
  - `full_name text not null`
  - `context_code text not null default 'DEFAULT'`
  - `file_id int references files(id) on delete set null`
  - `type text`
  - `s_name text`, `h_name text`
  - `created_at timestamptz default now()`
  - `updated_at timestamptz default now()`

- `public.chunk_vector`:
  - `id serial pk`
  - `file_id int references files(id) on delete cascade`
  - `ai_item_id int references ai_item(id) on delete set null`
  - `parent_chunk_id int references chunk_vector(id) on delete cascade`
  - `chunk_content text not null`
  - `embedding vector`
  - `chunk_index int`
  - `type text default 'текст'`
  - `level text default '0-исходник'`
  - `s_name text`, `h_name text`, `full_name text`
  - `created_at timestamptz default now()`

Индексы: `idx_chunk_vector_file_id`, `idx_chunk_vector_parent_chunk_id`, `idx_chunk_vector_ai_item_id`, индексы на `ai_item`.

Примечание: Расширение `vector` должно быть установлено: `CREATE EXTENSION IF NOT EXISTS vector;`.

## Поток данных и ключевые операции

1) Инициализация
   - Подключение к PG → `initializeSchema()`
   - Выбор модели эмбеддингов: `USE_OPENAI ? OpenAIEmbeddingsWrapper : SimpleEmbeddings`
   - Инициализация `PostgresVectorStore(embeddings, dbService)`
   - Автовекторизация директории `DOCS_DIR` при старте (`vectorizeAllFiles`) с пропуском неизменённых

2) Векторизация файла: `vectorizeFile(fileName, dbService, embeddingsModel, vectorStore, contextCode, params)`
   - Загрузка файла
   - Определение метода разбиения: стандартный, по секциям, Markdown, либо специализированные эндпоинты для SQL/JS/Java/MD
   - Создание эмбеддингов: `embeddingsModel.embedDocuments(chunks)`
   - Сохранение чанков: `dbService.saveChunkVector(fileId, content, vector, index, metadata, names)`
   - Дополнительно: добавление тех же документов в `PostgresVectorStore.addDocuments()` (опционально)

3) Поиск/ответы
   - `PostgresVectorStore.similaritySearchVectorWithScore()` вызывает `dbService.similaritySearch()`
   - Фильтры: `contextCode`, `chunkType`, `chunkLevel`
   - Ответы формируются через внешний AI-сервис (`/api/send-request` у `REQ_SERVER_URL`), RAG здесь отключён (нет рекурсии)

4) AI Item
   - Линкируется автоматически для чанков уровня `0-исходник` при наличии `full_name`
   - CRUD: `getAllAiItems`, `getAiItemById`, `getAiItemChunks`, `createAiItem`, `updateAiItemContext`, `cleanupOrphanedAiItems`

## Нюансы и важные моменты

- Размерность эмбеддингов — 1536 по умолчанию и для simple, что согласовано с полем `vector` в PG.
- В `saveFileInfo()` хранится и `content` — совместимость с историей проекта; filename нормализуется до базового имени.
- Векторизация с `forceRevectorization=true` предварительно очищает чанки и помечает файл к обновлению.
- В UI модал векторизации шлёт поле `params`, тогда как эндпоинт `/vectorize/:filename` ожидает `vectorizationParams`. Используйте `/vectorize` для гарантии корректной передачи.
- Для Markdown есть сохранение контекста заголовков (`s_name/h_name`, parent_heading, части секций).
- Для SQL/JS применяются эвристики извлечения имён (`SQL_OBJECT_TYPES`/`JS_OBJECT_TYPES`).
- `update-all-chunk-names` пересчитывает имена для существующих чанков.

## Перенос и переписывание

При переносе на новый стек/моно-репо/оркестрацию:

1) PG: обеспечить `pgvector`, миграции/DDL эквивалентны `initializeSchema()`
2) Вынести общее ядро:
   - `DbService` как слой доступа к PG (интерфейс сохранить)
   - `PostgresVectorStore` (API как у LangChain VectorStore)
   - `textSplitters` и `vectorOperations.vectorizeFile`
3) Сервис эмбеддингов — интерфейс с методами `embedQuery`, `embedDocuments` (адаптеры simple/openai)
4) REST API — сохранить эндпоинты и контракты из `README_REST.md`
5) UI — повторно использовать HTML/CSS/JS или перенести в современный SPA, сохранив эндпоинты и параметры
6) Конфиг — `.env` совместим, переменные окружения перечислены выше

## Тестирование

- Юнит/интеграционные скрипты: `run_all_tests.js`, отдельные тесты `tests/*.js`, `test_*.js` в корне
- Ручной тест: загрузка документов в `DOCS_DIR`, `/scan-folder`, векторизация, `/ask`

## Производительность

- Индексация столбцов `chunk_vector` обязательна (см. инициализацию)
- Ограничение k в ретривере (`k = MAX_RESULTS`)
- Для крупных файлов повышайте `chunkSize`, используйте специализированные сплиттеры

## Безопасность

- Проект ориентирован на локальную разработку; добавление аутентификации/авторизации — на ваше усмотрение
- Не логируйте секреты; `OPENAI_API_KEY` обязателен только при `USE_OPENAI=true`


