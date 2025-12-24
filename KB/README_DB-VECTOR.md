# README_DB-VECTOR.md


## Обзор

`DbService.js` — это сервисный класс для работы с базой данных PostgreSQL в проекте RAG (Retrieval-Augmented Generation). Он обеспечивает хранение метаданных файлов, векторных эмбеддингов чанков текста, а также сущностей AI Item (структурированные элементы, такие как классы, функции, переменные и т.д., извлечённые из кода).

База использует расширение **pgvector** для хранения и поиска векторных эмбеддингов.

## Структура базы данных

### Таблица `files`

Хранит информацию о загруженных документах/файлах.

| Поле            | Тип                  | Описание                                                                 |
|-----------------|----------------------|--------------------------------------------------------------------------|
| id              | SERIAL PRIMARY KEY   | Уникальный идентификатор файла                                           |
| filename        | TEXT NOT NULL UNIQUE | Имя файла (без пути)                                                     |
| context_code    | TEXT NOT NULL        | Код контекста (например, проект или пространство имён), по умолчанию 'DEFAULT' |
| file_hash       | TEXT                 | Хэш файла (для совместимости с другими системами, может быть UUID). Добавляется через `updateSchemaForCompatibility()` |
| file_url        | TEXT                 | Полный путь к файлу на диске. Добавляется через `updateSchemaForCompatibility()` |
| content         | TEXT                 | Полное содержимое файла (опционально). Добавляется через `updateSchemaForCompatibility()` |
| created_at      | TIMESTAMP WITH TIME ZONE | Время создания записи (по умолчанию CURRENT_TIMESTAMP)                |
| modified_at     | TIMESTAMP WITH TIME ZONE | Время последнего изменения файла (сравнивается с mtime на диске, по умолчанию CURRENT_TIMESTAMP) |

### Таблица `ai_item`

Хранит структурированные элементы (классы, функции, переменные и т.д.), извлечённые из документов.

| Поле            | Тип                  | Описание                                                                 |
|-----------------|----------------------|--------------------------------------------------------------------------|
| id              | SERIAL PRIMARY KEY   | Уникальный идентификатор                                                 |
| full_name       | TEXT NOT NULL        | Полное имя элемента (например, `module.Class.method`)                    |
| context_code    | TEXT NOT NULL        | Код контекста (связан с файлом), по умолчанию 'DEFAULT'                  |
| file_id         | INTEGER              | Ссылка на файл (может быть NULL)                                         |
| type            | TEXT                 | Тип элемента (class, function, variable и т.д.)                          |
| s_name          | TEXT                 | Короткое имя (например, имя метода)                                      |
| h_name          | TEXT                 | Иерархическое имя (для отображения)                                      |
| created_at      | TIMESTAMP WITH TIME ZONE | Время создания (по умолчанию CURRENT_TIMESTAMP)                        |
| updated_at      | TIMESTAMP WITH TIME ZONE | Время последнего обновления (по умолчанию CURRENT_TIMESTAMP)          |

### Таблица `file_vectors`

Хранит чанки текста с векторными эмбеддингами. Поддерживает иерархию чанков (родительские и дочерние).

| Поле              | Тип                  | Описание                                                                 |
|-------------------|----------------------|--------------------------------------------------------------------------|
| id                | SERIAL PRIMARY KEY   | Уникальный идентификатор чанка                                           |
| file_id           | INTEGER              | Ссылка на файл (ON DELETE CASCADE)                                       |
| ai_item_id        | INTEGER              | Ссылка на ai_item (для чанков уровня 0 с сущностями)                     |
| parent_chunk_id   | INTEGER              | Ссылка на родительский чанк (для иерархических уровней)                  |
| chunk_content     | JSONB NOT NULL        | Содержимое чанка в формате JSON (обычно содержит поле `text` с текстом) |
| embedding         | VECTOR               | Вектор эмбеддинга (pgvector)                                             |
| chunk_index       | INTEGER              | Порядковый индекс чанка в файле/уровне                                   |
| type              | TEXT                 | Тип чанка (по умолчанию 'текст')                                         |
| level             | TEXT                 | Уровень иерархии (по умолчанию '0', обычно '0-исходник', '1-описание', '2-семантика') |
| s_name            | TEXT                 | Короткое имя (для сущностей)                                             |
| h_name            | TEXT                 | Иерархическое имя                                                        |
| full_name         | TEXT                 | Полное имя сущности (для уровня 0)                                       |
| created_at        | TIMESTAMP WITH TIME ZONE | Время создания (по умолчанию CURRENT_TIMESTAMP)                      |

#### Индексы
- `idx_file_vectors_file_id`
- `idx_file_vectors_parent_chunk_id`
- `idx_file_vectors_ai_item_id`
- `idx_ai_item_full_name`
- `idx_ai_item_context_code`

## Основные возможности DbService

### Инициализация и схема
- `initializeSchema()` — создаёт все таблицы и индексы (IF NOT EXISTS).
- `updateSchemaForCompatibility()` — добавляет поля для совместимости (file_hash, file_url, content).

### Работа с файлами
- `needsVectorization(fileName)` — проверяет, нужно ли перевеекторизовать файл (сравнение mtime).
- `saveFileInfo(fileName, fileContent, filePath)` — сохраняет/обновляет метаданные файла.
- `getFileInfo(fileName)` — получает информацию о файле и статус обновления.
- `getAllFiles()` — список всех файлов с проверкой существования на диске и необходимости обновления.
- `getFileById(fileId)`, `getFileByFilename(filename)` — получение файла по ID или имени.
- `deleteFile(fileId)` — удаляет файл и все связанные векторы (каскадно).
- `deleteFileVectors(fileId)` — удаляет только векторы файла, оставляя запись файла.
- `updateContextCode(fileId, contextCode)` — меняет контекстный код файла.

