# Как строятся связи уровня L1 (граф зависимостей) в системе

## Общий процесс

1. При векторизации файлов (JS, SQL, MD и др.) парсеры извлекают зависимости.
2. Зависимости сохраняются в таблице `link` с типом связи через `link_type`.
3. Все чанки с одним `full_name` привязываются к одному `ai_item`.
4. При запросе `/api/items/:id` или `/api/items` связи берутся из таблицы `link` и разделяются на:
   - `l1_out` — исходящие связи (source = текущий элемент)
   - `l1_in` — входящие связи (target = текущий элемент)
5. Эндпоинт `/api/graph` строит ориентированный граф на основе `l1_out`.

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
- Этот объект сохраняется как **один чанк** с `level` начинающимся на `1-` (например, `1-связи`) в `chunk_vector` (legacy, пока не удалено).
- **Основное хранение**: зависимости дублируются в таблицу `link` с соответствующим `link_type_id`.
- При запросе `/api/items/:id` связи берутся из `link` и возвращаются как `l1_out` (массив target'ов).

### JavaScript / TypeScript

- Парсер `splitJavaScriptByObjects` извлекает импорты и вызовы.
- Зависимости сохраняются в таблицу `link` с типом связи.
- При запросе возвращаются как `l1_out` (массив строк).

### Другие языки

- Аналогично: зависимости → таблица `link` → возвращаются как `l1_out` и `l1_in`.

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

1. Берутся все `AiItem` через `getAllFullAiItems` (связи уже загружены из `link`).
2. Для каждого `item.l1_out` (массив строк):
   - Каждый элемент — это `target` связи.
   - Создаётся связь `source = item.id → target` с label "depends on".
3. Проверяется существование target в списке элементов (только валидные связи).

### Маппинг ключей → label (человекочитаемые метки)

| Ключ в чанке          | Label в графе       | Значение                          |
|-----------------------|---------------------|-----------------------------------|
| `called_functions`    | `calls`             | Функция вызывает другую функцию   |
| `select_from`         | `reads from`        | Чтение данных из таблицы          |
| `update_tables`       | `updates`           | Изменение данных в таблице        |
| `insert_tables`       | `inserts into`      | Вставка данных в таблицу          |
| `dependencies` / `imports` | `depends on`   | Общая/импортная зависимость       |
| `reads_column`        | `reads_column`      | Функция читает колонку в SELECT   |
| `updates_column`      | `updates_column`    | Функция обновляет колонку в SET   |
| `inserts_column`      | `inserts_column`    | Функция вставляет в колонку       |
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

## Извлечение колонок (Column Extraction)

Дополнительно к связям с таблицами, система может извлекать связи с отдельными колонками таблиц.

### Процесс

1. Парсим тело SQL-функции (из ai_item типа `function`)
2. Извлекаем алиасы таблиц из FROM/JOIN
3. Находим колонки в SELECT, UPDATE SET, INSERT
4. Резолвим полные имена колонок через ранее загруженные таблицы
5. Создаём ai_item типа `table_column` для каждой уникальной колонки
6. Сохраняем связи function→column в таблицу link

### Формат full_name для колонок

```
schema.table.column
```

Примеры:
- `carl_data.label.id_label`
- `hr.employees.first_name`

### API

**POST** `/api/items/:id/extract-columns?context-code=...`

Извлекает колонки из одной SQL-функции по её full_name.

**POST** `/api/extract-all-columns?context-code=...`

Пакетное извлечение колонок из **всех** SQL-функций в контексте. Рекомендуется запускать после загрузки всех таблиц и функций.

### Типы связей

| link_type | Описание |
|-----------|----------|
| reads_column | Колонка в SELECT |
| updates_column | Колонка в UPDATE SET |
| inserts_column | Колонка в INSERT |

## Текущее состояние

Граф полностью работает:
- Поддерживает все языки
- Связи берутся из таблицы `link` (проверяется существование source и target в `ai_item`)
- Возвращает связи с label "depends on" (детализация типов связей — в будущем)
- Поддерживает связи с колонками таблиц

Готов к визуализации в UI (vis.js, cytoscape, react-force-graph и т.д.).

Последнее обновление: 22 января 2026
