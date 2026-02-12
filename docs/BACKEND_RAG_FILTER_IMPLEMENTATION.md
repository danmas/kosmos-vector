# Инструкция по реализации фильтрации AI Items в RAG API

**Версия API:** 2.7.1  
**Дата:** 2026-02-08  
**Для:** Backend разработчиков

---

## 📋 Краткое описание задачи

Необходимо добавить поддержку фильтрации AI Items по **типам** и **тегам** в существующие RAG эндпоинты:
- `POST /api/rag/retrieve`
- `POST /api/rag/ask`

Фильтр должен ограничивать набор AI Items (и их чанков), по которым производится векторный поиск и построение контекста.

---

## 🎯 Требования

### 1. Обратная совместимость

✅ **Обязательно сохранить**: поле `itemFilter` — **опциональное**  
✅ Если `itemFilter` не передан → поведение остаётся как сейчас (без фильтрации)  
✅ Старые клиенты без этого поля должны продолжать работать

### 2. Режим фильтрации

На данном этапе поддерживается **только один режим**: `mode: 'expression'`

В будущем возможно добавление `mode: 'ids'` (список конкретных itemIds), но пока не требуется.

---

## 📐 Структура данных

### Новый тип: RAGItemFilter

```typescript
interface RAGItemFilter {
  mode: 'expression';
  typeCodes?: string[];  // Коды типов: 'function', 'class', 'method', и т.д.
  tagCodes?: string[];   // Коды тегов: 'IMP', 'REF', 'DEP', и т.д.
}
```

**Поля:**
- `mode` — **обязательное**, всегда `"expression"`
- `typeCodes` — **опциональное**, массив строк с кодами типов
- `tagCodes` — **опциональное**, массив строк с кодами тегов

### Обновлённый RAGRetrieveRequest

```typescript
interface RAGRetrieveRequest {
  query: string;
  contextCode: string;
  strategy?: 'simple' | 'hierarchical' | 'aiitem' | 'hybrid';
  maxChunks?: number;
  levels?: Array<'0-исходник' | '1-связи' | '2-логика'>;
  includeRelations?: boolean;
  formatting?: {
    style?: 'compact' | 'standard' | 'full' | 'markdown';
    includeFileNames?: boolean;
    includeRelations?: boolean;
    maxTokens?: number;
  };
  itemFilter?: RAGItemFilter;  // ← НОВОЕ ПОЛЕ
}
```

### Обновлённый RAGAskRequest

```typescript
interface RAGAskRequest {
  query: string;
  contextCode: string;
  ragConfig?: {
    strategy?: string;
    maxChunks?: number;
    formatting?: { /* ... */ };
    itemFilter?: RAGItemFilter;  // ← НОВОЕ ПОЛЕ (через ragConfig)
  };
  llmConfig?: { /* ... */ };
}
```

---

## 🔍 Семантика фильтрации

### Логика применения фильтра

**Важно**: фильтр применяется на уровне **AI Items**, а не чанков напрямую.

#### 1. Фильтр по типам (`typeCodes`)

Если `itemFilter.typeCodes` **задано и не пусто**:
- AI Item **проходит** фильтр, если `ai_item.type ∈ itemFilter.typeCodes`
- Пример: `typeCodes: ['function', 'class']` → оставить только функции и классы

Если `itemFilter.typeCodes` **не задано или пусто**:
- Фильтр по типам **не применяется** (все типы допустимы)

#### 2. Фильтр по тегам (`tagCodes`)

Если `itemFilter.tagCodes` **задано и не пусто**:
- AI Item **проходит** фильтр, если у него **хотя бы один** тег с `tag.code ∈ itemFilter.tagCodes`
- Логика: **OR внутри списка тегов**
- Пример: `tagCodes: ['IMP', 'REF']` → оставить элементы, у которых есть хотя бы один из этих тегов

Если `itemFilter.tagCodes` **не задано или пусто**:
- Фильтр по тегам **не применяется**

**Важно**: элементы **без тегов** не проходят фильтр по тегам (если `tagCodes` задано).

#### 3. Комбинация фильтров

Если заданы **оба фильтра** (`typeCodes` И `tagCodes`):
- Применяется логика **AND**: элемент должен удовлетворять **обоим** условиям
- Пример:
  ```
  typeCodes: ['function']
  tagCodes: ['IMP', 'REF']
  
  → Оставить только функции (type), у которых есть тег IMP или REF (tags)
  ```

