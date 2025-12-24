# Как происходит embedding в вашем проекте

### 1. **Архитектура системы embedding**

Ваш проект использует **паттерн Factory** для создания разных типов embedding моделей:

#### **EmbeddingsFactory** (`EmbeddingsFactory.js`)
- Фабрика создает embedding модели на основе конфигурации
- Поддерживает два типа моделей:
  - **SimpleEmbeddings** - простая модель для тестирования
  - **OpenAIEmbeddings** - реальная модель от OpenAI

```javascript
// EmbeddingsFactory.js
createEmbeddings(type = null) {
  const embeddingsType = type || this.defaultModel;
  
  if (embeddingsType === 'openai') {
    // ...
    return new OpenAIEmbeddings({
      openAIApiKey: this.openAIApiKey,
      modelName: "text-embedding-ada-002"
    });
  } else {
    return new SimpleEmbeddings();
  }
}
```

### 2. **Типы embedding моделей**

#### **SimpleEmbeddings** 
- Генерирует **детерминированные** векторы размерностью **1536**
- Использует хеш-функцию для создания воспроизводимых результатов
- Предназначена для тестирования и разработки

```javascript
// SimpleEmbeddings.js
_generateVector(text) {
  // ... (хеш-функция и генерация вектора)
}
```

#### **OpenAIEmbeddingsWrapper**
- Обертка над OpenAI API
- Использует модель `text-embedding-ada-002`
- Добавляет логирование и обработку ошибок

### 3. **Основные методы embedding**

Каждая модель реализует два ключевых метода:

- **`embedQuery(text)`** - создает embedding для одного текста (обычно для поисковых запросов)
- **`embedDocuments(documents)`** - создает embeddings для массива документов

### 4. **Процесс векторизации документов**

#### **Шаг 1: Разбиение на чанки**
Текст разбивается на чанки специализированными функциями:
- `splitJavaScriptByObjects()` - для JS файлов по объектам/функциям
- `splitSqlByObjects()` - для SQL файлов по объектам базы данных
- `splitMarkdownBySections()` - для Markdown по заголовкам

#### **Шаг 2: Создание embeddings**
```javascript
// server.js
console.log(`Создание эмбеддингов для ${chunksToEmbed.length} SQL-объектов`);
const vectors = await embeddingsModel.embedDocuments(chunksToEmbed);
```

#### **Шаг 3: Сохранение в PostgreSQL**
Векторы сохраняются в базе данных PostgreSQL вместе с метаданными:

```javascript
// PostgresVectorStore.js
async addDocuments(documents) {
  const texts = documents.map((doc) => doc.pageContent);
  const vectors = await this._embeddings.embedDocuments(texts);
  return this.addVectors(vectors, documents);
}
```

### 5. **Поиск по векторам**

Для поиска создается embedding запроса и сравнивается с сохраненными векторами:

```javascript
// PostgresVectorStore.js
const queryEmbedding = await this._embeddings.embedQuery(query);
const results = await this._dbService.searchSimilarVectors(queryEmbedding, ...);
```

### 6. **Microservices архитектура**

Система также поддерживает микросервисную архитектуру:

- **common-service** - общие функции векторизации
- **openai-service** - сервис для OpenAI embeddings
- **simple-service** - сервис для простых embeddings

### 7. **Полный flow embedding**

1. **Загрузка файла** → Чтение содержимого
2. **Парсинг и разбиение** → Создание чанков по типу файла
3. **Создание embeddings** → `embeddingsModel.embedDocuments(chunks)`
4. **Извлечение метаданных** → Определение имен объектов (для SQL/JS)
5. **Сохранение в БД** → Векторы + метаданные в PostgreSQL
6. **Индексация** → Векторный поиск готов

Эта архитектура позволяет эффективно обрабатывать разные типы файлов, создавать семантические embeddings и выполнять быстрый поиск по содержимому.

### 8. **Внешние серверы для Embedding**

В проекте используется два типа эмбеддингов:

1.  **`SimpleEmbeddings`**: Это локальная реализация, которая **не использует внешние серверы**.
2.  **`OpenAIEmbeddings`**: Этот метод использует API от OpenAI.

URL для `OpenAIEmbeddings` (используется через библиотеку `@langchain/openai`):
**`https://api.openai.com/v1/embeddings`**
