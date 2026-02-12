# Инструкция для разработчиков: Типы AI Items (справочник)

**Версия:** 1.0  
**Дата:** 11 февраля 2026  
**Статус:** Актуально

---

## Обзор

Справочник **типов AI Items** для фильтрации по аналогии с тегами. Типы определяют сущности: function, class, table, interface и т.д.

- Типы изолированы по `context-code`
- `ai_item.type` — текст (связь мягкая, не FK)
- **Lazy seed**: при первом GET для context автоматически создаются базовые типы (function, class, table, ...)
- Системные типы (`is_system=true`) удалить нельзя; кастомные — можно создавать и удалять

## Структура данных

### ItemType
- `id` — уникальный идентификатор (integer)
- `code` — код типа в рамках context (function, class, table, ...)
- `name` — человекочитаемое название
- `description` — описание (nullable)
- `is_system` — true = системный тип, удаление запрещено
- `created_at`, `updated_at`

## API Эндпоинты

Базовый URL: `http://localhost:{PORT}/api/types?context-code={CONTEXT_CODE}`

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/types` | Список всех типов (lazy seed при первом обращении) |
| POST | `/api/types` | Создать кастомный тип |
| GET | `/api/types/{code}` | Получить тип по коду |
| PUT | `/api/types/{code}` | Обновить (name, description) |
| DELETE | `/api/types/{code}` | Удалить (только is_system=false) |
| GET | `/api/types/{code}/items` | AI Items с указанным типом |

Все эндпоинты требуют `context-code` в query.

## Пример: фильтрация по типу на фронте

```javascript
function AiItemsList({ contextCode }) {
  const [items, setItems] = useState([]);
  const [types, setTypes] = useState([]);
  const [selectedTypeCode, setSelectedTypeCode] = useState(null);

  useEffect(() => {
    loadTypes();
    loadItems();
  }, [contextCode]);

  useEffect(() => {
    loadItems();
  }, [selectedTypeCode]);

  async function loadTypes() {
    const response = await fetch(`/api/types?context-code=${contextCode}`);
    if (response.ok) {
      const data = await response.json();
      setTypes(data.types || []);
    }
  }

  async function loadItems() {
    if (selectedTypeCode) {
      const response = await fetch(
        `/api/types/${selectedTypeCode}/items?context-code=${contextCode}`
      );
      if (response.ok) {
        const data = await response.json();
        setItems(data.items || []);
      }
    } else {
      const response = await fetch(`/api/items-list?context-code=${contextCode}`);
      if (response.ok) {
        const itemsData = await response.json();
        setItems(itemsData || []);
      }
    }
  }

  return (
    <div>
      <select
        value={selectedTypeCode || ''}
        onChange={(e) => setSelectedTypeCode(e.target.value || null)}
      >
        <option value="">Все типы</option>
        {types.map(t => (
          <option key={t.id} value={t.code}>{t.name}</option>
        ))}
      </select>
      {/* список items */}
    </div>
  );
}
```

## Базовые типы (seed)

function, class, method, arrow, interface, trait, table, table_column, view, procedure, trigger, index, sequence, type, domain, schema, role, grant, md_doc, head_level_1, head_level_2

## Миграция БД

Перед использованием выполните SQL:

```
psql -d your_db -f scripts/add_item_type_table.sql
```

---

**Связанная документация:** [README_TAGS.md](README_TAGS.md) — теги, [README_INDEX.md](README_INDEX.md) — оглавление KB
