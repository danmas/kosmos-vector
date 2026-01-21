# Natural Query Engine для KOSMOS-VECTOR

## Что это?

Natural Query Engine — интеллектуальный слой для анализа кодовой базы, который позволяет задавать вопросы на естественном языке и получать структурированные ответы.

**Примеры вопросов:**
- "Какие типы связей используются в проекте?"
- "Покажи все функции, которые читают таблицу users"
- "Топ-10 самых вызываемых функций"
- "Все таблицы, которые обновляются функциями из схемы carl_comm"

## Как это работает?

1. **Вы задаёте вопрос** на русском языке через API
2. **LLM генерирует** JavaScript-скрипт для получения данных
3. **Скрипт выполняется** в безопасном sandbox (только SELECT/WITH запросы)
4. **Результат преобразуется** в человекочитаемый текст через LLM
5. **Скрипт сохраняется** в базу и векторизуется для поиска похожих вопросов

**Два режима работы:**
- `/api/v1/natural-query` — всегда генерирует новый скрипт
- `/api/v1/natural-query/suggest` — ищет похожие вопросы в кэше

## Быстрый старт

### 1. Выполнить запрос

**POST** `/api/v1/natural-query`

```json
{
  "question": "Какие типы связей используются в проекте?",
  "contextCode": "CARL"
}
```

**Ответ:**
```json
{
  "success": true,
  "human": "В проекте используются следующие типы связей: calls, reads_from, updates, inserts_into, imports",
  "raw": [
    { "code": "calls", "label": "calls", "description": "Function calls another function" },
    { "code": "reads_from", "label": "reads_from", "description": "SELECT / FROM / JOIN table" }
  ],
  "scriptId": 42,
  "last_result": {
    "raw": [...],
    "human": "...",
    "executed_at": "2024-01-15T10:30:00.000Z"
  }
}
```

### 2. Получить список похожих вопросов

**POST** `/api/v1/natural-query/suggest`

```json
{
  "question": "Какие функции вызывают другие функции?",
  "contextCode": "CARL"
}
```

**Ответ:**
```json
{
  "success": true,
  "high_confidence": true,
  "suggestions": [
    {
      "id": 42,
      "question": "Какие типы связей используются в проекте?",
      "similarity": 0.97,
      "usage_count": 15,
      "is_valid": true,
      "last_result": {
        "raw": [...],
        "human": "...",
        "executed_at": "2024-01-15T10:30:00.000Z"
      }
    }
  ]
}
```

## Возможности

### Векторный поиск

Система использует эмбеддинги для семантического поиска похожих вопросов. Это означает, что она понимает синонимы и перефразировки:

- "Какие функции вызывают другие?" ≈ "Покажи все вызовы функций"
- "Типы связей в проекте" ≈ "Какие связи используются?"

**Логика работы:**
- Если найдено совпадение с `similarity >= 0.95` → возвращается 1 suggestion с `high_confidence: true`
- Если найдено несколько совпадений с `similarity >= 0.8` → возвращается список suggestions
- Пользователь выбирает нужный вопрос или подтверждает использование

### Хранение скриптов

Все сгенерированные скрипты сохраняются в таблице `agent_script`:

- **Векторизация** — вопрос автоматически векторизуется для семантического поиска
- **Поиск** — через `/api/v1/natural-query/suggest` можно найти похожие вопросы
- **Переиспользование** — через `/api/agent-scripts/:id/execute` можно выполнить существующий скрипт

### Безопасность

- Скрипты выполняются в изолированном sandbox
- Разрешены только SELECT и WITH (CTE) SQL-запросы
- Таймаут выполнения: 5 секунд
- Автоматическая валидация скриптов перед выполнением

## API Эндпоинты

### POST /api/v1/natural-query

Генерирует новый скрипт и выполняет его. **Всегда вызывает LLM.**

**Request:**
```json
{
  "question": "Ваш вопрос на русском языке",
  "contextCode": "CARL"
}
```

**Response:**
- `success: true` → успешное выполнение
- `human` → человекочитаемый ответ
- `raw` → сырые данные из БД
- `scriptId` → ID сохранённого скрипта
- `last_result` → результат выполнения

**Примечание:** Для поиска похожих вопросов используйте `/api/v1/natural-query/suggest`.

### POST /api/v1/natural-query/suggest

Получить список похожих вопросов без выполнения скрипта.

**Request:**
```json
{
  "question": "Ваш вопрос",
  "contextCode": "CARL"
}
```

**Query Parameters:**
- `limit` (optional) - Максимальное количество результатов (по умолчанию 5)
- `threshold` (optional) - Минимальный порог similarity (по умолчанию 0.8)

**Response:**
```json
{
  "success": true,
  "high_confidence": true,
  "suggestions": [
    {
      "id": 42,
      "question": "...",
      "similarity": 0.97,
      "usage_count": 15,
      "is_valid": true,
      "last_result": {...}
    }
  ]
}
```

