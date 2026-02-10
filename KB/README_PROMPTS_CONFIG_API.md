# Prompts Config API - Backend документация

**Версия API:** 2.9.0  
**Дата:** 08.02.2026

## Обзор

Prompts Config API предоставляет возможность управления конфигурацией промптов LLM (`prompts.json`) через REST API с полной поддержкой истории изменений.

### Ключевые особенности

✅ **Полное управление промптами** через REST API  
✅ **История изменений** хранится в PostgreSQL  
✅ **Версионирование** с автоинкрементом  
✅ **Восстановление** из любой версии  
✅ **Комментарии** к каждому изменению  
✅ **Автоочистка** старых версий (последние 100)  
✅ **Валидация** структуры конфигурации  
✅ **Глобальная конфигурация** (не требует context-code)

---

## База данных

### Таблица `prompt_config_history`

```sql
CREATE TABLE prompt_config_history (
  id SERIAL PRIMARY KEY,
  config_snapshot JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version INTEGER NOT NULL UNIQUE,
  comment TEXT NULL
);
```

**Индексы:**
- `idx_prompt_config_history_created_at` - быстрый поиск по дате
- `idx_prompt_config_history_version` - быстрый поиск по версии

**Триггер автоочистки:**
```sql
CREATE TRIGGER trigger_cleanup_prompt_config_history
  AFTER INSERT ON prompt_config_history
  FOR EACH STATEMENT
  EXECUTE FUNCTION cleanup_old_prompt_config_history();
```

Удаляет версии старше 100-й автоматически при каждой вставке.

---

## Структура конфигурации

### prompts.json

```json
{
  "l1l2Templates": {
    "sql": {
      "function": {
        "l1": { "prompt": "...", "inputText": "..." },
        "l2": { "prompt": "...", "inputText": "..." }
      },
      "table": { "l1": {...}, "l2": {...} },
      "view": { "l1": {...}, "l2": {...} }
    },
    "js": {
      "function": { "l1": {...}, "l2": {...} },
      "class": { "l1": {...}, "l2": {...} }
    },
    "md": {
      "section": { "l1": {...}, "l2": {...} }
    }
  },
  "rag": {
    "systemPrompt": "Системный промпт для RAG-чата",
    "userPromptTemplate": "Шаблон с {context} и {question}"
  },
  "naturalQuery": {
    "scriptGeneration": "Промпт для генерации JS-скриптов",
    "humanize": "Промпт для преобразования данных в текст"
  },
  "vectorOperations": {
    "qaPromptTemplate": "Шаблон для QA операций"
  }
}
```

### Валидация

API проверяет:
- ✅ Наличие всех 4 основных секций (`l1l2Templates`, `rag`, `naturalQuery`, `vectorOperations`)
- ✅ Обязательные поля в секции `rag` (`systemPrompt`, `userPromptTemplate`)
- ✅ Обязательные поля в секции `naturalQuery` (`scriptGeneration`, `humanize`)
- ✅ Обязательное поле в секции `vectorOperations` (`qaPromptTemplate`)
- ✅ Типы данных (string, object)

---

## REST API Endpoints

### 1. GET /api/prompts-config

Получить текущую конфигурацию промптов из `prompts.json`.

**Query Parameters:** нет  
**Authentication:** не требуется  
**Context-code:** не требуется (глобальные настройки)

**Response 200 OK:**
```json
{
  "success": true,
  "prompts": {
    "l1l2Templates": { ... },
    "rag": { ... },
    "naturalQuery": { ... },
    "vectorOperations": { ... }
  }
}
```

**Response 500 Internal Server Error:**
```json
{
  "success": false,
  "error": "Failed to read prompts configuration"
}
```

---

### 2. PATCH /api/prompts-config

Обновить конфигурацию промптов с сохранением в историю.

**Request Body:**
```json
{
  "updates": {
    "rag": {
      "systemPrompt": "Новый системный промпт",
      "userPromptTemplate": "Новый шаблон"
    },
    "naturalQuery": { ... },
    "l1l2Templates": { ... },
    "vectorOperations": { ... }
  },
  "comment": "Улучшил промпт для SQL функций (опционально)"
}
```

**Важно:**
- Поле `updates` должно содержать **полную** или **частичную** конфигурацию
- Обязательные секции должны присутствовать
- Используется полная замена секций (не deep merge)
- Каждое обновление создаёт новую версию в истории

**Response 200 OK:**
```json
{
  "success": true,
  "config": { ... },
  "historyEntry": {
    "id": 15,
    "version": 5,
    "createdAt": "2026-02-08T12:00:00Z",
    "comment": "Улучшил промпт для SQL функций"
  },
  "message": "Prompts configuration updated successfully"
}
```