#### 4. Пустой фильтр

Если `itemFilter`:
- не передан вообще, ИЛИ
- `typeCodes` пусто/не задано И `tagCodes` пусто/не задано

→ Фильтрация **не применяется** (работает как раньше).

---

## 💻 Точки интеграции в код

### 1. Место применения фильтра

**Основная точка**: векторный поиск чанков в базе данных.

**Текущий запрос** (упрощённо):
```sql
SELECT c.id, c.content, c.embedding <=> $queryEmbedding AS distance
FROM chunks c
WHERE c.context_code = $contextCode
  AND c.embedding <=> $queryEmbedding < $threshold
ORDER BY distance
LIMIT $maxChunks;
```

**С фильтром** (добавить JOIN и условия):
```sql
SELECT c.id, c.content, c.embedding <=> $queryEmbedding AS distance
FROM chunks c
JOIN ai_items ai ON c.ai_item_id = ai.id
WHERE 
  c.context_code = $contextCode
  AND c.embedding <=> $queryEmbedding < $threshold
  -- Фильтр по типам:
  AND (
    $typeCodes IS NULL 
    OR ai.type = ANY($typeCodes)
  )
  -- Фильтр по тегам:
  AND (
    $tagCodes IS NULL 
    OR EXISTS (
      SELECT 1 
      FROM ai_item_tags ait
      JOIN tags t ON ait.tag_id = t.id
      WHERE ait.ai_item_id = ai.id 
        AND t.code = ANY($tagCodes)
    )
  )
ORDER BY distance
LIMIT $maxChunks;
```

### 2. Подготовка параметров

Перед выполнением SQL:

```javascript
// Псевдокод
function prepareFilterParams(itemFilter) {
  let typeCodes = null;
  let tagCodes = null;

  if (itemFilter && itemFilter.mode === 'expression') {
    if (itemFilter.typeCodes && itemFilter.typeCodes.length > 0) {
      typeCodes = itemFilter.typeCodes; // массив строк
    }
    if (itemFilter.tagCodes && itemFilter.tagCodes.length > 0) {
      tagCodes = itemFilter.tagCodes; // массив строк
    }
  }

  return { typeCodes, tagCodes };
}

// Использование:
const { typeCodes, tagCodes } = prepareFilterParams(request.itemFilter);

// В SQL передать как параметры: $typeCodes, $tagCodes
```

### 3. Валидация входных данных

**Проверки при получении запроса:**

```javascript
if (request.itemFilter) {
  // 1. Проверить mode
  if (request.itemFilter.mode !== 'expression') {
    return { 
      success: false, 
      error: `Invalid itemFilter.mode: "${request.itemFilter.mode}". Only "expression" is supported.` 
    };
  }

  // 2. Проверить типы массивов
  if (request.itemFilter.typeCodes !== undefined) {
    if (!Array.isArray(request.itemFilter.typeCodes)) {
      return { success: false, error: 'itemFilter.typeCodes must be an array' };
    }
    // Опционально: проверить, что все элементы — строки
    if (!request.itemFilter.typeCodes.every(t => typeof t === 'string')) {
      return { success: false, error: 'itemFilter.typeCodes must contain only strings' };
    }
  }

  if (request.itemFilter.tagCodes !== undefined) {
    if (!Array.isArray(request.itemFilter.tagCodes)) {
      return { success: false, error: 'itemFilter.tagCodes must be an array' };
    }
    if (!request.itemFilter.tagCodes.every(t => typeof t === 'string')) {
      return { success: false, error: 'itemFilter.tagCodes must contain only strings' };
    }
  }
}
```

---

## 📊 Примеры использования

### Пример 1: Фильтр только по типам

**Запрос:**
```json
{
  "query": "Как работает аутентификация?",
  "contextCode": "FULL_TEST",
  "strategy": "hierarchical",
  "maxChunks": 5,
  "itemFilter": {
    "mode": "expression",
    "typeCodes": ["function", "class"]
  }
}
```

**Ожидаемое поведение:**
- Векторный поиск ограничен только функциями и классами
- Методы, модули, таблицы и т.д. исключены
- Если ничего не найдено → `totalChunks: 0`

