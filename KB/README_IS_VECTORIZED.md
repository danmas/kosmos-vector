# Флаг isVectorized для AI Items

**Версия:** 1.0  
**Дата:** 7 февраля 2026  
**Статус:** Актуально

---

## Обзор

В API добавлен флаг `isVectorized`, который показывает, был ли ai_item векторизован (есть ли хотя бы один чанк с embedding).

Этот флаг позволяет UI отображать статус векторизации элементов без дополнительных запросов к БД.

---

## API Изменения

### GET /api/items-list

**Добавлено поле в ответ:**

```typescript
interface AiItemSummary {
  id: string;
  type: AiItemType;
  language: Language;
  filePath: string;
  tags?: TagSummary[];
  isVectorized?: boolean;  // ✨ НОВОЕ ПОЛЕ
}
```

**Пример ответа:**

```json
[
  {
    "id": "file.ts::function::myFunction",
    "type": "function",
    "language": "typescript",
    "filePath": "src/file.ts",
    "tags": [],
    "isVectorized": true
  },
  {
    "id": "file.ts::class::MyClass",
    "type": "class",
    "language": "typescript",
    "filePath": "src/file.ts",
    "tags": [],
    "isVectorized": false
  }
]
```

**Логика:**
- `isVectorized: true` — у ai_item есть хотя бы один чанк с embedding
- `isVectorized: false` — у ai_item нет чанков с embedding (не векторизован)

---

### GET /api/items/:id

**Добавлено поле в ответ:**

```typescript
interface AiItem {
  id: string;
  type: AiItemType;
  language: Language;
  l0_code: string;
  l1_out: L1Link[];
  l1_in: L1Link[];
  l2_desc: string;
  filePath: string;
  isVectorized?: boolean;  // ✨ НОВОЕ ПОЛЕ
}
```

**Пример ответа:**

```json
{
  "id": "file.ts::function::myFunction",
  "type": "function",
  "language": "typescript",
  "l0_code": "function myFunction() { return 42; }",
  "l1_out": [],
  "l1_in": [],
  "l2_desc": "",
  "filePath": "src/file.ts",
  "isVectorized": true
}
```

---

## Реализация на бэкенде

### SQL запрос для проверки векторизации

```sql
EXISTS(
  SELECT 1 
  FROM public.chunk_vector cv
  WHERE cv.ai_item_id = ai.id 
    AND cv.embedding IS NOT NULL
  LIMIT 1
) as is_vectorized
```

Этот подзапрос добавлен в:
- `GET /api/items-list` ([routes/api.js](file:///c:/ERV/projects-ex/kosmos-vector/routes/api.js#L880-L931))
- Метод `getFullAiItemByFullName` ([packages/core/DbService.js](file:///c:/ERV/projects-ex/kosmos-vector/packages/core/DbService.js#L1858-L1946))

---

## Использование на фронтенде

### TypeScript интерфейс

Обновите `types.ts`:

```typescript
export interface AiItemSummary {
  id: string;
  type: AiItemType;
  language: Language;
  filePath: string;
  tags?: TagSummary[];
  isVectorized?: boolean;  // добавить это поле
}

export interface AiItem {
  id: string;
  type: AiItemType;
  language: Language;
  l0_code: string;
  l1_out: L1Link[];
  l1_in: L1Link[];
  l2_desc: string;
  filePath: string;
  isVectorized?: boolean;  // добавить это поле
}
```

### Пример использования в React

```typescript
// В компоненте Data Inspector
const AiItemRow: React.FC<{ item: AiItemSummary }> = ({ item }) => {
  return (
    <div className="ai-item-row">
      <span className="item-name">{item.id}</span>
      <span className="item-type">{item.type}</span>
      {item.isVectorized ? (
        <Badge color="green">Векторизован</Badge>
      ) : (
        <Badge color="gray">Не векторизован</Badge>
      )}
    </div>
  );
};
```

### Индикатор векторизации

```typescript
// В state компонента Inspector
const [vectorizedItemIds, setVectorizedItemIds] = useState<Set<string>>(new Set());

// При загрузке списка
const loadItems = async () => {
  const response = await fetch(`/api/items-list?context-code=${contextCode}`);
  const items: AiItemSummary[] = await response.json();
  
  // Заполняем set векторизованных элементов
  const vectorized = new Set<string>();
  items.forEach(item => {
    if (item.isVectorized) {
      vectorized.add(item.id);
    }
  });
  
  setVectorizedItemIds(vectorized);
  setItems(items);
};
```

---

## Тестирование

Создан тест для проверки работы флага: [tests/test_is_vectorized_flag.js](file:///c:/ERV/projects-ex/kosmos-vector/tests/test_is_vectorized_flag.js)

**Запуск теста:**

```bash
bun tests/test_is_vectorized_flag.js
```

**Что проверяет тест:**
1. Создает два ai_item: один с embedding, другой без
2. Проверяет GET /api/items-list — флаг `isVectorized` должен быть `true`/`false`
3. Проверяет GET /api/items/:id — флаг `isVectorized` должен быть `true`/`false`

---

## Векторизация элементов

Для векторизации ai_items используйте маршрут:

**POST /vectorize-ai-items**

```bash
curl -X POST "http://localhost:3200/vectorize-ai-items?context-code=MY_CONTEXT" \
  -H "Content-Type: application/json" \
  -d '{
    "fullNames": ["file.ts::function::myFunction"],
    "force": true
  }'
```

После векторизации флаг `isVectorized` автоматически станет `true` при следующем запросе к API.

---

## Связанные файлы

- API Routes: [routes/api.js](file:///c:/ERV/projects-ex/kosmos-vector/routes/api.js)
- DB Service: [packages/core/DbService.js](file:///c:/ERV/projects-ex/kosmos-vector/packages/core/DbService.js)
- API Contract: [docs/api-contract.yaml](file:///c:/ERV/projects-ex/kosmos-vector/docs/api-contract.yaml)
- Test: [tests/test_is_vectorized_flag.js](file:///c:/ERV/projects-ex/kosmos-vector/tests/test_is_vectorized_flag.js)

---

## Примечания

- Флаг `isVectorized` показывает наличие **хотя бы одного** чанка с embedding
- Флаг вычисляется динамически при каждом запросе к API
- Не требует дополнительных таблиц или триггеров в БД
- Производительность: использует EXISTS() с LIMIT 1, поэтому быстро работает даже для больших ai_items
