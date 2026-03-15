# Инкрементальное обновление Pipeline (Step 1 + Step 2)

## Фаза 0: Миграция схемы БД

### 0.1 SQL-миграция
Создать файл `tmp/migrate_incremental.sql`:

```sql
-- 1. files: убрать UNIQUE(filename), добавить file_hash, добавить UNIQUE(filename, context_code)
ALTER TABLE kosmos.files DROP CONSTRAINT IF EXISTS files_filename_key;
ALTER TABLE kosmos.files ADD COLUMN IF NOT EXISTS file_hash TEXT;
ALTER TABLE kosmos.files ADD CONSTRAINT files_filename_context_code_unique UNIQUE (filename, context_code);

-- 2. ai_item: добавить content_hash и needs_rebuild
ALTER TABLE kosmos.ai_item ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE kosmos.ai_item ADD COLUMN IF NOT EXISTS needs_rebuild BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_ai_item_needs_rebuild ON kosmos.ai_item (context_code, needs_rebuild) WHERE needs_rebuild = true;
```

### 0.2 Обновить `DbService.initializeSchema()`
В `packages/core/DbService.js` — добавить миграцию новых колонок в секцию инициализации (ALTER TABLE ... ADD COLUMN IF NOT EXISTS), чтобы схема подтягивалась автоматически при старте сервера.

---

## Фаза 1: Утилиты хеширования

### 1.1 Создать `packages/core/hashUtils.js`
Экспортируемые функции:
- `computeFileHash(content)` — SHA-256 от строки, возвращает hex
- `computeEntityHash({ body, signature, comment })` — SHA-256 от `body + '\n---\n' + signature + '\n---\n' + comment`, где undefined/null -> ''

Использует встроенный `crypto` модуль Node.js.

---

## Фаза 2: Новые/модифицированные методы DbService

Все изменения в `packages/core/DbService.js`.

### 2.1 `saveFileInfo()` — добавить параметр `fileHash`
- Сигнатура: `saveFileInfo(fileName, fileContent, filePath, contextCode, fileHash = null)`
- В INSERT: записывать `file_hash`
- В UPDATE: записывать `file_hash`
- **Критично**: изменить поиск с `WHERE filename = $1` на `WHERE filename = $1 AND context_code = $2`

### 2.2 Новый метод `getFileMetaForIncrCheck(filename, contextCode)`
```js
// Возвращает { id, modified_at, file_hash } или null
SELECT id, modified_at, file_hash FROM kosmos.files
WHERE filename = $1 AND context_code = $2
```

### 2.3 Новый метод `updateFileModifiedAt(fileId, mtime)`
```js
UPDATE kosmos.files SET modified_at = $1 WHERE id = $2
```
Используется при skip-by-hash (файл не изменился, но mtime обновить надо).

### 2.4 `createAiItem()` — добавить параметр `contentHash`
- Сигнатура: добавить `contentHash` в `params`
- В INSERT и UPDATE: записывать `content_hash`

### 2.5 Новый метод `getAiItemsByFileId(fileId, contextCode)`
```js
SELECT id, full_name, content_hash FROM kosmos.ai_item
WHERE file_id = $1 AND context_code = $2
```

### 2.6 Новый метод `markNeedsRebuild(fullNames, contextCode)`
```js
UPDATE kosmos.ai_item SET needs_rebuild = true
WHERE full_name = ANY($1::text[]) AND context_code = $2
```

### 2.7 Новый метод `clearNeedsRebuild(aiItemId)`
```js
UPDATE kosmos.ai_item SET needs_rebuild = false WHERE id = $1
```

### 2.8 Новый метод `deleteAiItemCascade(aiItemId, fullName, contextCode)`
Порядок:
1. `DELETE FROM kosmos.link WHERE context_code = $1 AND source = $2`
2. `DELETE FROM kosmos.chunk_vector WHERE ai_item_id = $3`
3. `DELETE FROM kosmos.ai_item WHERE id = $3`

### 2.9 Новый метод `getReverseLinkedItems(fullName, contextCode)`
```js
SELECT DISTINCT source FROM kosmos.link
WHERE target = $1 AND context_code = $2
```
Для маркировки обратных соседей при удалении.

### 2.10 Новый метод `deleteChunksByAiItemId(aiItemId)`
```js
DELETE FROM kosmos.chunk_vector WHERE ai_item_id = $1
```

### 2.11 Новый метод `deleteLinksBySource(fullName, contextCode)`
```js
DELETE FROM kosmos.link WHERE context_code = $1 AND source = $2
```

