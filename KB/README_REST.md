# REST API для AIAN Vector (LangChain RAG + PostgreSQL)

Базовый URL: `http://localhost:{PORT}` (по умолчанию `3005`)

- Контент: JSON (`Content-Type: application/json`)
- Аутентификация: отсутствует (локальная разработка)
- Ответы: JSON, коды ошибок: 4xx/5xx

## Конвенции

- `filename` в URL должен быть URL-encoded (`encodeURIComponent`).
- Поля `chunkType`, `chunkLevel`, `contextCode` используются как фильтры/метаданные.
- Везде, где указано `:filename`, сервер ожидает имя файла без пути; сам путь берётся из `DOCS_DIR`.

## 1. Вопросы и ответы (RAG)

**POST** `/ask`

Тело запроса:
```json
{
  "question": "string (обязательно)",
  "contextCode": "string | null",
  "showDetails": "boolean",
  "maxResults": "number",         // по умолчанию MAX_RESULTS или 5
  "chunkType": "string | null",   // фильтр по типу чанка
  "chunkLevel": "string | null",  // фильтр по уровню чанка
  "model": "string | null"        // прокидывается во внешний AI-сервер
}
```

Ответ (успех):
```json
{
  "answer": "string",
  "filters": { "contextCode": "...", "chunkType": "...", "chunkLevel": "...", "model": "..." }
}
```

## 2. Документы и файлы

**GET** `/files`  
**GET** `/documents` (alias)

**GET** `/file-info/:filename`

**GET** `/file-content/:filename`

**DELETE** `/file/:filename`

**POST** `/delete-file`  
Тело: `{ "filename": "...", "deleteFromDisk": true }`

**GET** `/context-codes` → `string[]`  
**GET** `/get-context-codes` → `{ contexts: string[] }`

**POST** `/update-context/:filename`  
Тело: `{ "contextCode": "AI" }`

## 3. Чанки файла

**GET** `/file-chunks/:filename`

**POST** `/update-chunk/:chunkId`  
Тело: `{ "type": "string", "level": "string" }`

**POST** `/update-chunk-names/:chunkId`  
Тело: `{ "s_name": "", "full_name": "", "h_name": "" }`

**POST** `/update-all-chunk-names` — массовое обновление имён по содержимому

**POST** `/save-level-chunk-db`  
Тело:
```json
{
  "filename": "...",
  "parentChunkId": 123,
  "content": "...",
  "level": "1-связи|2-логика",
  "type": "function|table|...",
  "aiItemId": 456
}
```

**POST** `/api/v1/save-chunk-file` — сохраняет файл в `OUTPUT_DOCS_DIR`

## 4. Векторизация

**POST** `/vectorize/:filename`  
**POST** `/vectorize` (рекомендуется для передачи `params`)

**POST** `/scan-folder`

### Специализированные
- **POST** `/vectorize-sql/:filename`
- **POST** `/vectorize-js/:filename`
- **POST** `/vectorize-java/:filename`
- **POST** `/vectorize-md/:filename`

## 5. AI Items

**GET** `/ai-items?contextCode=AI`  
**GET** `/ai-item/:id`  
**GET** `/ai-item-chunks/:id?level=1-связи`  
**GET** `/ai-item/:id/chunks?level=...`

**POST** `/ai-item/:id/update-context`  
**POST** `/ai-items/cleanup`

**POST** `/create-ai-item`  
Тело: `{ chunkId, full_name, contextCode, type, sName }`

**POST** `/api/ai/ai-item/:id/generate-chunk` — генерация чанков L1/L2 (авто или ручной промпт)

### 5.1. Анализ логики (Logic Graph)

**GET** `/api/items/:id/logic-graph?context-code=TEST`  
Получить сохраненный анализ логики для AiItem (текстовое описание и граф потока управления).

**Параметры:**
- `:id` — full_name AiItem (например, `utils.fetchData`)
- `context-code` (query) — обязательный контекстный код

**Ответ (успех):**
```json
{
  "success": true,
  "itemId": "utils.fetchData",
  "logicGraph": {
    "logic": "Функция проверяет условие и возвращает результат...",
    "graph": {
      "nodes": [
        { "id": "start_1", "type": "start", "label": "Начало" },
        { "id": "decision_1", "type": "decision", "label": "Проверка условия" }
      ],
      "edges": [
        { "id": "e1", "from": "start_1", "to": "decision_1" }
      ]
    }
  },
  "savedAt": "2025-01-15T12:00:00Z",
  "updatedAt": null
}
```