**Response 400 Bad Request (валидация):**
```json
{
  "success": false,
  "error": "Configuration validation failed",
  "validationErrors": [
    "rag.systemPrompt must be a non-empty string",
    "naturalQuery.scriptGeneration must be a non-empty string"
  ]
}
```

**Response 500 Internal Server Error:**
```json
{
  "success": false,
  "error": "Failed to update prompts configuration"
}
```

---

### 3. GET /api/prompts-config/history

Получить список истории изменений конфигурации.

**Query Parameters:**
- `limit` (number, default: 50, max: 100) - количество записей
- `offset` (number, default: 0) - смещение для пагинации

**Response 200 OK:**
```json
{
  "success": true,
  "history": [
    {
      "id": 15,
      "version": 5,
      "createdAt": "2026-02-08T12:00:00Z",
      "comment": "Улучшил промпт для SQL функций"
    },
    {
      "id": 14,
      "version": 4,
      "createdAt": "2026-02-08T11:00:00Z",
      "comment": "Оптимизировал RAG промпты"
    }
  ],
  "count": 2
}
```

**Примечание:** История сортируется от новых к старым (DESC по version).

---

### 4. GET /api/prompts-config/history/:id

Получить конкретную версию из истории с полным snapshot конфигурации.

**Path Parameters:**
- `id` (integer) - ID записи истории

**Response 200 OK:**
```json
{
  "success": true,
  "historyEntry": {
    "id": 15,
    "version": 5,
    "createdAt": "2026-02-08T12:00:00Z",
    "comment": "Улучшил промпт для SQL функций",
    "config": {
      "l1l2Templates": { ... },
      "rag": { ... },
      "naturalQuery": { ... },
      "vectorOperations": { ... }
    }
  }
}
```

**Response 404 Not Found:**
```json
{
  "success": false,
  "error": "History entry with id 999 not found"
}
```

---

### 5. POST /api/prompts-config/restore/:id

Восстановить конфигурацию из указанной версии истории.

**Path Parameters:**
- `id` (integer) - ID записи истории для восстановления

**Request Body (опционально):**
```json
{
  "comment": "Восстановлено из версии 5"
}
```

**Важно:**
- Создаётся **новая** версия в истории
- Старая версия не удаляется
- Текущий `prompts.json` перезаписывается

**Response 200 OK:**
```json
{
  "success": true,
  "config": { ... },
  "historyEntry": {
    "id": 16,
    "version": 6,
    "createdAt": "2026-02-08T13:00:00Z",
    "comment": "Restored from version 5"
  },
  "message": "Configuration restored from version 5"
}
```

**Response 404 Not Found:**
```json
{
  "success": false,
  "error": "History entry with id 999 not found"
}
```

---

### 6. POST /api/prompts-config/reset

Сбросить конфигурацию промптов к дефолтным значениям.

**Request Body (опционально):**
```json
{
  "comment": "Сброс к дефолтным значениям"
}
```

**Response 200 OK:**
```json
{
  "success": true,
  "config": { ... },
  "historyEntry": {
    "id": 17,
    "version": 7,
    "createdAt": "2026-02-08T14:00:00Z",
    "comment": "Reset to default configuration"
  },
  "message": "Prompts configuration reset to defaults"
}
```

**Примечание:** Дефолтная конфигурация определена в `getDefaultPromptsConfig()` в `promptsConfigService.js`.

---

### 7. DELETE /api/prompts-config/history/:id

Удалить запись из истории.

**Path Parameters:**
- `id` (integer) - ID записи истории для удаления

**Response 200 OK:**
```json
{
  "success": true,
  "message": "History entry 15 deleted successfully"
}
```

**Response 404 Not Found:**
```json
{
  "success": false,
  "error": "History entry with id 999 not found"
}
```

**⚠️ Предупреждение:** Удаление записи из истории необратимо!

---

## Примеры использования

### Пример 1: Получить текущую конфигурацию

```bash
curl http://localhost:3200/api/prompts-config
```

### Пример 2: Обновить RAG промпт

```bash
curl -X PATCH http://localhost:3200/api/prompts-config \
  -H "Content-Type: application/json" \
  -d '{
    "updates": {
      "rag": {
        "systemPrompt": "Новый системный промпт для RAG",
        "userPromptTemplate": "Контекст: {context}\n\nВопрос: {question}\n\nОтвет:"
      },
      "naturalQuery": { ... },
      "l1l2Templates": { ... },
      "vectorOperations": { ... }
    },
    "comment": "Улучшил формат RAG промпта"
  }'
```

### Пример 3: Просмотр истории

```bash
# Получить последние 10 версий
curl "http://localhost:3200/api/prompts-config/history?limit=10"
```

### Пример 4: Восстановление из истории