---

## Фаза 3: Общая функция проверки файла

### 3.1 Создать `packages/core/fileChangeDetector.js`
Экспорт: `checkFileChanged(filePath, contextCode, dbService)`

Возвращает:
```js
{
  changed: true|false,
  fileId: uuid|null,       // существующий fileId (или null для нового файла)
  content: string|null,    // содержимое файла (если changed=true)
  newHash: string|null,    // SHA-256 (если changed=true)
  status: 'new' | 'skipped_mtime' | 'skipped_hash' | 'changed'
}
```

Алгоритм:
1. `fs.stat(filePath)` -> `mtime`
2. `dbService.getFileMetaForIncrCheck(basename, contextCode)` -> dbFile
3. Если dbFile && mtime <= dbFile.modified_at -> return `{ changed: false, status: 'skipped_mtime' }`
4. `content = fs.readFileSync(filePath, 'utf8')`
5. `newHash = computeFileHash(content)`
6. Если dbFile && dbFile.file_hash === newHash -> `updateFileModifiedAt(dbFile.id, mtime)`, return `{ changed: false, status: 'skipped_hash' }`
7. Иначе -> return `{ changed: true, fileId: dbFile?.id, content, newHash, status: dbFile ? 'changed' : 'new' }`

---

## Фаза 4: Общая функция обработки сущностей (инкрементальная)

### 4.1 Создать `packages/core/entityProcessor.js`
Экспорт: `processEntitiesIncremental(entities, fileId, contextCode, dbService, options)`

Где `options`:
- `loaderTag` — строка для логирования ('[SQL-Loader]', '[JS-Loader]', etc.)
- `createChunksAndLinks(entity, aiItem, fileId)` — callback из лоадера для создания L0/L1 чанков и link'ов

Алгоритм:
1. `oldItems = await dbService.getAiItemsByFileId(fileId, contextCode)` — Map(full_name -> { id, content_hash })
2. `newEntityNames = new Set(entities.map(e => e.full_name))`
3. Для каждой entity:
   - `entityHash = computeEntityHash({ body: entity.body, signature: entity.signature, comment: entity.comment })`
   - Если oldItems.has(entity.full_name) И oldItems[full_name].content_hash === entityHash -> SKIP (entity_status: 'unchanged')
   - Иначе:
     - Удалить старые чанки: `deleteChunksByAiItemId(oldItem.id)` (если oldItem существует)
     - Удалить старые link: `deleteLinksBySource(entity.full_name, contextCode)`
     - `createAiItem(...)` с `contentHash = entityHash`
     - Вызвать `createChunksAndLinks(entity, aiItem, fileId)` — callback из лоадера
     - `ai_item.needs_rebuild = true`
4. Шаг G — удаление исчезнувших:
   - `disappeared = oldItems.keys - newEntityNames`
   - Для каждого disappeared:
     - Проверить `ai_item.file_id === fileId` (защита от переезда)
     - `reverseNeighbors = getReverseLinkedItems(fullName, contextCode)`
     - `markNeedsRebuild(reverseNeighbors, contextCode)`
     - `deleteAiItemCascade(id, fullName, contextCode)`
5. Возвращает report с breakdown по статусам (created, updated, unchanged, deleted)

---

## Фаза 5: Модификация лоадеров

Каждый лоадер модифицируется по одному паттерну. Изменения минимальны — вся общая логика вынесена в `fileChangeDetector` и `entityProcessor`.

### 5.1 `routes/loaders/sqlFunctionLoader.js` — `loadSqlFunctionsFromFile()`
- Вместо прямого `fs.readFileSync` + `saveFileInfo` -> вызвать `checkFileChanged()`
- Если `changed === false` -> return report со статусом skip
- Если `changed === true` -> `saveFileInfo(filename, content, filePath, contextCode, newHash)`
- Вместо цикла с `createAiItem` + `saveChunkVector` -> `processEntitiesIncremental()` с callback для L0/L1/link
- Добавить новый параметр `mode` (по умолчанию 'incremental')

### 5.2 `routes/loaders/jsFunctionLoader.js` — аналогично 5.1
### 5.3 `routes/loaders/tsFunctionLoader.js` — аналогично 5.1
### 5.4 `routes/loaders/phpFunctionLoader.js` — аналогично 5.1
### 5.5 `routes/loaders/mdLoader.js` — аналогично 5.1 (entity = секция MD)
### 5.6 `routes/loaders/ddlSchemaLoader.js` — аналогично 5.1 (entity = таблица)
### 5.7 `routes/loaders/tableSchemaLoader.js` — особый случай

