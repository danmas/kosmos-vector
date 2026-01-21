# Natural Query Engine для KOSMOS-VECTOR

## Описание

Natural Query Engine — интеллектуальный слой для анализа кодовой базы: пользователь задаёт вопрос на естественном языке, система автоматически генерирует JS-скрипт, выполняет его в sandbox и возвращает структурированный JSON-ответ.

## Архитектура

```mermaid
flowchart TB
    subgraph NaturalQuery [POST /api/v1/natural-query]
        LLM[LLM генерирует скрипт]
        Save[Сохранение в agent_script]
        Embed[Векторизация вопроса]
        Sandbox[Выполнение в sandbox]
        Humanize[LLM humanize результат]
        Response["{ human, raw, scriptId, last_result }"]
    end
    
    subgraph Suggest [POST /api/v1/natural-query/suggest]
        EmbedQ[Векторизация вопроса]
        Search[Поиск похожих]
        Suggestions["{ suggestions, high_confidence }"]
    end
    
    subgraph Execute [POST /api/agent-scripts/:id/execute]
        Load[Загрузка скрипта по ID]
        Run[Выполнение в sandbox]
        ResponseExec["{ human, raw, scriptId, last_result }"]
    end
    
    LLM --> Save --> Embed --> Sandbox --> Humanize --> Response
    EmbedQ --> Search --> Suggestions
    Load --> Run --> ResponseExec
```

**Три режима работы:**
- `/api/v1/natural-query` — **всегда генерирует новый скрипт** через LLM
- `/api/v1/natural-query/suggest` — ищет похожие вопросы для выбора пользователем
- `/api/agent-scripts/:id/execute` — выполняет существующий скрипт по ID

## Структура файлов

| Файл | Назначение |
|------|------------|
| `routes/agentScript.js` | Роутер: CRUD для agent_scripts + natural-query эндпоинт |
| `packages/core/DbService.js` | Методы: queryRaw, getAgentScriptByExactQuestion, fuzzySearchScripts, saveAgentScript, incrementUsage |
| `packages/core/scriptSandbox.js` | Модуль: executeScript() + validateScript() |
| `packages/core/naturalQueryPrompts.js` | Промпты: getScriptGenerationPrompt, getHumanizePrompt |

## API эндпоинты

### POST /api/v1/natural-query

**Всегда генерирует новый скрипт** через LLM и выполняет его.

**Запрос:**
```json
{
  "question": "Какие функции вызывает api_auct?",
  "contextCode": "CARL"
}
```

**Ответ (успешный):**
```json
{
  "success": true,
  "human": "Функция api_auct вызывает 3 других функции: helper_fn, validate_data, save_result",
  "raw": [
    { "source": "api_auct", "target": "helper_fn", "type": "calls" },
    { "source": "api_auct", "target": "validate_data", "type": "calls" }
  ],
  "scriptId": 42,
  "last_result": {
    "raw": [...],
    "human": "...",
    "executed_at": "2024-01-15T10:30:00.000Z"
  }
}
```

**Ответ (ошибка выполнения):**
```json
{
  "success": false,
  "error": "Script execution failed: rows is not defined",
  "human": "Ошибка в скрипте: переменная 'rows' не определена...",
  "scriptId": 42,
  "script": "async function execute(contextCode) { const rows = ... }"
}
```

### CRUD для agent-scripts

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | `/api/agent-scripts?context-code=XXX` | Список скриптов |
| GET | `/api/agent-scripts/:id?context-code=XXX` | Детали скрипта |
| PUT | `/api/agent-scripts/:id?context-code=XXX` | Редактирование (script, is_valid) |
| DELETE | `/api/agent-scripts/:id?context-code=XXX` | Удаление скрипта |
| POST | `/api/agent-scripts/:id/execute?context-code=XXX` | Выполнить существующий скрипт |
| POST | `/api/agent-scripts/:id/embed?context-code=XXX` | Векторизовать вопрос скрипта |

## Ключевые компоненты

### 1. Sandbox (packages/core/scriptSandbox.js)

Безопасное выполнение скриптов через `new Function()` с изоляцией scope:

