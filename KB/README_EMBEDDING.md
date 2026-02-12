# Embedding в проекте

## Какая модель используется

- **По умолчанию** в коде используется **`simple`** — локальная заглушка (SimpleEmbeddings), без внешнего API.
- Для реальных эмбеддингов через API задаётся **`openai`** — тогда используется модель **OpenAI `text-embedding-ada-002`** (фиксировано в коде).

**Выбор модели** задаётся в таком порядке приоритета:

1. Параметр `config.defaultModel` при создании `new EmbeddingsFactory(config)`.
2. Переменная окружения **`EMBEDDINGS_MODEL`** (`'simple'` или `'openai'`).
3. Если ни то ни другое не задано — **`'simple'**.

В `server.js` фабрика создаётся как `new EmbeddingsFactory()`, поэтому фактически используется `process.env.EMBEDDINGS_MODEL` или `'simple'`.

**Важно:** в конфигах (например, `kb-configs/KOSMOS-VECTOR.json`) в описании может фигурировать «Google Gemini (text-embedding-004)». В коде **EmbeddingsFactory поддерживает только `simple` и `openai`**; Gemini не реализован.

---

## 1. Архитектура (EmbeddingsFactory)

Используется **паттерн Factory** для создания моделей эмбеддингов.

**Файл:** `packages/core/EmbeddingsFactory.js`

- Фабрика создаёт модель на основе конфигурации.
- Поддерживаются два типа:
  - **`simple`** → SimpleEmbeddings (локальная заглушка).
  - **`openai`** → OpenAIEmbeddings от `@langchain/openai`, модель `text-embedding-ada-002`.

```javascript
// Приоритет: type || config.defaultModel || process.env.EMBEDDINGS_MODEL || 'simple'
createEmbeddings(type = null) {
  const embeddingsType = type || this.defaultModel;
  if (embeddingsType === 'openai') {
    return new OpenAIEmbeddings({
      openAIApiKey: this.openAIApiKey,
      modelName: "text-embedding-ada-002"
    });
  }
  return new SimpleEmbeddings();
}
```

---

## 2. Типы моделей

### SimpleEmbeddings

- Локальная реализация, **без внешних запросов**.
- Вектор размерности **1536**, детерминированный (хеш от текста).
- Для тестирования и разработки.

### OpenAIEmbeddings (@langchain/openai)

- Реальная модель **OpenAI `text-embedding-ada-002`**.
- Запросы к **`https://api.openai.com/v1/embeddings`**.
- Требуется `OPENAI_API_KEY` (в конфиге фабрики или в `process.env.OPENAI_API_KEY`).

---

## 3. Методы

У каждой модели:

- **`embedQuery(text)`** — один текст (например, поисковый запрос).
- **`embedDocuments(documents)`** — массив текстов (чанки документов).

---

## 4. Процесс векторизации

1. **Чанки** — разбиение по типу файла: `splitJavaScriptByObjects()`, `splitSqlByObjects()`, `splitMarkdownBySections()` и т.д.
2. **Эмбеддинги** — `embeddingsModel.embedDocuments(chunks)`.
3. **Сохранение** — векторы и метаданные в PostgreSQL (таблица с полем `embedding`, тип `vector`).

Пример сохранения через хранилище:

```javascript
// PostgresVectorStore
const texts = documents.map((doc) => doc.pageContent);
const vectors = await this._embeddings.embedDocuments(texts);
return this.addVectors(vectors, documents);
```

---

## 5. Поиск по векторам

Запрос переводится в вектор той же моделью, затем сравнение с БД (pgvector):

```javascript
const queryEmbedding = await this._embeddings.embedQuery(query);
const results = await this._dbService.similaritySearch(queryEmbedding, ...);
```

---

## 6. Полный поток

1. Загрузка файла → чтение содержимого.
2. Парсинг и разбиение → чанки по типу файла.
3. Создание эмбеддингов → `embedDocuments(chunks)`.
4. Метаданные → имена объектов (SQL/JS) и т.д.
5. Сохранение в БД → векторы и метаданные в PostgreSQL.
6. Поиск → через `embedQuery` + similarity search по полю `embedding`.

---

## 7. Внешние зависимости

| Модель  | Внешний сервер | Размерность |
|--------|-----------------|-------------|
| simple | нет             | 1536        |
| openai | api.openai.com  | 1536 (text-embedding-ada-002) |

URL для OpenAI (через `@langchain/openai`): **`https://api.openai.com/v1/embeddings`**.