```bash
curl -X POST http://localhost:3200/api/prompts-config/restore/5 \
  -H "Content-Type: application/json" \
  -d '{"comment": "Откат к рабочей версии"}'
```

---

## Backend Architecture

### Файловая структура

```
packages/core/
  └── promptsConfigService.js     # Основной сервис
routes/
  └── promptsConfig.js             # REST API роуты
tmp/
  └── add_prompt_config_history.sql  # SQL миграция
tests/
  └── test_prompts_config.js       # Тестовый скрипт
prompts.json                       # Конфигурация промптов (корень проекта)
```

### Сервис: promptsConfigService.js

**Экспортируемые функции:**

1. `getPromptsConfig()` - читает `prompts.json`, возвращает конфигурацию
2. `savePromptsConfig(config)` - сохраняет конфигурацию в `prompts.json`
3. `updatePromptsConfig(pgClient, updates, comment)` - обновляет + создаёт запись в истории
4. `getPromptsConfigHistory(pgClient, limit, offset)` - возвращает список истории
5. `getPromptsConfigHistoryById(pgClient, id)` - возвращает конкретную версию
6. `restorePromptsConfigFromHistory(pgClient, id, comment)` - восстанавливает из истории
7. `resetPromptsConfig(pgClient, comment)` - сброс к дефолтным значениям
8. `deletePromptsConfigHistoryEntry(pgClient, id)` - удаляет запись из истории
9. `validatePromptsConfig(config)` - валидация структуры
10. `getDefaultPromptsConfig()` - возвращает дефолтную конфигурацию

**Важно:**
- Сервис использует `pgClient.query()` для работы с БД
- Файл `prompts.json` читается/записывается синхронно (fs)
- При отсутствии файла создаётся дефолтная конфигурация

---

## Интеграция с существующим кодом

### promptsService.js

Существующий `packages/core/promptsService.js` продолжает работать как раньше:
- `loadPrompts()` - загружает промпты из `prompts.json`
- `getL1L2Prompt()` - получает промпты для генерации чанков
- `getRagPrompts()` - получает RAG промпты
- `getNaturalQueryPrompts()` - получает Natural Query промпты

**Новый API не затрагивает существующую функциональность!**

### Кэширование

`promptsService.js` использует кэширование промптов в памяти. После обновления через API:
- **Рекомендуется** перезапустить сервер для применения изменений
- **Или** добавить механизм сброса кэша (будущее улучшение)

---

## Безопасность и ограничения

### Ограничения

✅ Не требует авторизации (локальная разработка)  
✅ Автоочистка старых версий (последние 100)  
✅ Валидация структуры конфигурации  
✅ Защита от некорректных данных

### Рекомендации для production

⚠️ Добавить авторизацию для изменяющих операций (PATCH, POST, DELETE)  
⚠️ Логирование всех изменений конфигурации  
⚠️ Бэкап `prompts.json` перед обновлением  
⚠️ Rate limiting для предотвращения злоупотреблений

---

## Тестирование

### Запуск тестов

```bash
bun tests/test_prompts_config.js
```

Тестовый скрипт проверяет:
1. ✅ Получение текущей конфигурации
2. ✅ Обновление с комментарием
3. ✅ Получение истории
4. ✅ Получение конкретной версии
5. ✅ Создание нескольких версий
6. ✅ Восстановление из истории
7. ✅ Валидацию невалидной конфигурации
8. ✅ Сброс к дефолтным значениям
9. ✅ Финальную проверку истории

---

## Troubleshooting

### Проблема: Ошибка "Cannot read properties of undefined (reading 'query')"

**Причина:** Передан неправильный объект dbService  
**Решение:** Убедитесь, что передаёте `dbService.pgClient`, а не `dbService.pool`

### Проблема: Валидация не проходит

**Причина:** Отсутствуют обязательные поля  
**Решение:** Проверьте структуру в `validatePromptsConfig()`, все 4 секции должны присутствовать

### Проблема: История не сохраняется

**Причина:** Не выполнена SQL миграция  
**Решение:** Выполните `tmp/add_prompt_config_history.sql` в вашей БД

---

## Roadmap

### Планируемые улучшения

- [ ] Сброс кэша `promptsService.js` без перезапуска сервера
- [ ] Diff между версиями (показывать, что изменилось)
- [ ] Экспорт/импорт истории
- [ ] Bulk restore (восстановление нескольких версий)
- [ ] Webhooks при изменении промптов
- [ ] Авторизация и права доступа

---

## См. также

- **Frontend Integration:** `docs/README_Frontend_Prompts_Integration.md`
- **REST API Overview:** `KB/README_REST.md`
- **OpenAPI Contract:** `docs/api-contract.yaml`
- **Tests:** `tests/test_prompts_config.js`
- **CHANGELOG:** `CHANGELOG.md`
