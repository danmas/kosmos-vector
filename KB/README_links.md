# Как строятся связи уровня L1 (граф зависимостей) в системе

## Общий процесс

1. При векторизации файлов (JS, SQL, MD и др.) парсеры извлекают зависимости.
2. Зависимости сохраняются в чанках с уровнем, связанным с типом зависимости.
3. Все чанки с одним `full_name` привязываются к одному `ai_item`.
4. При запросе `/api/items/:id` или `/api/items_list` возвращаются полные AiItems.
5. Эндпоинт `/api/graph` строит ориентированный граф с **типизированными связями** (label).

## Извлечение зависимостей по языкам

### PL/pgSQL (SQL-файлы)

- Используется функция `parsePlpgsqlFunctionL1(code)`
- Извлекаются:
  - `called_functions` — вызовы других функций
  - `select_from` — таблицы в FROM/JOIN
  - `update_tables` — таблицы в UPDATE
  - `insert_tables` — таблицы в INSERT INTO
- Результат — объект вида:
  ```json
  {
    "called_functions": ["carl_auct._calcAuctPriority", "_getAuctObject"],
    "select_from": ["carl_auct.auction"],
    "update_tables": ["carl_auct.priority"],
    "insert_tables": []
  }
  ```
- Этот объект сохраняется как **один чанк** с `level` начинающимся на `1-` (например, `1-dependencies`).
- В `getFullAiItemByFullName` этот чанк попадает в `l1_deps` как **строка JSON**.

### JavaScript / TypeScript

- Парсер `splitJavaScriptByObjects` извлекает импорты и вызовы.
- Зависимости сохраняются как массив строк в чанке с `level: '1-imports'` или `'1-deps'`.
- В `l1_deps` попадает нормальный массив строк.

### Другие языки

- Аналогично: зависимости → чанк уровня `1-...` → попадают в `l1_deps`.

## Формирование графа — `/api/graph`

Эндпоинт `/api/graph` (GET) возвращает:

```json
{
  "nodes": [ /* массив GraphNode */ ],
  "links": [
    {
      "source": "string",
      "target": "string",
      "label": "string"   // тип зависимости
    }
  ]
}
```

### Логика построения связей

1. Берутся все `AiItem` через `getAllFullAiItems`.
2. Для каждого `item.l1_deps`:
   - Если элемент — строка → пытаемся распарсить как JSON (случай SQL).
   - Если элемент — массив → используем напрямую.
3. Из распарсенного объекта извлекаются все массивы по известным ключам:
   - `called_functions`
   - `select_from`
   - `update_tables`
   - `insert_tables`
   - `dependencies`, `imports`
4. Для каждого значения создаётся связь с соответствующим **label**.

### Маппинг ключей → label (человекочитаемые метки)

| Ключ в чанке          | Label в графе       | Значение                          |
|-----------------------|---------------------|-----------------------------------|
| `called_functions`    | `calls`             | Функция вызывает другую функцию   |
| `select_from`         | `reads from`        | Чтение данных из таблицы          |
| `update_tables`       | `updates`           | Изменение данных в таблице        |
| `insert_tables`       | `inserts into`      | Вставка данных в таблицу          |
| `dependencies` / `imports` | `depends on`   | Общая/импортная зависимость       |
| Неизвестный ключ      | оригинальный ключ   | fallback                          |

### Пример результата

```json
{
  "links": [
    {
      "source": "carl_auct._TEST_calcAuctPriority",
      "target": "carl_auct._calcAuctPriority",
      "label": "calls"
    },
    {
      "source": "carl_auct._TEST_calcAuctPriority",
      "target": "_getAuctObject",
      "label": "calls"
    },
    {
      "source": "carl_auct.getAuctionData",
      "target": "carl_auct.auction",
      "label": "reads from"
    },
    {
      "source": "utils/api.fetchData",
      "target": "utils/api.buildUrl",
      "label": "depends on"
    }
  ]
}

## Текущее состояние

Граф полностью работает:
- Поддерживает все языки
- Корректно извлекает зависимости из SQL (даже при "сыром" JSON в `l1_deps`)
- Возвращает типизированные связи с `label`

Готов к визуализации в UI (vis.js, cytoscape, react-force-graph и т.д.).

Последнее обновление: 15 декабря 2025
