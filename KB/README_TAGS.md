# Инструкция для разработчиков интерфейсов: Теги для AI Items

**Версия:** 1.0  
**Дата:** 27 декабря 2025  
**Статус:** Актуально

---

## Обзор

В системе добавлена функциональность **тегов для классификации и группировки AI Items**. Теги позволяют:

- Классифицировать AI Items по различным критериям (например, "deprecated", "needs-review", "critical")
- Группировать AI Items для быстрого поиска и фильтрации
- Организовывать работу с большими кодовыми базами

Теги изолированы по `context-code` и связаны с AI Items через many-to-many связь. Один AI Item может иметь несколько тегов, один тег может быть назначен нескольким AI Items.

## Структура данных

### Tag (Тег)
- `id` — уникальный идентификатор (integer)
- `code` — уникальный код тега в рамках context-code (string, до 50 символов)
- `name` — название тега (string, до 100 символов)
- `description` — описание тега (string, до 500 символов, nullable)
- `created_at` — время создания (date-time)
- `updated_at` — время последнего обновления (date-time, nullable)

### Связь AI Item - Tag
- Связь many-to-many через таблицу `ai_item_tag`
- AI Item идентифицируется парой `(full_name, context_code)`
- Tag идентифицируется по `id` и связывается через `tag_id`

## API Эндпоинты

### Базовый URL

```
http://localhost:{PORT}/api/tags?context-code={CONTEXT_CODE}
http://localhost:{PORT}/api/items/{id}/tags?context-code={CONTEXT_CODE}
```

Где:
- `{PORT}` — порт сервера (по умолчанию 3005 или из конфигурации)
- `{CONTEXT_CODE}` — контекстный код (обязательный query параметр)
- `{id}` — `full_name` AI Item (должен быть URL-encoded)

---

## 1. Управление тегами (CRUD)

### 1.1. Получить список всех тегов

**GET** `/api/tags?context-code={CONTEXT_CODE}`

**Пример запроса:**
```javascript
const contextCode = 'CARL';
const response = await fetch(
  `http://localhost:3005/api/tags?context-code=${contextCode}`
);
const data = await response.json();
```

**Успешный ответ (200):**
```json
{
  "success": true,
  "tags": [
    {
      "id": 1,
      "code": "deprecated",
      "name": "Устаревший код",
      "description": "Код, который планируется удалить или переработать",
      "created_at": "2025-12-27T10:00:00.000Z",
      "updated_at": null
    },
    {
      "id": 2,
      "code": "needs-review",
      "name": "Требует проверки",
      "description": "Код требует code review",
      "created_at": "2025-12-27T10:05:00.000Z",
      "updated_at": "2025-12-27T11:00:00.000Z"
    }
  ]
}
```

### 1.2. Создать новый тег

**POST** `/api/tags?context-code={CONTEXT_CODE}`

**Пример запроса:**
```javascript
const contextCode = 'CARL';
const response = await fetch(
  `http://localhost:3005/api/tags?context-code=${contextCode}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code: 'deprecated',
      name: 'Устаревший код',
      description: 'Код, который планируется удалить или переработать'
    })
  }
);
const data = await response.json();
```

**Успешный ответ (201):**
```json
{
  "success": true,
  "tag": {
    "id": 1,
    "code": "deprecated",
    "name": "Устаревший код",
    "description": "Код, который планируется удалить или переработать",
    "created_at": "2025-12-27T10:00:00.000Z",
    "updated_at": null
  }
}
```

**Ошибка конфликта (409):**
```json
{
  "success": false,
  "error": "Tag with code 'deprecated' already exists"
}
```

### 1.3. Получить тег по коду

**GET** `/api/tags/{code}?context-code={CONTEXT_CODE}`

**Пример запроса:**
```javascript
const contextCode = 'CARL';
const tagCode = 'deprecated';
const response = await fetch(
  `http://localhost:3005/api/tags/${tagCode}?context-code=${contextCode}`
);
const data = await response.json();
```

**Успешный ответ (200):** Аналогичен созданию тега (TagResponse)

**Если тег не найден (404):**
```json
{
  "success": false,
  "error": "Tag not found: deprecated"
}
```

### 1.4. Обновить тег

**PUT** `/api/tags/{code}?context-code={CONTEXT_CODE}`

**Пример запроса:**
```javascript
const contextCode = 'CARL';
const tagCode = 'deprecated';
const response = await fetch(
  `http://localhost:3005/api/tags/${tagCode}?context-code=${contextCode}`,
  {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Устаревший код (переработать)',
      description: 'Код требует рефакторинга или удаления'
    })
  }
);
```

**Важно:** Код тега изменить нельзя. Можно обновить только `name` и `description`.

### 1.5. Удалить тег

**DELETE** `/api/tags/{code}?context-code={CONTEXT_CODE}&force={FORCE}`

**Пример запроса:**
```javascript
const contextCode = 'CARL';
const tagCode = 'deprecated';
const force = false; // по умолчанию false

