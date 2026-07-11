# AIAN Vector: LangChain RAG с PostgreSQL и UI

Полноценный RAG-сервер на Bun/Express с векторным хранилищем в PostgreSQL (pgvector) и UI для управления документами. Проект построен на архитектуре с разделением ядра (`core`) и сервера (`server-v2`).

ВАЖНО!!! База Знаний(набор README... файлов) находится в папке ./KB . При формировании ответов в первую очередь обращайся туда.

## Что внутри

- **`packages/core`**: Ядро бизнес-логики. Содержит всю логику для работы с базой данных, векторизации, хранения векторов и взаимодействия с LangChain. Этот пакет не зависит от фреймворков и может быть переиспользован.
- **`server-v2`**: "Тонкий" сервер на Express.js, который использует модули из `packages/core` через прямые относительные пути для выполнения операций. Он предоставляет REST API и отдает статический UI.
- **`kosmos/`**: Статические файлы пользовательского интерфейса (HTML, CSS, JS).

## Требования

- Bun >= 1.0.0
- PostgreSQL 14+ с расширением `pgvector`

В базе данных выполните один раз (под суперпользователем):
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Установка

Проект использует `Bun workspaces` (совместимо с npm workspaces). Все зависимости устанавливаются одной командой из корня проекта:

```powershell
bun install
```

## Конфигурация (.env)

Создайте файл `.env` в корне проекта.

```env
PORT=3005
BASE_URL=localhost
DOCS_DIR=./docs
OUTPUT_DOCS_DIR=./output_docs

# PostgreSQL
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=postgres
PGUSER=postgres
PGPASSWORD=postgres

# Выбор модели эмбеддингов
USE_OPENAI=false
OPENAI_API_KEY=sk-...           # требуется, если USE_OPENAI=true

# Внешний AI-сервер для генерации ответов
REQ_SERVER_URL=http://localhost:3002
DEFAULT_MODEL_NAME=google/gemini-2.0-flash-exp:free
MAX_RESULTS=5
```

При первом запуске сервер создаст папку `./docs` и три примерных документа, если директории нет.

## Запуск

```powershell
# Запустить сервер (с hot-reload)
bun start

# Или запустить сервер-v2
bun run start:v2
```

Сервер будет доступен по адресу `http://localhost:3005` (или порт, указанный в `PORT`).

## Документация

📖 **Полный индекс документации:** `KB/README_INDEX.md`

- **Онтология (понятия, grounding, concept-first RAG):** см. `KB/README_ONTO_LOADING.md` ⭐ НОВОЕ
- **MCP для ИИ-агентов:** `../kosmos-vector-mcp` — tools `ontology_ask`, `ontology_validate`, `kb_search`, `kosmos_health` (stdio, read-only)
- **REST API:** см. `KB/README_REST.md`
- **App Config API (управление настройками):** см. `KB/README_APP_CONFIG_API.md` ⭐ НОВОЕ
- **Prompts Config API (управление промптами с историей):** см. `KB/README_PROMPTS_CONFIG_API.md` ⭐ НОВОЕ в 2.9.0
- **Frontend Integration (RAG):** см. `docs/README_Frontend_RAG_Integration.md`
- **Frontend Integration (App Config):** см. `docs/README_Frontend_Config_Integration.md` ⭐ НОВОЕ
- **Frontend Integration (Prompts Config):** см. `docs/README_Frontend_Prompts_Integration.md` ⭐ НОВОЕ в 2.9.0
- **Тесты:** см. `tests/README_TESTS.md`
- **Технические детали/архитектура:** см. `KB/README_TECH.md`
- **Knowledge Base Configuration (multi-root):** см. раздел в `KB/README_TECH.md`
- **OpenAPI Contract:** см. `docs/api-contract.yaml` (версия 2.9.0)
- **История изменений:** см. `CHANGELOG.md` 📋

## Ключевые возможности

- **Онтологический уровень знаний** ⭐ — понятия домена (MD-файлы, git — источник истины) с типизированными отношениями и grounding-привязкой к реальному коду/таблицам/документам; валидация консистентности и протухания (`/api/ontology/validate`); concept-first retrieval (`/api/ontology/ask`, стратегия «Ontology» в RAG Test) — ответ строится от понятий вниз к коду. См. `KB/README_ONTO_LOADING.md`, спецификация: `../Ontology/ONTOLOGY_SPEC.md`
- Векторизация TXT/MD/SQL/JS/TS/PHP/Java с настраиваемыми параметрами
- **Специализированные загрузчики кода** для SQL, JavaScript, TypeScript, PHP
- Извлечение сущностей: классы, функции, методы, интерфейсы, traits
- Автоматический парсинг связей (L1): импорты, вызовы функций, зависимости
- Хранение чанков и метаданных в PostgreSQL (pgvector)
- Поиск схожих чанков с фильтрами по контексту/типу/уровню
- RAG-ответы через внешний AI-сервер (`REQ_SERVER_URL`)
- UI для вопросов, обзора документов, векторизации, AI Item и экспорта чанков в файлы
- **Система комментариев для AI Items** — автоматическое сохранение комментариев из L0 чанков и управление через REST API
- **Multi-root проекты (v2.2.0)** — поддержка нескольких корневых путей в `rootPath` через запятую

## Поддерживаемые языки (File Loaders)

| Язык | Расширения | Сущности | Конфигурация |
|------|------------|----------|--------------|
| SQL (PL/pgSQL) | `.sql` | Функции | `functions_loading.enabled: true` |
| JavaScript | `.js` | Классы, функции, arrow, методы | `js_loading.enabled: true` |
| TypeScript | `.ts`, `.tsx` | Интерфейсы, типы, enum, классы, методы | `ts_loading.enabled: true` |
| PHP | `.php` | Классы, traits, интерфейсы, функции, методы | `php_loading.enabled: true` |

## Быстрый smoke-тест API (PowerShell)

```powershell
# Замените порт 3005 на ваш, если он отличается

# Список документов
Invoke-RestMethod -Method GET http://localhost:3005/files

# Задать вопрос (минимально)
Invoke-RestMethod -Method POST http://localhost:3005/ask -ContentType 'application/json' -Body (@{ question = 'Что такое нейронные сети?' } | ConvertTo-Json)
```

## Ontology Builder (2.11.0)

Полуавтоматический черновик онтологии (Step 6 pipeline): `POST /api/ontology/build/suggest|materialize|apply`.
Подробности: [KB/README_ONTO_LOADING.md](./KB/README_ONTO_LOADING.md) §5.2.