```javascript
async function executeScript(scriptCode, contextCode, dbService, timeoutMs = 5000) {
  // Валидация формата
  if (!scriptCode.includes('async function execute')) {
    throw new Error('Script must contain "async function execute(contextCode)"');
  }
  
  // Безопасная обёртка для DbService (только SELECT)
  const safeDbService = {
    queryRaw: async (sql, params = []) => {
      if (!sql.trim().toUpperCase().startsWith('SELECT')) {
        throw new Error('Only SELECT queries are allowed in scripts');
      }
      return dbService.queryRaw(sql, params);
    }
  };
  
  // Создаём функцию с инъекцией DbService
  const executeFn = new Function('DbService', `
    ${scriptCode}
    return execute;
  `)(safeDbService);
  
  // Выполняем с таймаутом
  return Promise.race([
    executeFn(contextCode),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    )
  ]);
}
```

### 2. Поиск похожих вопросов (/api/v1/natural-query/suggest)

Эндпоинт `/api/v1/natural-query/suggest` использует векторный поиск для нахождения семантически похожих вопросов:

```sql
SELECT 
  id,
  question,
  script,
  usage_count,
  is_valid,
  last_result,
  1 - (question_embedding <=> $1::vector) AS similarity
FROM public.agent_script
WHERE context_code = $2
  AND is_valid = true
  AND question_embedding IS NOT NULL
  AND (1 - (question_embedding <=> $1::vector)) >= $3
ORDER BY similarity DESC
LIMIT $4
```

**Логика работы:**
- Если `similarity >= 0.95` → возвращается `high_confidence: true`
- Если `similarity >= threshold (0.8)` → возвращается список suggestions
- Пользователь выбирает вопрос и выполняет скрипт через `/api/agent-scripts/:id/execute`

**Преимущества:**
- Семантический поиск (понимает синонимы и перефразировки)
- Использует IVFFlat индекс для быстрого поиска
- Автоматическая векторизация при сохранении нового скрипта

### 3. Системный промпт (naturalQueryPrompts.js)