const response = await fetch(
  `http://localhost:3005/api/tags/${tagCode}?context-code=${contextCode}&force=${force}`,
  {
    method: 'DELETE'
  }
);
```

**Успешный ответ (200):**
```json
{
  "success": true,
  "message": "Tag deleted successfully"
}
```

**Ошибка конфликта (409) — тег используется:**
```json
{
  "success": false,
  "error": "Tag is used by AI Items. Use force=true to delete anyway"
}
```

**Параметр `force`:**
- `force=false` (по умолчанию) — если тег используется AI Items, возвращает ошибку 409
- `force=true` — принудительно удаляет тег и все его связи с AI Items

### 1.6. Получить AI Items с указанным тегом

**GET** `/api/tags/{code}/items?context-code={CONTEXT_CODE}`

**Пример запроса:**
```javascript
const contextCode = 'CARL';
const tagCode = 'deprecated';
const response = await fetch(
  `http://localhost:3005/api/tags/${tagCode}/items?context-code=${contextCode}`
);
const data = await response.json();
```

**Успешный ответ (200):**
```json
{
  "success": true,
  "tag": {
    "id": 1,
    "code": "deprecated",
    "name": "Устаревший код",
    "description": "Код, который планируется удалить или переработать",
    "created_at": "2025-12-27T10:00:00.000Z",
    "updated_at": null
  },
  "items": [
    {
      "id": "utils.fetchData",
      "type": "function",
      "language": "javascript",
      "filePath": "./src/utils/api.ts"
    },
    {
      "id": "DbService.saveFile",
      "type": "method",
      "language": "javascript",
      "filePath": "./src/DbService.js"
    }
  ]
}
```

---

## 2. Управление тегами AI Item

### 2.1. Получить теги AI Item

**GET** `/api/items/{id}/tags?context-code={CONTEXT_CODE}`

**Пример запроса:**
```javascript
const itemId = encodeURIComponent('utils.fetchData');
const contextCode = 'CARL';
const response = await fetch(
  `http://localhost:3005/api/items/${itemId}/tags?context-code=${contextCode}`
);
const data = await response.json();
```

**Успешный ответ (200):**
```json
{
  "success": true,
  "itemId": "utils.fetchData",
  "tags": [
    {
      "id": 1,
      "code": "deprecated",
      "name": "Устаревший код",
      "description": "Код, который планируется удалить или переработать",
      "created_at": "2025-12-27T10:00:00.000Z",
      "updated_at": null
    },
    {
      "id": 2,
      "code": "needs-review",
      "name": "Требует проверки",
      "description": null,
      "created_at": "2025-12-27T10:05:00.000Z",
      "updated_at": null
    }
  ]
}
```

**Если AI Item не найден (404):**
```json
{
  "success": false,
  "error": "AI Item not found: utils.fetchData"
}
```

**Обработка в UI:**
```javascript
if (response.ok) {
  const tags = data.tags || [];
  // Отобразить теги (может быть пустой массив)
} else if (response.status === 404) {
  // AI Item не найден
}
```

### 2.2. Добавить теги к AI Item (bulk)

**POST** `/api/items/{id}/tags?context-code={CONTEXT_CODE}`

**Пример запроса:**
```javascript
const itemId = encodeURIComponent('utils.fetchData');
const contextCode = 'CARL';
const response = await fetch(
  `http://localhost:3005/api/items/${itemId}/tags?context-code=${contextCode}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tagCodes: ['deprecated', 'needs-review']
    })
  }
);
const data = await response.json();
```

**Успешный ответ (200):** Аналогичен GET — возвращает обновленный список тегов

**Особенности:**
- Операция idempotent: если тег уже связан с AI Item, он будет проигнорирован
- Можно добавить несколько тегов одним запросом
- Если один из тегов не найден, возвращается ошибка 404

### 2.3. Удалить теги у AI Item (bulk)

**DELETE** `/api/items/{id}/tags?context-code={CONTEXT_CODE}`

**Пример запроса:**
```javascript
const itemId = encodeURIComponent('utils.fetchData');
const contextCode = 'CARL';
const response = await fetch(
  `http://localhost:3005/api/items/${itemId}/tags?context-code=${contextCode}`,
  {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tagCodes: ['deprecated', 'needs-review']
    })
  }
);
```

**Особенности:**
- Операция idempotent: если тег не связан с AI Item, он будет проигнорирован
- Можно удалить несколько тегов одним запросом

### 2.4. Синхронизировать теги AI Item (заменить все)

**PUT** `/api/items/{id}/tags?context-code={CONTEXT_CODE}`

**Пример запроса:**
```javascript
const itemId = encodeURIComponent('utils.fetchData');
const contextCode = 'CARL';
const response = await fetch(
  `http://localhost:3005/api/items/${itemId}/tags?context-code=${contextCode}`,
  {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tagCodes: ['critical', 'reviewed'] // Заменяет все существующие теги
    })
  }
);
```

**Особенности:**
- Полностью заменяет все теги AI Item на указанный список
- Если массив пуст (`tagCodes: []`), все теги будут удалены
- Удобно для UI с multi-select, где пользователь выбирает финальный набор тегов

---

## Рекомендации по реализации UI

### 1. Отображение тегов в карточке AI Item

**Вариант A: Бейджи с тегами**
```javascript
function AiItemCard({ item, contextCode }) {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTags(item.id, contextCode);
  }, [item.id, contextCode]);

  async function loadTags(itemId, contextCode) {
    try {
      const encodedId = encodeURIComponent(itemId);
      const response = await fetch(
        `/api/items/${encodedId}/tags?context-code=${contextCode}`
      );
      if (response.ok) {
        const data = await response.json();
        setTags(data.tags || []);
      }
    } catch (error) {
      console.error('Ошибка загрузки тегов:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ai-item-card">
      <h3>{item.id}</h3>
      <div className="tags-section">
        {loading ? (
          <span>Загрузка тегов...</span>
        ) : (
          <div className="tags-list">
            {tags.map(tag => (
              <span key={tag.id} className="tag-badge" title={tag.description}>
                {tag.name}
              </span>
            ))}
            {tags.length === 0 && (
              <span className="no-tags">Теги отсутствуют</span>
            )}
          </div>
        )}
        <button onClick={() => showTagEditor(item.id)}>
          {tags.length > 0 ? 'Изменить теги' : 'Добавить теги'}
        </button>
      </div>
    </div>
  );
}
```

**Вариант B: Список тегов в модальном окне деталей**
```javascript
function AiItemDetailsModal({ item, contextCode, onClose }) {
  const [tags, setTags] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [editing, setEditing] = useState(false);
  const [selectedTagCodes, setSelectedTagCodes] = useState([]);

  useEffect(() => {
    loadTags();
    loadAllTags();
  }, []);

  async function loadTags() {
    const encodedId = encodeURIComponent(item.id);
    const response = await fetch(
      `/api/items/${encodedId}/tags?context-code=${contextCode}`
    );
    if (response.ok) {
      const data = await response.json();
      setTags(data.tags || []);
      setSelectedTagCodes(data.tags.map(t => t.code));
    }
  }

  async function loadAllTags() {
    const response = await fetch(
      `/api/tags?context-code=${contextCode}`
    );
    if (response.ok) {
      const data = await response.json();
      setAllTags(data.tags || []);
    }
  }

  async function saveTags() {
    const encodedId = encodeURIComponent(item.id);
    const response = await fetch(
      `/api/items/${encodedId}/tags?context-code=${contextCode}`,
      {
        method: 'PUT', // Синхронизация (замена всех)
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagCodes: selectedTagCodes })
      }
    );
    if (response.ok) {
      await loadTags();
      setEditing(false);
    }
  }

  return (
    <Modal>
      <h2>{item.id}</h2>
      <div className="tags-section">
        <h3>Теги</h3>
        {editing ? (
          <div>
            <div className="tags-selector">
              {allTags.map(tag => (
                <label key={tag.id}>
                  <input
                    type="checkbox"
                    checked={selectedTagCodes.includes(tag.code)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedTagCodes([...selectedTagCodes, tag.code]);
                      } else {
                        setSelectedTagCodes(selectedTagCodes.filter(c => c !== tag.code));
                      }
                    }}
                  />
                  {tag.name}
                  {tag.description && <span className="tag-description"> — {tag.description}</span>}
                </label>
              ))}
            </div>
            <button onClick={saveTags}>Сохранить</button>
            <button onClick={() => { setEditing(false); loadTags(); }}>Отмена</button>
          </div>
        ) : (
          <div>
            {tags.length > 0 ? (
              <>
                <div className="tags-list">
                  {tags.map(tag => (
                    <span key={tag.id} className="tag-badge">
                      {tag.name}
                    </span>
                  ))}
                </div>
                <button onClick={() => setEditing(true)}>Изменить теги</button>
              </>
            ) : (
              <>
                <p>Теги отсутствуют</p>
                <button onClick={() => setEditing(true)}>Добавить теги</button>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
```

### 2. Управление тегами (список всех тегов)

```javascript
function TagsManager({ contextCode }) {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);

  useEffect(() => {
    loadTags();
  }, [contextCode]);

  async function loadTags() {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/tags?context-code=${contextCode}`
      );
      if (response.ok) {
        const data = await response.json();
        setTags(data.tags || []);
      }
    } catch (error) {
      console.error('Ошибка загрузки тегов:', error);
    } finally {
      setLoading(false);
    }
  }

  async function deleteTag(tagCode, force = false) {
    if (!confirm('Удалить тег? Это действие нельзя отменить.')) return;
    
    const url = `/api/tags/${tagCode}?context-code=${contextCode}&force=${force}`;
    const response = await fetch(url, { method: 'DELETE' });
    
    if (response.ok) {
      await loadTags();
    } else if (response.status === 409) {
      const useForce = confirm(
        'Тег используется AI Items. Удалить принудительно? Все связи будут удалены.'
      );
      if (useForce) {
        await deleteTag(tagCode, true);
      }
    }
  }

  if (loading) return <div>Загрузка тегов...</div>;

  return (
    <div className="tags-manager">
      <div className="tags-header">
        <h2>Управление тегами</h2>
        <button onClick={() => setShowCreateForm(true)}>Создать тег</button>
      </div>
      
      {showCreateForm && (
        <TagCreateForm
          contextCode={contextCode}
          onSuccess={() => {
            setShowCreateForm(false);
            loadTags();
          }}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      <div className="tags-list">
        {tags.map(tag => (
          <div key={tag.id} className="tag-item">
            <div className="tag-info">
              <span className="tag-code">{tag.code}</span>
              <span className="tag-name">{tag.name}</span>
              {tag.description && (
                <span className="tag-description">{tag.description}</span>
              )}
            </div>
            <div className="tag-actions">
              <button onClick={() => showTagEditor(tag)}>Редактировать</button>
              <button onClick={() => deleteTag(tag.code)}>Удалить</button>
              <button onClick={() => showTagItems(tag.code)}>
                Показать AI Items ({tag.itemsCount || 0})
              </button>
            </div>
          </div>
        ))}
        {tags.length === 0 && (
          <p>Теги отсутствуют. Создайте первый тег.</p>
        )}
      </div>
    </div>
  );
}
```

### 3. Фильтрация AI Items по тегам

```javascript
function AiItemsList({ contextCode }) {
  const [items, setItems] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedTagCode, setSelectedTagCode] = useState(null);

  useEffect(() => {
    loadTags();
    loadItems();
  }, [contextCode]);

  useEffect(() => {
    loadItems();
  }, [selectedTagCode]);

  async function loadTags() {
    const response = await fetch(`/api/tags?context-code=${contextCode}`);
    if (response.ok) {
      const data = await response.json();
      setTags(data.tags || []);
    }
  }

  async function loadItems() {
    let url = `/api/items-list?context-code=${contextCode}`;
    
    if (selectedTagCode) {
      // Загружаем AI Items с выбранным тегом
      const response = await fetch(
        `/api/tags/${selectedTagCode}/items?context-code=${contextCode}`
      );
      if (response.ok) {
        const data = await response.json();
        setItems(data.items || []);
      }
    } else {
      // Загружаем все AI Items
      const response = await fetch(url);
      if (response.ok) {
        const itemsData = await response.json();
        setItems(itemsData || []);
      }
    }
  }

  return (
    <div className="ai-items-list">
      <div className="filters">
        <label>
          Фильтр по тегу:
          <select
            value={selectedTagCode || ''}
            onChange={(e) => setSelectedTagCode(e.target.value || null)}
          >
            <option value="">Все теги</option>
            {tags.map(tag => (
              <option key={tag.id} value={tag.code}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      
      <div className="items-grid">
        {items.map(item => (
          <AiItemCard key={item.id} item={item} contextCode={contextCode} />
        ))}
      </div>
    </div>
  );
}
```

### 4. React Hook для работы с тегами AI Item

```javascript
function useAiItemTags(itemId, contextCode) {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadTags = async () => {
    setLoading(true);
    setError(null);
    try {
      const encodedId = encodeURIComponent(itemId);
      const response = await fetch(
        `/api/items/${encodedId}/tags?context-code=${contextCode}`
      );
      if (response.ok) {
        const data = await response.json();
        setTags(data.tags || []);
      } else if (response.status === 404) {
        setTags([]);
      } else {
        const data = await response.json();
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const addTags = async (tagCodes) => {
    setLoading(true);
    setError(null);
    try {
      const encodedId = encodeURIComponent(itemId);
      const response = await fetch(
        `/api/items/${encodedId}/tags?context-code=${contextCode}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagCodes })
        }
      );
      if (response.ok) {
        const data = await response.json();
        setTags(data.tags || []);
        return { success: true };
      } else {
        const data = await response.json();
        setError(data.error);
        return { success: false, error: data.error };
      }
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  const removeTags = async (tagCodes) => {
    setLoading(true);
    setError(null);
    try {
      const encodedId = encodeURIComponent(itemId);
      const response = await fetch(
        `/api/items/${encodedId}/tags?context-code=${contextCode}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagCodes })
        }
      );
      if (response.ok) {
        const data = await response.json();
        setTags(data.tags || []);
        return { success: true };
      } else {
        const data = await response.json();
        setError(data.error);
        return { success: false, error: data.error };
      }
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  const syncTags = async (tagCodes) => {
    setLoading(true);
    setError(null);
    try {
      const encodedId = encodeURIComponent(itemId);
      const response = await fetch(
        `/api/items/${encodedId}/tags?context-code=${contextCode}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagCodes })
        }
      );
      if (response.ok) {
        const data = await response.json();
        setTags(data.tags || []);
        return { success: true };
      } else {
        const data = await response.json();
        setError(data.error);
        return { success: false, error: data.error };
      }
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  return {
    tags,
    loading,
    error,
    loadTags,
    addTags,
    removeTags,
    syncTags
  };
}
```

### 5. React Hook для работы с тегами (CRUD)

```javascript
function useTags(contextCode) {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadTags = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/tags?context-code=${contextCode}`);
      if (response.ok) {
        const data = await response.json();
        setTags(data.tags || []);
      } else {
        const data = await response.json();
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const createTag = async (tagData) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/tags?context-code=${contextCode}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tagData)
        }
      );
      if (response.ok || response.status === 201) {
        const data = await response.json();
        await loadTags();
        return { success: true, tag: data.tag };
      } else {
        const data = await response.json();
        setError(data.error);
        return { success: false, error: data.error };
      }
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  const updateTag = async (tagCode, tagData) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/tags/${tagCode}?context-code=${contextCode}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tagData)
        }
      );
      if (response.ok) {
        await loadTags();
        return { success: true };
      } else {
        const data = await response.json();
        setError(data.error);
        return { success: false, error: data.error };
      }
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  const deleteTag = async (tagCode, force = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/tags/${tagCode}?context-code=${contextCode}&force=${force}`,
        { method: 'DELETE' }
      );
      if (response.ok) {
        await loadTags();
        return { success: true };
      } else if (response.status === 409) {
        return { success: false, error: 'Tag is used', requiresForce: true };
      } else {
        const data = await response.json();
        setError(data.error);
        return { success: false, error: data.error };
      }
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  return {
    tags,
    loading,
    error,
    loadTags,
    createTag,
    updateTag,
    deleteTag
  };
}
```

## Важные замечания

1. **URL-encoding:** Всегда используйте `encodeURIComponent()` для `itemId` (full_name), так как он может содержать специальные символы (точки, слеши и т.д.)

2. **Context Code:** Параметр `context-code` обязателен для всех операций. Убедитесь, что он передается в каждом запросе.

3. **Код тега:** Код тега (`code`) уникален в рамках context-code и используется как идентификатор. Код тега нельзя изменить после создания (можно только удалить и создать заново).

4. **Many-to-Many связь:** Один AI Item может иметь несколько тегов, один тег может быть назначен нескольким AI Items.

5. **Bulk операции:** Операции добавления и удаления тегов поддерживают bulk операции — можно добавить/удалить несколько тегов одним запросом.

6. **Синхронизация (PUT):** Используйте PUT для синхронизации тегов — это заменяет все существующие теги на указанный список. Удобно для UI с multi-select.

7. **Удаление тега:** При удалении тега, который используется AI Items:
   - По умолчанию (`force=false`) — возвращается ошибка 409
   - С `force=true` — тег и все его связи удаляются

8. **Валидация кода тега:**
   - Код должен быть уникальным в рамках context-code
   - Максимальная длина: 50 символов
   - Рекомендуется использовать латиницу, числа, дефисы и подчёркивания

9. **Пустые массивы:** Если у AI Item нет тегов, API возвращает пустой массив `tags: []`, а не ошибку 404.

10. **Idempotent операции:** POST и DELETE операции для тегов AI Item являются idempotent — повторное добавление/удаление того же тега не вызывает ошибок.

## Примеры использования

### Полный пример компонента управления тегами AI Item

```javascript
function TagManager({ itemId, contextCode }) {
  const { tags, loading, error, syncTags } = useAiItemTags(itemId, contextCode);
  const { tags: allTags, loadTags: loadAllTags } = useTags(contextCode);
  const [selectedTagCodes, setSelectedTagCodes] = useState([]);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    loadAllTags();
  }, [contextCode]);

  useEffect(() => {
    if (tags.length > 0) {
      setSelectedTagCodes(tags.map(t => t.code));
    }
  }, [tags]);

  const handleSave = async () => {
    const result = await syncTags(selectedTagCodes);
    if (result.success) {
      setEditing(false);
    }
  };

  if (loading) return <div>Загрузка тегов...</div>;
  if (error) return <div>Ошибка: {error}</div>;

  return (
    <div className="tag-manager">
      <div className="tags-header">
        <h3>Теги</h3>
        {!editing && (
          <button onClick={() => setEditing(true)}>
            {tags.length > 0 ? 'Изменить' : 'Добавить'}
          </button>
        )}
      </div>

      {editing ? (
        <div className="tags-editor">
          <div className="tags-checkbox-list">
            {allTags.map(tag => (
              <label key={tag.id} className="tag-checkbox">
                <input
                  type="checkbox"
                  checked={selectedTagCodes.includes(tag.code)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedTagCodes([...selectedTagCodes, tag.code]);
                    } else {
                      setSelectedTagCodes(selectedTagCodes.filter(c => c !== tag.code));
                    }
                  }}
                />
                <span className="tag-name">{tag.name}</span>
                {tag.description && (
                  <span className="tag-description">{tag.description}</span>
                )}
              </label>
            ))}
          </div>
          <div className="tags-actions">
            <button onClick={handleSave}>Сохранить</button>
            <button onClick={() => {
              setEditing(false);
              setSelectedTagCodes(tags.map(t => t.code));
            }}>Отмена</button>
          </div>
        </div>
      ) : (
        <div className="tags-display">
          {tags.length > 0 ? (
            <div className="tags-list">
              {tags.map(tag => (
                <span key={tag.id} className="tag-badge" title={tag.description}>
                  {tag.name}
                </span>
              ))}
            </div>
          ) : (
            <span className="no-tags">Теги отсутствуют</span>
          )}
        </div>
      )}
    </div>
  );
}
```

## Дополнительные ресурсы

- Полная документация API: `docs/api-contract.yaml`
- REST API документация: `KB/README_REST.md`
- База данных: `KB/README_DB-VECTOR.md`
- AI Items: `KB/README_AI_ITEM_COMPLETE.md`
- Комментарии AI Items: `KB/README_UI_COMMENTS.md`