### Пример 2: Фильтр только по тегам

**Запрос:**
```json
{
  "query": "Критические участки кода",
  "contextCode": "FULL_TEST",
  "itemFilter": {
    "mode": "expression",
    "tagCodes": ["IMP", "CRITICAL"]
  }
}
```

**Ожидаемое поведение:**
- Поиск только среди элементов с тегами `IMP` или `CRITICAL`
- Элементы без тегов исключены
- Элементы с другими тегами (например, только `REF`) исключены

### Пример 3: Комбинированный фильтр

**Запрос:**
```json
{
  "query": "SQL функции требующие рефакторинга",
  "contextCode": "FULL_TEST",
  "itemFilter": {
    "mode": "expression",
    "typeCodes": ["function"],
    "tagCodes": ["REF", "DEPRECATED"]
  }
}
```

**Ожидаемое поведение:**
- Поиск только среди **функций** (type = 'function')
- Которые имеют тег `REF` **или** `DEPRECATED`
- Функции без этих тегов исключены
- Классы/методы с этими тегами тоже исключены (не проходят по типу)

### Пример 4: Без фильтра (обратная совместимость)

**Запрос:**
```json
{
  "query": "Что делает validateUser?",
  "contextCode": "FULL_TEST",
  "strategy": "simple"
}
```

**Ожидаемое поведение:**
- `itemFilter` не передан → фильтрация **не применяется**
- Работает как раньше (поиск по всем AI Items)

### Пример 5: Пустой фильтр

**Запрос:**
```json
{
  "query": "Архитектура системы",
  "contextCode": "FULL_TEST",
  "itemFilter": {
    "mode": "expression"
  }
}
```

**Ожидаемое поведение:**
- `typeCodes` и `tagCodes` не заданы → фильтрация **не применяется**
- Эквивалентно отсутствию `itemFilter`

---

## 🧪 Тестовые сценарии

### Тест 1: Без фильтра (baseline)
```
Запрос: query="test", itemFilter=undefined
Ожидание: вернуть чанки как обычно (5 штук, если есть)
```

### Тест 2: Фильтр по одному типу
```
Запрос: itemFilter={ mode: 'expression', typeCodes: ['function'] }
Ожидание: только чанки из AI Items типа 'function'
Проверка: response.context.metadata.usedChunkIds → все относятся к функциям
```

### Тест 3: Фильтр по нескольким типам
```
Запрос: itemFilter={ mode: 'expression', typeCodes: ['function', 'class'] }
Ожидание: чанки из функций и классов
Проверка: нет чанков из методов, таблиц и т.д.
```

### Тест 4: Фильтр по тегам
```
Запрос: itemFilter={ mode: 'expression', tagCodes: ['IMP'] }
Ожидание: только чанки из AI Items с тегом 'IMP'
Проверка: каждый AI Item в результате имеет тег IMP
```

### Тест 5: Комбинированный фильтр (type AND tags)
```
Запрос: itemFilter={ 
  mode: 'expression', 
  typeCodes: ['function'], 
  tagCodes: ['IMP', 'REF'] 
}
Ожидание: только функции с тегами IMP или REF
Проверка: все чанки относятся к функциям И имеют хотя бы один из указанных тегов
```

### Тест 6: Пустой результат
```
Запрос: itemFilter={ mode: 'expression', tagCodes: ['NONEXISTENT_TAG'] }
Ожидание: 
  - success: true
  - context.metadata.totalChunks: 0
  - context.formatted: "" (пустая строка)
  - НЕ выбрасывать ошибку
```

### Тест 7: Некорректный mode
```
Запрос: itemFilter={ mode: 'invalid_mode' }
Ожидание: 
  - success: false
  - error: "Invalid itemFilter.mode..."
```

### Тест 8: Некорректный формат typeCodes
```
Запрос: itemFilter={ mode: 'expression', typeCodes: 'function' }  // строка вместо массива
Ожидание:
  - success: false
  - error: "itemFilter.typeCodes must be an array"
```

---

## 🔄 Обработка в стратегиях RAG

Фильтр должен применяться **во всех стратегиях**:

### Simple Strategy
- Применить фильтр на этапе векторного поиска чанков
- Ограничить `WHERE ai_item.type IN (...)` и/или `EXISTS tag IN (...)`