**POST** `/api/items/:id/logic-graph?context-code=TEST`  
Сохранить анализ логики для AiItem. Если анализ уже существует, он будет перезаписан.

**Тело запроса:**
```json
{
  "logic": "Текстовое описание логики функции на русском языке",
  "graph": {
    "nodes": [...],
    "edges": [...]
  }
}
```

**PUT** `/api/items/:id/logic-graph?context-code=TEST`  
Обновить существующий анализ логики. Возвращает 404, если анализ не найден.

**DELETE** `/api/items/:id/logic-graph?context-code=TEST`  
Удалить сохраненный анализ логики для AiItem.

**Ответ (успех):**
```json
{
  "success": true,
  "message": "Logic analysis deleted successfully for item: utils.fetchData"
}
```

**Примечание:** Анализ логики сохраняется в чанке с `level = "2-logic"`. Поле `logic` хранится в `chunk_content`, а `graph` — в `content` (JSONB).

## 6. Конфигурация и служебные

**GET** `/server-info`  
**GET** `/docs-path`  
**GET** `/api/config`  
**GET** `/api/available-models`

## 7. Аналитика JS чанков (AI)

**POST** `/analyze-js-level1`  
**POST** `/analyze-js-level2`

## 8. Очистка базы данных

Эти эндпоинты предназначены для полного или частичного сброса данных в базе.  
**Внимание:** Все операции требуют явного подтверждения через поле `confirm: true` в теле запроса. Без него сервер вернёт ошибку 400.

### POST `/clear-database`

Полная логическая очистка всей базы данных (рекомендуемый способ).

**Тело запроса (обязательно):**
```json
{
  "confirm": true
}
```

**Ответ (успех):**
```json
{
  "success": true,
  "message": "Database has been completely cleared (all files, chunks, and AI items removed).",
  "method": "clearAllTables"
}
```

Удаляет все записи из таблиц `files`, `file_vectors` и `ai_item` с использованием обычных `DELETE`.  
Сохраняет логику каскадного удаления и триггеры.

### POST `/truncate-database`

Жёсткая мгновенная очистка всех таблиц через `TRUNCATE`.

**Тело запроса (обязательно):**
```json
{
  "confirm": true
}
```

**Ответ (успех):**
```json
{
  "success": true,
  "message": "Database has been truncated (all data removed instantly and ID sequences reset).",
  "method": "truncateAllTables",
  "warning": "This operation bypasses some deletion logic and is irreversible."
}
```

Быстрее, чем `/clear-database`, особенно при большом объёме данных.  
Обходит некоторые проверки и логику удаления — используйте только когда уверены в необходимости.

### POST `/cleanup-orphaned-ai-items`

Очистка только «осиротевших» AI Item — тех, на которые больше нет ссылок из чанков уровня `0-исходник`.

**Тело запроса (обязательно):**
```json
{
  "confirm": true
}
```

**Ответ (успех):**
```json
{
  "success": true,
  "message": "Cleanup completed. Removed 3 orphaned AI items.",
  "deletedItems": [
    {
      "id": 45,
      "full_name": "OldClass.unusedMethod",
      "context_code": "DEFAULT"
    },
    ...
  ]
}
```

Полезно выполнять после массового удаления файлов или перевеекторизации — убирает «мусор» в таблице `ai_item`.

## Коды ошибок (общие)

- 400: некорректный ввод
- 404: ресурс не найден
- 500: внутренняя ошибка

## Заметки по совместимости

- Для передачи детальных параметров векторизации предпочтительно использовать `POST /vectorize` (без `:filename`), где поле `params` обрабатывается корректно.
- Эмбеддинги: simple (локально) или OpenAI (`USE_OPENAI=true`). Размерность по умолчанию 1536.

**Обновлено:** 13 декабря 2025 — добавлен раздел «Очистка базы данных».  
**Обновлено:** [дата] — добавлен раздел «Анализ логики (Logic Graph)» для работы с графами потока управления.