`tableSchemaLoader` загружает схему из БД (не из файла), поэтому mtime-проверка неприменима. Используем только hash от полученной схемы:
1. Получить схему через pg-mcp
2. `newHash = computeFileHash(schemaText)`
3. Сравнить с `file_hash` виртуального файла в БД
4. Если совпадает -> skip

---

## Фаза 6: Модификация step1Runner.js

### 6.1 Добавить параметр `mode` в `runStep1()`
- Сигнатура: `runStep1(contextCode, sessionId, dbService, pipelineState, pipelineHistory, mode = 'incremental')`
- Передать `mode` в каждый лоадер
- Если `mode === 'full'` -> лоадеры пропускают все проверки mtime/hash (текущее поведение)

### 6.2 Расширить report
Добавить в summary:
```js
skippedFiles: 0,        // файлы без изменений (mtime или hash)
skippedEntities: 0,     // сущности без изменений (content_hash)
deletedEntities: 0,     // удалённые сущности
updatedEntities: 0,     // обновлённые сущности
createdEntities: 0      // новые сущности
```

---

## Фаза 7: Модификация step2Runner.js

### 7.1 Фильтрация по `needs_rebuild`
Изменить запросы:
- L1 чанки: добавить JOIN с ai_item WHERE needs_rebuild = true
- link: добавить фильтр по source IN (SELECT full_name FROM ai_item WHERE needs_rebuild = true)

### 7.2 Сброс флага
После обработки каждого ai_item: `clearNeedsRebuild(aiItemId)`

### 7.3 Совместимость с `mode=full`
Если `mode=full` (или все ai_item.needs_rebuild = false и их 0) -> обрабатывать ВСЕ (текущее поведение). Это обеспечивает обратную совместимость.

Реализация: если Step 1 был в mode=full, выставить needs_rebuild=true для ВСЕХ ai_item контекста перед запуском Step 2. Либо Step 2 тоже принимает параметр mode.

---

## Фаза 8: Модификация API endpoints

### 8.1 `routes/api.js` — `POST /api/pipeline/start`
- Парсить `mode` из `req.body.mode` или `req.query.mode`
- Default: `'incremental'`
- Допустимые значения: `'incremental'`, `'full'`
- Передать `mode` в `runStep1(...)` и `runStep2(...)`

### 8.2 `POST /api/pipeline/step/1/run`
- Аналогично — парсить и передать `mode`

### 8.3 `POST /api/pipeline/step/2/run`
- Аналогично — парсить и передать `mode`

---

## Фаза 9: Обновление KB-документации

### 9.1 `KB/README_LOADING_FILES.md`
Добавить раздел "Инкрементальное обновление" с описанием:
- Двухступенчатая проверка файлов
- Сущностное сравнение
- Флаг needs_rebuild
- Параметр mode

---

## Порядок реализации (по файлам)

1. `tmp/migrate_incremental.sql` — миграция (Фаза 0)
2. `packages/core/hashUtils.js` — утилиты (Фаза 1)
3. `packages/core/DbService.js` — новые методы + модификация существующих (Фаза 2)
4. `packages/core/fileChangeDetector.js` — проверка файлов (Фаза 3)
5. `packages/core/entityProcessor.js` — обработка сущностей (Фаза 4)
6. `routes/loaders/sqlFunctionLoader.js` — первый лоадер (Фаза 5.1, используем как reference)
7. `routes/loaders/jsFunctionLoader.js` (Фаза 5.2)
8. `routes/loaders/tsFunctionLoader.js` (Фаза 5.3)
9. `routes/loaders/phpFunctionLoader.js` (Фаза 5.4)
10. `routes/loaders/mdLoader.js` (Фаза 5.5)
11. `routes/loaders/ddlSchemaLoader.js` (Фаза 5.6)
12. `routes/loaders/tableSchemaLoader.js` (Фаза 5.7)
13. `routes/pipeline/step1Runner.js` (Фаза 6)
14. `routes/pipeline/step2Runner.js` (Фаза 7)
15. `routes/api.js` (Фаза 8)
16. `KB/README_LOADING_FILES.md` (Фаза 9)

---

## Риски и ограничения

- **Тестирование**: после каждого лоадера стоит проверять на реальном проекте (запуск Step 1 дважды — второй раз должен быть быстрым)
- **Обратная совместимость**: mode=full сохраняет текущее поведение, миграция колонок через ADD COLUMN IF NOT EXISTS
- **file_info vs files**: legacy-таблица `file_info` не затрагивается