### Hierarchical Strategy
- Применить фильтр на этапе поиска L0-чанков
- При построении L1/L2 для найденных AI Items фильтр **не применяется** (используются все связанные элементы)
- **Важно**: если найден чанк из функции `foo`, её L1-зависимости (например, класс `Bar`) включаются в результат, даже если `Bar` не проходит фильтр

### AI Item Strategy
- Применить фильтр при поиске AI Items по векторному запросу
- Затем для найденных элементов собрать все их чанки (L0, L1, L2) без дополнительной фильтрации

### Hybrid Strategy
- Применить фильтр согласно логике комбинированного подхода

---

## 📈 Влияние на производительность

### Оптимизации

1. **Индексы на ai_items.type**:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_ai_items_type 
   ON ai_items(type);
   ```

2. **Индексы на tags.code**:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_tags_code 
   ON tags(code);
   ```

3. **Составной индекс на ai_item_tags**:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_ai_item_tags_item_tag 
   ON ai_item_tags(ai_item_id, tag_id);
   ```

### Ожидаемое замедление

- Без фильтра: **0ms** (как сейчас)
- С фильтром по типам: **+5-15ms** (JOIN + WHERE)
- С фильтром по тегам: **+10-30ms** (JOIN + EXISTS + subquery)
- С обоими фильтрами: **+15-40ms** (суммарно)

При наличии индексов и оптимизированных запросах замедление должно быть **приемлемым** (<50ms дополнительно).

---

## 🚨 Граничные случаи

### 1. Пустой результат (totalChunks = 0)

**Ситуация**: фильтр настроен, но ничего не найдено.

**Ожидаемое поведение**:
```json
{
  "success": true,
  "context": {
    "formatted": "",
    "sections": [],
    "metadata": {
      "totalChunks": 0,
      "totalTokens": 0,
      "usedChunkIds": [],
      "strategy": "hierarchical",
      "formattingStyle": "standard"
    }
  },
  "retrievalTime": 150,
  "timestamp": "2026-02-08T12:34:56.789Z"
}
```

**НЕ выбрасывать ошибку** — это валидный сценарий.

### 2. Некорректный код типа/тега

**Ситуация**: `typeCodes: ['unknown_type']` или `tagCodes: ['NONEXISTENT']`

**Ожидаемое поведение**:
- Не выбрасывать ошибку валидации
- Просто ничего не найти (totalChunks = 0)
- SQL запрос вернёт пустой результат

**Обоснование**: типы и теги могут меняться, жёсткая валидация усложнит систему.

### 3. Очень длинные массивы

**Ситуация**: `typeCodes` или `tagCodes` содержат 100+ элементов.

**Ожидаемое поведение**:
- Поддержать (не ограничивать жёстко)
- Если возникают проблемы с производительностью → логировать warning
- Опционально: установить разумный лимит (например, 50 элементов) и вернуть ошибку при превышении

### 4. Null/undefined в массивах

**Ситуация**: `typeCodes: ['function', null, 'class']`

**Ожидаемое поведение**:
- Отфильтровать null/undefined перед выполнением SQL
- Или вернуть ошибку валидации (предпочтительно)

---

## 📝 Изменения в API контракте

### Файл: `contract/api-contract.yaml`

**Секция**: `components/schemas/RAGRetrieveRequest`

Добавить новое поле после `formatting`:

```yaml
itemFilter:
  type: object
  required: false
  description: |
    Фильтр AI Items по типам и тегам.
    Если не передан, фильтрация не применяется (обратная совместимость).
  properties:
    mode:
      type: string
      enum: [expression]
      description: "Режим фильтрации. На данный момент поддерживается только 'expression'."
      example: "expression"
    typeCodes:
      type: array
      items:
        type: string
      description: |
        Массив кодов типов для фильтрации (например: 'function', 'class', 'method').
        Если задано и не пусто, оставляются только AI Items с типом из этого списка.
      example: ["function", "class"]
    tagCodes:
      type: array
      items:
        type: string
      description: |
        Массив кодов тегов для фильтрации (например: 'IMP', 'REF', 'DEPRECATED').
        Если задано и не пусто, оставляются только AI Items, имеющие хотя бы один тег из этого списка.
        Логика: OR внутри списка.
      example: ["IMP", "REF"]