### Работа с чанками и векторами
- `saveChunkVector(fileId, chunkContent, embedding, metadata, parentChunkId)` — сохраняет/обновляет основной чанк (уровень 0). `chunkContent` — JSON объект (обычно `{text: "..."}`), автоматически создаёт/связывает ai_item при наличии full_name в metadata.
- `saveChildChunk(fileId, parentChunkId, content, embedding, level, type, names, aiItemId)` — сохраняет дочерний чанк (для иерархических уровней). `content` — JSON объект.
- `similaritySearch(queryEmbedding, limit, contextCode, filters)` — поиск по косинусному сходству с фильтрами (context_code, type, level). Возвращает чанки с извлечённым текстом из JSONB.
- `getFileChunks(fileName)` — получает все чанки файла. Извлекает текст из JSONB поля `chunk_content`.
- `getChunkById(chunkId)` — получает чанк по ID (с поддержкой числового ID и chunk_index). Поддерживает UUID и числовые ID.
- `getChunkByIdLegacy(chunkId)` — legacy-метод, вызывает `getChunkById`.
- `updateChunkMetadata(chunkId, metadata)` — обновляет type и level чанка.
- `updateChunkNames(chunkId, names)` — обновляет имена (s_name, full_name, h_name).
- `deleteChildChunks(parentChunkId, level)` — удаляет дочерние чанки определённого уровня.

### Работа с AI Item (структурированными сущностями)
- Автоматическое создание/обновление при сохранении чанков уровня 0 с full_name.
- `getAllAiItems(contextCode?)` — список всех AI Item с фильтром по контексту.
- `getAiItemById(itemId)` — получение по ID.
- `getAiItemChunks(itemId, level?)` — все чанки, связанные с AI Item.
- `updateAiItemContext(itemId, newContextCode)` — смена контекста.
- `createAiItem(params)` — ручное создание/обновление AI Item и связывание с чанком.
- `cleanupOrphanedAiItems()` — удаляет AI Item, на которые нет ссылок из чанков уровня 0.

### Дополнительно
- `getContextCodes()` — список всех используемых контекстных кодов.
- `deleteFileAiItems(fileId)` — удаляет связанные AI Item (без проверки ссылок).
- `getCompatibleFileId(fileId)` — адаптер для работы с UUID как file_hash.

### API для kosmos-UI (aiitem-rag-architect)
- `getFullAiItemByFullName(full_name, contextCode)` — получает полный агрегированный AI Item по full_name со всеми чанками (L0-код, L1-зависимости, L2-описание).
- `getAllFullAiItems(contextCode)` — получает все полные AI Items с агрегированными данными.
- `getDashboardStats()` — возвращает статистику для дашборда (количество AI Items, зависимостей, статистика по типам и языкам, размер векторного индекса).

## Рекомендации по использованию
- Контекстный код (`context_code`) позволяет разделять пространства имён (например, разные проекты).
- Уровень чанков `0-исходник` — это исходные куски кода, из которых автоматически извлекаются AI Item.
- Поиск по векторам (`similaritySearch`) поддерживает фильтрацию по контексту и уровню — полезно для точного RAG.
- Поле `chunk_content` хранится как JSONB. При сохранении передавайте JSON объект (обычно `{text: "содержимое"}`). При чтении текст извлекается через `COALESCE(chunk_content->>'text', chunk_content::text)`.
- Поля `file_hash`, `file_url`, `content` в таблице `files` добавляются автоматически при вызове `updateSchemaForCompatibility()`. При создании схемы через `initializeSchema()` эти поля отсутствуют.


```markdown
### Очистка данных

#### `clearAllTables()`
Полная логическая очистка всех таблиц базы данных.

- Удаляет все записи из таблицы `ai_item`.
- Удаляет все записи из таблицы `files` (при этом все связанные векторы в `file_vectors` удаляются автоматически благодаря каскадному удалению `ON DELETE CASCADE`).
- Сбрасывает последовательности автоинкремента (`id_seq`) для таблиц `files`, `ai_item` и `file_vectors` — после очистки новые записи начнутся с ID = 1.
- Безопасный и рекомендуемый способ очистки для большинства сценариев (тестирование, сброс состояния).

#### `truncateAllTables()`
Жёсткая очистка всех таблиц с помощью команды `TRUNCATE`.

- Выполняет одну команду:
  ```sql
  TRUNCATE TABLE public.file_vectors, public.ai_item, public.files
  RESTART IDENTITY CASCADE;
  ```
- Быстрее `clearAllTables()`, особенно при большом объёме данных.
- Обходит проверки внешних ключей (через `CASCADE`) и сразу сбрасывает счётчики ID.
- Использовать с осторожностью: операция необратима и может быть нежелательна в средах, где важны триггеры или логика удаления.

**Рекомендация:**  
В большинстве случаев используйте `clearAllTables()`.  
`truncateAllTables()` подходит для тестов, инициализации или когда нужна максимальная скорость очистки.

Этот сервис полностью инкапсулирует работу с БД и обеспечивает целостность связей между файлами, чанками и структурированными сущностями.