### CRUD для скриптов

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | `/api/agent-scripts?context-code=XXX` | Список всех скриптов |
| GET | `/api/agent-scripts/:id?context-code=XXX` | Детали скрипта |
| PUT | `/api/agent-scripts/:id?context-code=XXX` | Редактирование скрипта |
| DELETE | `/api/agent-scripts/:id?context-code=XXX` | Удаление скрипта |
| POST | `/api/agent-scripts/:id/execute?context-code=XXX` | Выполнить существующий скрипт |

## Настройки

Настройки находятся в `config.json`:

```json
{
  "NATURAL_QUERY_SUGGEST_LIMIT": 5,
  "NATURAL_QUERY_SIMILARITY_THRESHOLD": 0.8,
  "NATURAL_QUERY_HIGH_CONFIDENCE_THRESHOLD": 0.95
}
```

| Параметр | Описание | По умолчанию |
|----------|----------|--------------|
| `NATURAL_QUERY_SUGGEST_LIMIT` | Максимальное количество suggestions | 5 |
| `NATURAL_QUERY_SIMILARITY_THRESHOLD` | Минимальный порог similarity для включения в результаты | 0.8 |
| `NATURAL_QUERY_HIGH_CONFIDENCE_THRESHOLD` | Порог для `high_confidence: true` в suggest | 0.95 |

## Примеры использования

### Пример 1: Простой запрос

```bash
curl -X POST http://localhost:3200/api/v1/natural-query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Какие типы связей используются в проекте?",
    "contextCode": "CARL"
  }'
```

### Пример 2: Получить suggestions

```bash
curl -X POST "http://localhost:3200/api/v1/natural-query/suggest?limit=5&threshold=0.8" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Покажи все вызовы функций",
    "contextCode": "CARL"
  }'
```

### Пример 3: Выполнить существующий скрипт

```bash
curl -X POST "http://localhost:3200/api/agent-scripts/42/execute?context-code=CARL"
```

## Обработка ошибок

### Ошибка генерации скрипта

```json
{
  "success": false,
  "error": "Generated script is invalid: ...",
  "human": "Сгенерированный скрипт невалиден: ...",
  "script": "async function execute(contextCode) { ... }",
  "scriptId": null
}
```

### Ошибка выполнения скрипта

```json
{
  "success": false,
  "error": "Script execution failed: rows is not defined",
  "human": "Ошибка в скрипте: переменная 'rows' не определена...",
  "scriptId": 42,
  "script": "async function execute(contextCode) { ... }"
}
```

## Архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│                    POST /api/v1/natural-query                    │
│                                                                 │
│  Вопрос → LLM генерирует скрипт → Сохранение + Векторизация     │
│         → Выполнение в sandbox → LLM humanize → Ответ           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                 POST /api/v1/natural-query/suggest               │
│                                                                 │
│  Вопрос → Векторизация → Поиск похожих (similarity >= 0.8)      │
│         → Список suggestions с similarity                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│               POST /api/agent-scripts/:id/execute                │
│                                                                 │
│  ID → Загрузка скрипта → Выполнение → LLM humanize → Ответ      │
└─────────────────────────────────────────────────────────────────┘
```

## Технические детали

- **Эмбеддинги:** Используется та же модель, что настроена в `EmbeddingsFactory` (размерность 1536)
- **Векторный поиск:** PostgreSQL с расширением `pgvector`, индекс IVFFlat для cosine similarity
- **Sandbox:** Изоляция через `new Function()`, таймаут 5 секунд
- **LLM:** Используется для генерации скриптов и humanize результатов

## Миграция существующих вопросов

Если в таблице `agent_script` уже есть вопросы, их можно векторизовать:

```bash
node tmp/migrate_question_embeddings.js
```

**Примечание:** Новые скрипты автоматически векторизуются при сохранении.

## Дополнительная документация

- [KB/README_agent-script.md](KB/README_agent-script.md) — подробная техническая документация
- [docs/api-contract.yaml](docs/api-contract.yaml) — OpenAPI спецификация

## FAQ

**Q: Можно ли использовать скрипты для модификации данных?**  
A: Нет, разрешены только SELECT и WITH (CTE) запросы для безопасности.

**Q: Что делать, если скрипт генерирует ошибку?**  
A: Скрипт помечается как `is_valid = false` и не используется в будущем. Можно отредактировать его через PUT `/api/agent-scripts/:id`.

**Q: Как работает кэширование?**  
A: `/api/v1/natural-query` всегда генерирует новый скрипт. Для поиска похожих вопросов используйте `/api/v1/natural-query/suggest`, а для выполнения существующего скрипта — `/api/agent-scripts/:id/execute`.

**Q: Можно ли использовать свои эмбеддинги?**  
A: Да, используется модель из `EmbeddingsFactory`, которую можно настроить в конфигурации проекта.
