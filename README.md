# AIAN Vector: LangChain RAG с PostgreSQL и UI

Полноценный RAG-сервер на Bun/Express с векторным хранилищем в PostgreSQL (pgvector) и UI для управления документами. Проект построен на архитектуре с разделением ядра (`core`) и сервера (`server-v2`).

ВАЖНО!!! База Знаний(набор README... файлов) находится в папке ./KB . При формировании ответов в первую очередь обращайся туда.

## Что внутри

- **`packages/core`**: Ядро бизнес-логики. Содержит всю логику для работы с базой данных, векторизации, хранения векторов и взаимодействия с LangChain. Этот пакет не зависит от фреймворков и может быть переиспользован.
- **`server-v2`**: "Тонкий" сервер на Express.js, который использует `@aian-vector/core` для выполнения операций. Он предоставляет REST API и отдает статический UI.
- **`public/`**: Статические файлы пользовательского интерфейса (HTML, CSS, JS).

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

- REST API: см. `KB/README_REST.md`
- UI: см. `KB/README_UI.md`
- Тесты: см. `tests/README_TESTS.md`
- Технические детали/архитектура: см. `KB/README_TECH.md`
- Knowledge Base Configuration: см. раздел в `KB/README_UI.md` и `docs/README_Contract_changes.md` (раздел 6)

## Ключевые возможности

- Векторизация TXT/MD/SQL/JS/TS/Java с настраиваемыми параметрами
- Хранение чанков и метаданных в PostgreSQL (pgvector)
- Поиск схожих чанков с фильтрами по контексту/типу/уровню
- RAG-ответы через внешний AI-сервер (`REQ_SERVER_URL`)
- UI для вопросов, обзора документов, векторизации, AI Item и экспорта чанков в файлы

## Быстрый smoke-тест API (PowerShell)

```powershell
# Замените порт 3005 на ваш, если он отличается

# Список документов
Invoke-RestMethod -Method GET http://localhost:3005/files

# Задать вопрос (минимально)
Invoke-RestMethod -Method POST http://localhost:3005/ask -ContentType 'application/json' -Body (@{ question = 'Что такое нейронные сети?' } | ConvertTo-Json)
```