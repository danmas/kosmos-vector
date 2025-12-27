# Инструкция для разработчиков интерфейсов: Комментарии AI Items

**Версия:** 1.0  
**Дата:** 26 декабря 2025  
**Статус:** Актуально

---

## Обзор

В системе добавлена функциональность **комментариев для AI Items**. Комментарии могут быть созданы автоматически при векторизации L0 чанков или вручную через API. Комментарии хранятся отдельно от AI Items и связаны с ними логически по паре `(context_code, full_name)`.

## API Эндпоинты

### Базовый URL
```
http://localhost:{PORT}/api/items/{id}/comment?context-code={CONTEXT_CODE}
```

Где:
- `{PORT}` — порт сервера (по умолчанию 3005)
- `{id}` — `full_name` AI Item (должен быть URL-encoded)
- `{CONTEXT_CODE}` — контекстный код (обязательный query параметр)

### 1. Получить комментарий

**GET** `/api/items/{id}/comment?context-code={CONTEXT_CODE}`

**Пример запроса:**
```javascript
const itemId = encodeURIComponent('utils.fetchData');
const contextCode = 'CARL';
const response = await fetch(
  `http://localhost:3005/api/items/${itemId}/comment?context-code=${contextCode}`
);
const data = await response.json();
```

**Успешный ответ (200):**
```json
{
  "success": true,
  "itemId": "utils.fetchData",
  "comment": "Этот метод обрабатывает HTTP запросы",
  "createdAt": "2025-12-26T10:00:00.000Z",
  "updatedAt": "2025-12-26T11:00:00.000Z"
}
```

**Если комментарий не найден (404):**
```json
{
  "success": false,
  "error": "Comment not found for item: utils.fetchData"
}
```

**Обработка в UI:**
```javascript
if (response.ok) {
  const comment = data.comment || null;
  // Отобразить комментарий или показать "Комментарий отсутствует"
} else if (response.status === 404) {
  // Комментарий не найден - это нормально, можно показать форму для создания
}
```

### 2. Создать или обновить комментарий

**POST** `/api/items/{id}/comment?context-code={CONTEXT_CODE}`

**Пример запроса:**
```javascript
const itemId = encodeURIComponent('utils.fetchData');
const contextCode = 'CARL';
const response = await fetch(
  `http://localhost:3005/api/items/${itemId}/comment?context-code=${contextCode}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      comment: 'Этот метод обрабатывает HTTP запросы и возвращает JSON ответ'
    })
  }
);
const data = await response.json();
```

**Успешный ответ (200):**
```json
{
  "success": true,
  "itemId": "utils.fetchData",
  "comment": "Этот метод обрабатывает HTTP запросы и возвращает JSON ответ",
  "createdAt": "2025-12-26T10:00:00.000Z",
  "updatedAt": "2025-12-26T11:00:00.000Z"
}
```

**Ошибка валидации (400):**
```json
{
  "success": false,
  "error": "Comment is required and must be a string"
}
```

**Особенность:** POST выполняет UPSERT — если комментарий уже существует, он будет обновлен.

### 3. Обновить существующий комментарий

**PUT** `/api/items/{id}/comment?context-code={CONTEXT_CODE}`

**Пример запроса:**
```javascript
const itemId = encodeURIComponent('utils.fetchData');
const contextCode = 'CARL';
const response = await fetch(
  `http://localhost:3005/api/items/${itemId}/comment?context-code=${contextCode}`,
  {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      comment: 'Обновленный комментарий'
    })
  }
);
```

**Успешный ответ (200):** Аналогичен POST  
**Если комментарий не найден (404):** Аналогичен GET 404

**Важно:** PUT обновляет только существующие комментарии. Если комментарий не существует, используйте POST.

### 4. Удалить комментарий

**DELETE** `/api/items/{id}/comment?context-code={CONTEXT_CODE}`

**Пример запроса:**
```javascript
const itemId = encodeURIComponent('utils.fetchData');
const contextCode = 'CARL';
const response = await fetch(
  `http://localhost:3005/api/items/${itemId}/comment?context-code=${contextCode}`,
  {
    method: 'DELETE'
  }
);
const data = await response.json();
```

**Успешный ответ (200):**
```json
{
  "success": true,
  "message": "Comment deleted successfully for item: utils.fetchData"
}
```

**Если комментарий не найден (404):**
```json
{
  "success": false,
  "error": "Comment not found for item: utils.fetchData"
}
```

## Рекомендации по реализации UI

### 1. Отображение комментариев

**Вариант A: В карточке AI Item**
```javascript
// Компонент AI Item Card
function AiItemCard({ item, contextCode }) {
  const [comment, setComment] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadComment(item.id, contextCode);
  }, [item.id, contextCode]);

  async function loadComment(itemId, contextCode) {
    try {
      const encodedId = encodeURIComponent(itemId);
      const response = await fetch(
        `/api/items/${encodedId}/comment?context-code=${contextCode}`
      );
      if (response.ok) {
        const data = await response.json();
        setComment(data.comment);
      } else if (response.status === 404) {
        setComment(null); // Комментарий отсутствует
      }
    } catch (error) {
      console.error('Ошибка загрузки комментария:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ai-item-card">
      <h3>{item.id}</h3>
      <div className="comment-section">
        {loading ? (
          <span>Загрузка...</span>
        ) : comment ? (
          <div className="comment">
            <p>{comment}</p>
            <small>
              Обновлено: {new Date(comment.updatedAt || comment.createdAt).toLocaleString()}
            </small>
          </div>
        ) : (
          <div className="no-comment">
            <span>Комментарий отсутствует</span>
            <button onClick={() => showCommentEditor(item.id)}>Добавить</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Вариант B: В модальном окне деталей**
```javascript
function AiItemDetailsModal({ item, contextCode, onClose }) {
  const [comment, setComment] = useState(null);
  const [editing, setEditing] = useState(false);
  const [commentText, setCommentText] = useState('');

  // Загрузка комментария при открытии модального окна
  useEffect(() => {
    loadComment();
  }, []);

  async function loadComment() {
    // ... код загрузки
  }

  async function saveComment() {
    const encodedId = encodeURIComponent(item.id);
    const method = comment ? 'PUT' : 'POST';
    const response = await fetch(
      `/api/items/${encodedId}/comment?context-code=${contextCode}`,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: commentText })
      }
    );
    if (response.ok) {
      const data = await response.json();
      setComment(data.comment);
      setEditing(false);
    }
  }

  async function deleteComment() {
    if (!confirm('Удалить комментарий?')) return;
    // ... код удаления
  }

  return (
    <Modal>
      <h2>{item.id}</h2>
      <div className="comment-section">
        {editing ? (
          <div>
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Введите комментарий..."
            />
            <button onClick={saveComment}>Сохранить</button>
            <button onClick={() => setEditing(false)}>Отмена</button>
          </div>
        ) : (
          <div>
            {comment ? (
              <>
                <p>{comment}</p>
                <button onClick={() => { setEditing(true); setCommentText(comment); }}>
                  Редактировать
                </button>
                <button onClick={deleteComment}>Удалить</button>
              </>
            ) : (
              <>
                <p>Комментарий отсутствует</p>
                <button onClick={() => setEditing(true)}>Добавить комментарий</button>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
```

### 2. Обработка ошибок

```javascript
async function handleCommentOperation(operation, itemId, contextCode, commentText = null) {
  try {
    const encodedId = encodeURIComponent(itemId);
    const url = `/api/items/${encodedId}/comment?context-code=${contextCode}`;
    
    const options = {
      method: operation,
      headers: { 'Content-Type': 'application/json' }
    };

    if (operation !== 'DELETE' && commentText !== null) {
      options.body = JSON.stringify({ comment: commentText });
    }

    const response = await fetch(url, options);
    const data = await response.json();

    if (response.ok) {
      return { success: true, data };
    } else {
      return { success: false, error: data.error || 'Неизвестная ошибка' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

### 3. Валидация

```javascript
function validateComment(comment) {
  if (!comment || typeof comment !== 'string') {
    return { valid: false, error: 'Комментарий обязателен и должен быть строкой' };
  }
  if (comment.trim().length === 0) {
    return { valid: false, error: 'Комментарий не может быть пустым' };
  }
  if (comment.length > 10000) {
    return { valid: false, error: 'Комментарий слишком длинный (максимум 10000 символов)' };
  }
  return { valid: true };
}
```

### 4. Индикация автоматически созданных комментариев

Комментарии могут быть созданы автоматически при векторизации L0 чанков. Рекомендуется показывать это в UI:

```javascript
function CommentBadge({ comment }) {
  // Если комментарий был создан автоматически, можно показать бейдж
  // (это можно определить по времени создания или другим метаданным)
  const isAutoGenerated = comment.createdAt === comment.updatedAt;
  
  return (
    <div className="comment-badge">
      {isAutoGenerated && (
        <span className="badge auto-generated" title="Создан автоматически при векторизации">
          Авто
        </span>
      )}
    </div>
  );
}
```

## Важные замечания

1. **URL-encoding:** Всегда используйте `encodeURIComponent()` для `itemId` (full_name), так как он может содержать специальные символы (точки, слеши и т.д.)

2. **Context Code:** Параметр `context-code` обязателен для всех операций. Убедитесь, что он передается в каждом запросе.

3. **Автоматическое создание:** Комментарии автоматически создаются при сохранении L0 чанков, если в `chunk_content.comment` присутствует значение. При перезаписи L0 существующие комментарии **не перезаписываются**.

4. **Отсутствие комментария:** Если комментарий отсутствует (404), это нормальная ситуация. Не показывайте ошибку, а предложите создать комментарий.

5. **Один комментарий на AI Item:** В системе может быть только один комментарий на AI Item (определяется парой `context_code + full_name`). POST и PUT обновляют этот единственный комментарий.

6. **Временные метки:** Используйте `createdAt` и `updatedAt` для отображения времени создания/обновления комментария. Если `updatedAt === null`, комментарий не обновлялся после создания.

## Примеры использования

### React Hook для работы с комментариями

```javascript
function useAiItemComment(itemId, contextCode) {
  const [comment, setComment] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadComment = async () => {
    setLoading(true);
    setError(null);
    try {
      const encodedId = encodeURIComponent(itemId);
      const response = await fetch(
        `/api/items/${encodedId}/comment?context-code=${contextCode}`
      );
      if (response.ok) {
        const data = await response.json();
        setComment(data);
      } else if (response.status === 404) {
        setComment(null);
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

  const saveComment = async (commentText) => {
    setLoading(true);
    setError(null);
    try {
      const encodedId = encodeURIComponent(itemId);
      const method = comment ? 'PUT' : 'POST';
      const response = await fetch(
        `/api/items/${encodedId}/comment?context-code=${contextCode}`,
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment: commentText })
        }
      );
      if (response.ok) {
        const data = await response.json();
        setComment(data);
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

  const deleteComment = async () => {
    setLoading(true);
    setError(null);
    try {
      const encodedId = encodeURIComponent(itemId);
      const response = await fetch(
        `/api/items/${encodedId}/comment?context-code=${contextCode}`,
        { method: 'DELETE' }
      );
      if (response.ok) {
        setComment(null);
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
    comment,
    loading,
    error,
    loadComment,
    saveComment,
    deleteComment
  };
}
```

### Использование хука

```javascript
function CommentSection({ itemId, contextCode }) {
  const { comment, loading, error, saveComment, deleteComment } = 
    useAiItemComment(itemId, contextCode);
  const [editing, setEditing] = useState(false);
  const [commentText, setCommentText] = useState('');

  useEffect(() => {
    loadComment();
  }, [itemId, contextCode]);

  const handleSave = async () => {
    const result = await saveComment(commentText);
    if (result.success) {
      setEditing(false);
    }
  };

  if (loading) return <div>Загрузка...</div>;
  if (error) return <div>Ошибка: {error}</div>;

  return (
    <div className="comment-section">
      {editing ? (
        <div>
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Введите комментарий..."
          />
          <button onClick={handleSave}>Сохранить</button>
          <button onClick={() => setEditing(false)}>Отмена</button>
        </div>
      ) : (
        <div>
          {comment?.comment ? (
            <>
              <p>{comment.comment}</p>
              <button onClick={() => { setEditing(true); setCommentText(comment.comment); }}>
                Редактировать
              </button>
              <button onClick={deleteComment}>Удалить</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)}>Добавить комментарий</button>
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

