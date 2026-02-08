# API Changes Summary - v2.7.0

## 🎯 Что изменилось

### Добавлены новые маршруты

**Все новые эндпоинты находятся под префиксом `/api/rag/`**

1. `POST /api/rag/retrieve` - Получение структурированного контекста без LLM
2. `POST /api/rag/ask` - Полный RAG цикл с генерацией ответа LLM
3. `POST /api/rag/compare-strategies` - Сравнение эффективности стратегий
4. `GET /api/rag/strategies` - Список доступных стратегий

### Обновлённые маршруты

- `POST /api/chat` - Обновлён для использования улучшенного RAG-движка (обратная совместимость сохранена)

---

## 📋 Быстрый старт для фронтенда

### Минимальный пример

```typescript
// Получить ответ с RAG
const response = await fetch('/api/rag/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: "Как работает функция validateEmployee?",
    contextCode: "FULL_TEST"
  })
});

const data = await response.json();
console.log(data.answer);
```

### С настройками

```typescript
const response = await fetch('/api/rag/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: "Какие методы есть в EmployeeService?",
    contextCode: "FULL_TEST",
    ragConfig: {
      strategy: "hierarchical",  // simple | hierarchical | aiitem | hybrid
      maxChunks: 10,
      formatting: {
        style: "standard",        // compact | standard | full | markdown
        maxTokens: 4000
      }
    },
    llmConfig: {
      model: "RICH",
      temperature: 0.3
    }
  })
});
```

---

## 🔑 Ключевые концепции

### Стратегии RAG

- **simple**: Быстрый векторный поиск по всем уровням
- **hierarchical**: L0-чанки + автоматическая подгрузка L1/L2 (рекомендуется)
- **aiitem**: Поиск через AI Items с полным контекстом
- **hybrid**: Комбинированный подход (экспериментальная)

### Уровни чанков

- **L0** (`0-исходник`): Исходный код
- **L1** (`1-связи`): Зависимости и связи
- **L2** (`2-логика`): Описание логики

### Стили форматирования

- **compact**: Минимальный, только код
- **standard**: Код + описание + зависимости (рекомендуется)
- **full**: Всё включено с деталями
- **markdown**: Структурированный с заголовками

---

## 📚 Документация

- **Полное руководство**: `docs/README_Frontend_RAG_Integration.md`
- **API контракт**: `docs/api-contract.yaml`
- **Примеры использования**: `example-usage-rag.js`
- **Тесты**: `tests/test_rag_retrieval.js`

---

## ✅ Что нужно сделать фронтенду

### Приоритет 1 (обязательно):
1. ✅ Добавить TypeScript типы (см. руководство)
2. ✅ Создать `useRAG` hook
3. ✅ Обновить чат для использования `/api/rag/ask`

### Приоритет 2 (рекомендуется):
4. ⭐ Добавить RAG Settings Panel (выбор стратегии, количество чанков)
5. ⭐ Показывать метаданные (время поиска, количество чанков, токенов)
6. ⭐ Создать Context Preview компонент

### Приоритет 3 (опционально):
7. 🎨 Strategy Comparison Dashboard
8. 🎨 Визуализация найденного контекста
9. 🎨 Export контекста в Markdown/JSON

---

## 🔄 Обратная совместимость

✅ Старый эндпоинт `/api/chat` продолжает работать  
✅ Никаких breaking changes  
✅ Можно мигрировать постепенно  

---

## 📊 Результаты тестирования

**Контекст**: FULL_TEST (HR система с 43 AI Items)

| Стратегия | Среднее время | Найдено чанков | Качество |
|-----------|---------------|----------------|----------|
| Simple | 1,153 мс | 5 | Базовое ⭐⭐ |
| Hierarchical | 2,453 мс | 3 (с L1/L2) | Хорошее ⭐⭐⭐ |
| AI Item | 2,759 мс | 2 (полный контекст) | Отличное ⭐⭐⭐⭐ |

**Рекомендация**: Используйте `hierarchical` для баланса скорости и качества.

---

## 🎯 Пример UI компонента

```typescript
// RAG Settings Panel
<div className="rag-settings">
  <select value={strategy} onChange={...}>
    <option value="simple">Simple (быстрая)</option>
    <option value="hierarchical">Hierarchical (рекомендуется)</option>
    <option value="aiitem">AI Item (полный контекст)</option>
  </select>
  
  <input 
    type="range" 
    min="1" 
    max="20" 
    value={maxChunks}
    onChange={...}
  />
  <span>Чанков: {maxChunks}</span>
</div>
```

---

## 📞 Вопросы?

1. Читайте полное руководство: `docs/README_Frontend_RAG_Integration.md`
2. Смотрите примеры: `example-usage-rag.js`
3. Запускайте тесты: `bun tests/test_rag_retrieval.js`
4. Изучайте API контракт: `docs/api-contract.yaml`

---

**Версия API**: 2.7.0  
**Дата релиза**: 2026-02-08