Содержит:
- Описание доступных инструментов (DbService.queryRaw, fetch к /api/*)
- Справочник типов связей (link_type): calls, reads_from, updates, inserts_into, imports
- Схему ключевых таблиц: ai_item, link, link_type, chunk_vector, files
- 5 few-shot примеров типовых аналитических запросов

### 4. Методы DbService

| Метод | Описание |
|-------|----------|
| `queryRaw(sql, params)` | Выполнение SELECT и WITH (CTE) запросов |
| `getAgentScriptByExactQuestion(contextCode, question)` | Поиск скрипта по точному совпадению вопроса (используется первым для быстрого кэширования) |
| `searchSimilarQuestions(contextCode, embedding, limit, threshold)` | Векторный поиск похожих вопросов по эмбеддингам (cosine similarity) |
| `saveQuestionEmbedding(scriptId, embedding)` | Сохранение эмбеддинга вопроса для векторного поиска |
| `getQuestionEmbedding(scriptId)` | Получение эмбеддинга вопроса по script_id |
| `fuzzySearchScripts(contextCode, question, threshold)` | FTS-поиск похожих скриптов (fallback если векторный поиск не дал результатов) |
| `saveAgentScript(contextCode, question, script, isValid)` | Сохранение скрипта (автоматически векторизует вопрос) |
| `incrementUsage(scriptId)` | Инкремент счётчика использования |

## Таблица agent_script

```sql
CREATE TABLE public.agent_script (
    id serial PRIMARY KEY,
    context_code text NOT NULL,
    question text NOT NULL,
    script text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    usage_count int DEFAULT 0,
    is_valid boolean DEFAULT false,
    last_result jsonb DEFAULT NULL,
    question_embedding vector(1536) DEFAULT NULL
);

CREATE UNIQUE INDEX idx_agent_script_unique 
    ON public.agent_script (context_code, question);

CREATE INDEX idx_agent_script_question_fts 
    ON public.agent_script USING gin (to_tsvector('russian', question));

CREATE INDEX idx_agent_script_question_embedding
    ON public.agent_script
    USING ivfflat (question_embedding vector_cosine_ops)
    WITH (lists = 100);
```

### Поля таблицы

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | serial | Уникальный идентификатор скрипта |
| `context_code` | text | Контекстный код для изоляции данных |
| `question` | text | Вопрос пользователя на естественном языке |
| `script` | text | Сгенерированный JavaScript код скрипта |
| `created_at` | timestamp | Дата и время создания скрипта |
| `updated_at` | timestamp | Дата и время последнего обновления |
| `usage_count` | int | Счётчик использования скрипта |
| `is_valid` | boolean | Флаг валидности скрипта (false если ошибка при выполнении) |
| `last_result` | jsonb | Последний результат: `{ raw: [...], human: "...", executed_at: "..." }` |
| `question_embedding` | vector(1536) | Вектор эмбеддинга вопроса для семантического поиска |

**Примечание:** Эмбеддинг создаётся автоматически при сохранении нового скрипта.

## Настройки

Настройки векторного поиска находятся в `config.json`:

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

## Эндпоинт /api/v1/natural-query/suggest

Отдельный эндпоинт для получения списка похожих вопросов без выполнения скрипта:

**POST** `/api/v1/natural-query/suggest`

**Request Body:**
```json
{
  "question": "Какие функции вызывают другие функции?",
  "contextCode": "CARL"
}
```

**Query Parameters:**
- `limit` (optional) - Максимальное количество результатов (по умолчанию из config.json)
- `threshold` (optional) - Минимальный порог similarity (по умолчанию из config.json)

**Response:**
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
        "raw": [{ "code": "calls", "label": "calls" }],
        "human": "В проекте используются следующие типы связей...",
        "executed_at": "2024-01-15T10:30:00.000Z"
      }
    }
  ]
}
```

## Миграция существующих вопросов

Для векторизации существующих вопросов в таблице `agent_script` используйте скрипт миграции:

```bash
node tmp/migrate_question_embeddings.js
```

Скрипт:
1. Находит все скрипты без эмбеддингов
2. Векторизует каждый вопрос через `embeddings.embedQuery()`
3. Сохраняет эмбеддинги в колонку `question_embedding` таблицы `agent_script`

**Примечание:** Новые скрипты автоматически векторизуются при сохранении через `saveAgentScript`.

**Примечание:** Поле `last_result` автоматически обновляется при каждом успешном выполнении скрипта и позволяет быстро получить последний результат без повторного выполнения.

## Обработка ошибок

При ошибках выполнения скрипта API возвращает детальную информацию:

- **Поле `error`**: Техническое описание ошибки (для разработчиков)
- **Поле `human`**: Человекочитаемое описание ошибки на русском языке
- **Поле `script`**: Код сгенерированного скрипта для отладки
- **Поле `scriptId`**: ID скрипта, который пытались выполнить

Специальная обработка ошибок типа "is not defined" — система автоматически определяет имя переменной и формирует понятное сообщение.

## Безопасность

- `new Function()` вместо eval() для изоляции scope
- Таймаут 5 сек через `Promise.race()`
- `safeDbService.queryRaw()` разрешает только SELECT-запросы
- Валидация скриптов на опасные паттерны (eval, require, process, fs и т.д.)
- Скрипт помечается `is_valid = false` при ошибке выполнения
- FTS-поиск учитывает только валидные скрипты (`is_valid = true`)

## Frontend UI (NaturalQueryDialog)

Инструмент реализован как компактный плавающий виджет, доступный из **Knowledge Graph** и **Inspector**.

### Основные возможности UI:
1.  **Плавающий интерфейс:**
    *   **Non-modal**: Не блокирует основной интерфейс, позволяя взаимодействовать с графом во время анализа.
    *   **Draggable**: Свободное перемещение по экрану за заголовок.
    *   **Resizable**: Возможность изменять размер окна для комфортной работы с кодом.
2.  **Умный ввод (Smart Input):**
    *   **Autocomplete**: Предлагает варианты из истории успешных запросов при вводе.
    *   **Навигация**: Поддержка управления стрелками (Вверх/Вниз) для выбора из списка.
    *   **Редактирование**: Выбор из списка подставляет текст, но позволяет внести правки перед запуском.
3.  **Визуализация результата:**
    *   **Interpretation**: Текстовое описание ответа на человеческом языке.
    *   **Agent Script**: Просмотр сгенерированного JS-кода с **подсветкой синтаксиса** (Keywords, Strings, SQL).
    *   **Raw Data**: Просмотр сырых данных в формате JSON.
    *   **Copy to Clipboard**: Быстрое копирование кода скрипта во вкладке Agent Script.
4.  **Интеграция с графом:**
    *   Кнопка **"Apply to Filter"** мгновенно применяет результаты анализа к фильтру графа, подсвечивая нужные узлы.

## Пример использования

```javascript
// Запрос через API
const response = await fetch('http://localhost:3001/api/v1/natural-query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    question: 'Топ-10 самых вызываемых функций',
    contextCode: 'CARL'
  })
});

const result = await response.json();
console.log(result.human);  // "Топ-10 функций по количеству вызовов: ..."
console.log(result.raw);    // [{ called_function: 'fn1', calls_count: 42 }, ...]
```