```

**Секция**: `components/schemas/RAGAskRequest`

В поле `ragConfig` добавить:

```yaml
ragConfig:
  type: object
  properties:
    strategy:
      # ... существующее
    maxChunks:
      # ... существующее
    formatting:
      # ... существующее
    itemFilter:
      $ref: '#/components/schemas/RAGItemFilter'  # ссылка на новую схему
```

Создать отдельную схему для переиспользования:

```yaml
components:
  schemas:
    RAGItemFilter:
      type: object
      required:
        - mode
      properties:
        mode:
          type: string
          enum: [expression]
        typeCodes:
          type: array
          items:
            type: string
        tagCodes:
          type: array
          items:
            type: string
```

---

## 🔍 Логирование и отладка

### Рекомендуемые логи

1. **При получении запроса с фильтром**:
   ```
   [RAG/RETRIEVE] itemFilter applied: types=[function, class], tags=[IMP]
   ```

2. **Если фильтр привёл к пустому результату**:
   ```
   [RAG/RETRIEVE] Filter resulted in 0 chunks. Filter: {typeCodes: ['function'], tagCodes: ['NONEXISTENT']}
   ```

3. **Время выполнения с фильтром**:
   ```
   [RAG/RETRIEVE] Query with filter completed in 1,234ms (vectorSearch: 800ms, filterOverhead: 150ms)
   ```

### Отладочная информация

В режиме `LOG_LEVEL=debug` можно выводить:
- Полный SQL запрос с подставленными параметрами
- Количество AI Items до и после фильтрации
- Список отфильтрованных itemIds

---

## ✅ Чеклист для реализации

- [ ] Обновить TypeScript типы (если используются на бэке)
- [ ] Добавить валидацию `itemFilter` в обработчик запроса
- [ ] Модифицировать SQL запросы векторного поиска:
  - [ ] Добавить JOIN с `ai_items`
  - [ ] Добавить условие фильтрации по `typeCodes`
  - [ ] Добавить условие фильтрации по `tagCodes` (EXISTS subquery)
- [ ] Проверить применение фильтра во всех стратегиях:
  - [ ] Simple
  - [ ] Hierarchical
  - [ ] AI Item
  - [ ] Hybrid
- [ ] Убедиться, что при `itemFilter=undefined` поведение не изменилось
- [ ] Обработать граничные случаи:
  - [ ] Пустой результат (totalChunks=0)
  - [ ] Некорректный mode
  - [ ] Некорректный формат массивов
  - [ ] Очень длинные массивы
- [ ] Создать индексы для оптимизации:
  - [ ] `idx_ai_items_type`
  - [ ] `idx_tags_code`
  - [ ] `idx_ai_item_tags_item_tag`
- [ ] Обновить API контракт (`api-contract.yaml`)
- [ ] Добавить логирование для отладки
- [ ] Написать юнит-тесты:
  - [ ] Без фильтра
  - [ ] Фильтр по типам
  - [ ] Фильтр по тегам
  - [ ] Комбинированный фильтр
  - [ ] Пустой результат
  - [ ] Некорректные данные
- [ ] Провести ручное тестирование с фронтендом
- [ ] Измерить влияние на производительность

---

## 📞 Контакты для вопросов

Если возникнут вопросы по реализации:
1. Проверьте существующую логику фильтрации в UI: `KB/README_FILTERS.md`
2. Изучите схему данных: таблицы `ai_items`, `tags`, `ai_item_tags`
3. Обратитесь к фронтенд-разработчикам за уточнениями по логике

---

## 🎯 Ожидаемый результат

После реализации:

1. **Фронтенд сможет**:
   - Передавать фильтр в RAG запросы
   - Ограничивать контекст определёнными типами и тегами
   - Получать релевантные результаты в рамках выбранных критериев

2. **Пользователи смогут**:
   - Искать только в функциях с тегом "Important"
   - Анализировать только SQL-код
   - Фокусироваться на элементах с определёнными метками
   - Исключать устаревший код из анализа

3. **Обратная совместимость**:
   - Старые клиенты продолжат работать без изменений
   - Новый функционал активируется только при явной передаче `itemFilter`

---

**Версия документа:** 1.0  
**Статус:** Готов к реализации  
**Приоритет:** Средний (фича для улучшения UX)
