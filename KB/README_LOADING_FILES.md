# Загрузка файлов в AIAN Vector

## Обзор

Система загрузки файлов в AIAN Vector построена на двухэтапном pipeline:

- **Шаг 1** (`step1Runner.js`) — сканирование, парсинг и загрузка файлов в БД
- **Шаг 2** (`step2Runner.js`) — проверка и авто-исправление L1 зависимостей

Поддерживаемые типы файлов: SQL (функции PL/pgSQL), JavaScript, TypeScript, **TSX (React)**, PHP, Markdown, DDL схемы, а также прямая загрузка схем таблиц из БД.

---

## Архитектура загрузки

```
┌─────────────────────────────────────────────────────────────────┐
│                        Pipeline Step 1                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Scan      │→│   Parse     │→│    Load to Database     │  │
│  │  (Glob/     │  │  (Entities  │  │  (AI Items + Chunks)    │  │
│  │ Selection)  │  │  Extraction)│  │                         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                        Pipeline Step 2                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  Analyze    │→│   Fix       │→│    Update Links         │  │
│  │  L1 Deps    │  │  Short→Full │  │    (link table)         │  │
│  │             │  │  Names      │  │                         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 1: Загрузка файлов (step1Runner.js)

### Конфигурация через kb-config

Загрузка управляется через `metadata.custom_settings` в формате YAML:

```yaml
# Включение загрузчиков
functions_loading:
  enabled: true        # SQL функции (по умолчанию true)

js_loading:
  enabled: true        # JavaScript файлы (по умолчанию false)

ts_loading:
  enabled: true        # TypeScript файлы (по умолчанию false)

tsx_loading:
  enabled: true        # TSX (React) файлы (по умолчанию false)

php_loading:
  enabled: true        # PHP файлы (по умолчанию false)

md_loading:
  enabled: true        # Markdown файлы (по умолчанию false)

ddl_loading:
  enabled: true        # DDL схемы из SQL файлов
  files:               # Список путей к DDL файлам
    - "./schema/tables.sql"
    - "./schema/indexes.sql"

# Загрузка таблиц из БД
table_loading:
  enabled: true
  schema: "public"                    # Схема (или несколько через запятую)
  include_patterns: ["user%", "order%"]  # SQL LIKE паттерны для включения
  exclude_patterns: ["temp%", "log%"]    # SQL LIKE паттерны для исключения
  exclude_names: ["migrations", "seeds"] # Точные имена для исключения
```

### Режимы сканирования файлов

#### Режим 1: Точный выбор файлов (приоритетный)

Используется когда `fileSelection` в kb-config не пустой:

```javascript
// Формат путей: {rootPath}\./{relativePath}
fileSelection: [
  "C:\\project\\src\\./utils/helpers.js",
  "C:\\project\\src\\./api/routes.js"
]
```

#### Режим 2: Glob-маски

Автоматическое сканирование по `includeMask` и `ignorePatterns`:

```json
{
  "includeMask": "**/*.{sql,js,ts,php,md}",
  "ignorePatterns": "**/node_modules/**, **/*.test.js"
}
```

### Процесс загрузки одного файла

```
┌─────────────────┐
│  Чтение файла   │
│  (fs.readFile)  │
└────────┬────────┘
         ↓
┌─────────────────┐
│  Парсинг        │
│  (извлечение    │
│   сущностей)    │
└────────┬────────┘
         ↓
┌─────────────────┐
│  Регистрация    │
│  файла в БД     │
│  (saveFileInfo) │
└────────┬────────┘
         ↓
┌─────────────────────────────────────────┐
│  Для каждой сущности:                   │
│  1. Создание AI Item                    │
│  2. Создание L0 чанка (0-исходник)      │
│  3. Парсинг L1 связей                   │
│  4. Создание L1 чанка (1-связи)         │
│  5. Создание записей в таблице link     │
└─────────────────────────────────────────┘
```

---

## Специализированные загрузчики (routes/loaders/)

### SQL Function Loader (`sqlFunctionLoader.js`)

**Поддерживаемые сущности:**
- PL/pgSQL функции (`CREATE FUNCTION`)

**Извлекаемые данные:**
- Имя функции (схема.имя)
- Сигнатура (параметры)
- Тело функции
- Комментарии перед функцией

**L1 связи (parsePlpgsqlFunctionL1):**
- `called_functions` — вызовы функций (PERFORM, SELECT func())
- `select_from` — таблицы в FROM/JOIN
- `update_tables` — таблицы в UPDATE
- `insert_tables` — таблицы в INSERT INTO

**Типы связей в link:**
- `calls` — вызовы функций
- `reads_from` — чтение из таблиц
- `updates` — обновление таблиц
- `inserts_into` — вставка в таблицы

**Экспортируемые функции:**
- `parsePlpgsqlFunctionL1(code)` — парсинг L1 зависимостей
- `parseFunctionsFromContent(content, filePath)` — извлечение функций из SQL файла
- `loadSqlFunctionsFromFile(filePath, contextCode, dbService, pipelineState)` — полная загрузка файла

### JavaScript Loader (`jsFunctionLoader.js`)

**Поддерживаемые сущности:**
- Классы (`class Name {}`)
- Функции (`function name() {}`)
- Arrow functions (`const name = () => {}`)
- Методы классов

**L1 связи (parseJsFunctionL1):**
- `called_functions` — вызовы функций
- `imports` — ES6 импорты
- `requires` — CommonJS require

**Типы связей в link:**
- `calls` — вызовы функций
- `imports` — импорты модулей
- `depends_on` — зависимости

**Экспортируемые функции:**
- `parseJsFunctionL1(code)` — парсинг L1 зависимостей
- `parseJsEntitiesFromContent(content, filePath)` — извлечение сущностей из JS файла
- `loadJsFunctionsFromFile(filePath, contextCode, dbService, pipelineState)` — полная загрузка файла

### TypeScript Loader (`tsFunctionLoader.js`)

**Поддерживаемые сущности:**
- Интерфейсы (`interface Name {}`)
- Type алиасы (`type Name = ...`)
- Enum (`enum Name {}`)
- Классы (с дженериками, extends, implements)
- Функции (с типами параметров и возврата)
- Arrow functions (с типами)
- Методы классов

**L1 связи (parseTsFunctionL1):**
- `called_functions` — вызовы функций
- `imports` — ES6 импорты
- `type_imports` — type-only импорты

**Экспортируемые функции:**
- `parseTsFunctionL1(code)` — парсинг L1 зависимостей
- `parseTsEntitiesFromContent(content, filePath)` — извлечение сущностей из TS файла
- `loadTsFunctionsFromFile(filePath, contextCode, dbService, pipelineState)` — полная загрузка файла

### TSX Loader (`tsxLoader.js`)

**Назначение:** Загрузка React компонентов и хуков из TSX файлов. Использует `@babel/parser` с плагинами `typescript` и `jsx`.

**Поддерживаемые сущности:**
- React функциональные компоненты (`function Button() { return <div>...</div> }`)
- Arrow компоненты (`const Button = () => <div>...</div>`)
- React классы (`class Button extends React.Component`)
- Кастомные хуки (`function useLocalState() {...}`)
- Интерфейсы (`interface ButtonProps {...}`)
- Type алиасы (`type ButtonVariant = ...`)
- forwardRef компоненты (`const Input = forwardRef(...)`)
- memo компоненты (`const Display = memo(...)`)
- styled-components (`const Wrapper = styled.div\`...\``)

**Типы AI Items:**
- `tsx_component` — React компонент
- `tsx_hook` — кастомный хук (паттерн `useXxx`)
- `interface` — TypeScript интерфейс
- `type` — type alias
- `class` — обычный класс (не React)

**L1 связи (parseTsxL1):**
- `imports` — ES6 импорты
- `type_imports` — type-only импорты
- `uses_components` — использование компонентов в JSX (`<Button>`, `<Modal.Header>`)
- `uses_hooks` — вызовы хуков (`useState`, `useEffect`, `useCustomHook`)
- `called_functions` — обычные вызовы функций

**Типы связей в link:**
- `imports` — импорты модулей
- `uses_component` — использование компонента в JSX
- `uses_hook` — вызов хука
- `calls` — вызовы функций

**Metadata для edge cases:**
- `wrapper: "forwardRef"` — компонент обёрнут в forwardRef
- `wrapper: "memo"` — компонент обёрнут в memo
- `classComponent: true` — класс-компонент (extends React.Component)
- `styled: true` — styled-component

**Экспортируемые функции:**
- `parseTsxL1(code, entityType)` — парсинг L1 зависимостей через AST
- `parseTsxEntitiesFromContent(content, filePath)` — извлечение сущностей из TSX файла
- `loadTsxFromFile(filePath, contextCode, dbService, pipelineState)` — полная загрузка файла
- `isCustomHook(name)` — проверка имени на паттерн хука
- `isComponentName(name)` — проверка имени на паттерн компонента

### PHP Loader (`phpFunctionLoader.js`)

**Поддерживаемые сущности:**
- Интерфейсы (`interface Name {}`)
- Traits (`trait Name {}`)
- Классы (abstract, final, extends, implements)
- Функции (вне классов)
- Методы классов (с модификаторами доступа)

**L1 связи (parsePhpFunctionL1):**
- `called_functions` — вызовы функций/методов
- `use_statements` — use Namespace\Class
- `require_include` — require/include файлов
- `instantiations` — new ClassName()

**Экспортируемые функции:**
- `parsePhpFunctionL1(code)` — парсинг L1 зависимостей
- `parsePhpEntitiesFromContent(content, filePath)` — извлечение сущностей из PHP файла
- `loadPhpFunctionsFromFile(filePath, contextCode, dbService, pipelineState)` — полная загрузка файла

### Markdown Loader (`mdLoader.js`)

**Структура документа:**
- `md_doc` — пролог до первого H1
- `head_level_1` — разделы `# Title`
- `head_level_2` — подразделы `## Subtitle`

**Формат full_name:**
- `doc:{filename}` — пролог
- `doc:{filename}#H1:{slug}` — H1 раздел
- `doc:{filename}##H2:{h1_slug}.{h2_slug}` — H2 подраздел

**L1 связи:**
- `md_includes` / `md_included_in` — иерархия включения
- `md_follows` / `md_precedes` — последовательность H2

**Экспортируемые функции:**
- `parseMdStructure(content, filename)` — парсинг структуры Markdown документа
- `loadMarkdownFromFile(filePath, contextCode, dbService, pipelineState)` — полная загрузка файла

### DDL Schema Loader (`ddlSchemaLoader.js`)

**Поддерживаемые конструкции:**
- `CREATE TABLE` с колонками, constraints
- `CREATE INDEX` (обычные и unique)
- Комментарии к таблицам и колонкам

**Извлекаемые данные:**
- Структура колонок (тип, nullable, default, PK, FK)
- Constraints (PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK)
- Индексы

**L1 связи (parseTableL1):**
- `foreign_keys` — ссылки на другие таблицы

**Экспортируемые функции:**
- `parseTablesFromContent(content)` — извлечение CREATE TABLE из SQL
- `parseIndexesFromContent(content)` — извлечение CREATE INDEX из SQL
- `parseTableL1(tableInfo)` — парсинг L1 зависимостей (FK)
- `loadDdlFromFile(filePath, contextCode, dbService, pipelineState)` — полная загрузка файла

### Table Schema Loader (`tableSchemaLoader.js`)

**Назначение:** Загрузка схем таблиц напрямую из БД (через MCP)

**Процесс:**
1. Получение списка таблиц через `pg-mcp.ts`
2. Генерация виртуального DDL
3. Создание AI Item и L0 чанка

**Экспортируемые функции:**
- `getFilteredTableNames(dbService, config)` — получение списка таблиц по фильтрам
- `loadTableSchema(tableName, schemaName, contextCode, dbService, pipelineState)` — загрузка схемы одной таблицы
- `getVirtualFilename(schemaName, tableName)` — генерация имени виртуального файла

### Column Extractor (`columnExtractor.js`)

**Назначение:** Извлечение колонок из SQL функций и создание связей с таблицами

**Процесс:**
1. Парсинг тела SQL функции
2. Разрешение алиасов таблиц
3. Извлечение используемых колонок
4. Создание связей в таблице `link`

**Экспортируемые функции:**
- `parseColumnsFromSqlBody(sqlBody)` — извлечение колонок из SQL кода
- `resolveTableAliases(sqlBody)` — разрешение алиасов таблиц (t1 → users)
- `findTableByName(tableName, contextCode, dbService)` — поиск таблицы в БД
- `extractColumnsFromFunction(functionFullName, contextCode, dbService)` — извлечение колонок для одной функции
- `extractColumnsFromAllFunctions(contextCode, dbService)` — пакетная обработка всех функций

---

## Step 2: Исправление зависимостей (step2Runner.js)

### Задачи шага 2

1. **Проверка целостности AI Items**
   - Поиск `full_name` без схемы (без точки)
   - Логирование проблем

2. **Проверка L0 чанков**
   - Поиск чанков без схемы в `full_name`
   - Логирование проблем

3. **Анализ и исправление L1 чанков**
   - Парсинг `chunk_content` JSON
   - Поиск коротких имён зависимостей (без точки)
   - Разрешение в полные имена через поиск в `ai_item`
   - Обновление `chunk_content`

4. **Анализ и исправление таблицы link**
   - Поиск связей с короткими `target`
   - Разрешение в полные имена
   - Обработка дубликатов (удаление)

### Алгоритм разрешения имён

```sql
-- Поиск кандидатов по regexp
SELECT full_name FROM public.ai_item
WHERE context_code = $1
  AND full_name ~ ('^[^.]+\.' || $2 || '$')
```

**Логика:**
- 0 кандидатов → `missing` (отсутствует)
- 1 кандидат → `fixed` (исправлено)
- 2+ кандидатов → `ambiguous` (неоднозначность)

---

## Структура данных при загрузке

### AI Item

```sql
INSERT INTO public.ai_item (
  full_name,      -- полное имя сущности (schema.name или Class.method)
  context_code,   -- код контекста
  type,           -- тип: function, class, method, interface, etc.
  s_name,         -- короткое имя
  h_name,         -- human-readable название
  file_id         -- ссылка на files
)
```

### Chunk Vector (L0)

```sql
INSERT INTO public.chunk_vector (
  file_id,
  chunk_content,  -- JSON: { text: {...}, comment: "..." }
  metadata,       -- { type, level: "0-исходник", full_name, s_name }
  ai_item_id      -- ссылка на ai_item
)
```

### Chunk Vector (L1)

```sql
INSERT INTO public.chunk_vector (
  file_id,
  chunk_content,  -- JSON: { text: { called_functions: [...], imports: [...] } }
  metadata,       -- { type: "json", level: "1-связи", full_name, s_name }
  parent_chunk_id,-- ссылка на L0 чанк
  ai_item_id      -- ссылка на ai_item
)
```

### Link (L1 связи)

```sql
INSERT INTO public.link (
  context_code,
  source,         -- full_name источника
  target,         -- full_name цели (или короткое имя до исправления)
  link_type_id,   -- ссылка на link_type
  file_id
)
```

---

## Отчётность и логирование

### Структура отчёта Step 1

```javascript
{
  summary: {
    totalFiles: 0,       -- обработано файлов
    totalTables: 0,      -- таблиц из БД
    totalFunctions: 0,   -- функций/сущностей
    totalAiItems: 0,     -- создано AI Items
    totalChunks: 0,      -- создано чанков
    errors: 0,           -- ошибок
    skipped: 0           -- пропущено
  },
  details: {
    sqlFiles: [],        -- отчёты по SQL файлам
    jsFiles: [],         -- отчёты по JS файлам
    tsFiles: [],         -- отчёты по TS файлам
    phpFiles: [],        -- отчёты по PHP файлам
    mdFiles: [],         -- отчёты по MD файлам
    ddlFiles: [],        -- отчёты по DDL файлам
    tables: [],          -- отчёты по таблицам
    errors: []           -- список ошибок
  },
  logs: []               -- логи выполнения
}
```

### Структура отчёта Step 2

```javascript
{
  summary: {
    aiItemsNoSchema: 0,      -- AI Items без схемы
    l0ChunksNoSchema: 0,     -- L0 чанков без схемы
    l1ChunksAnalyzed: 0,     -- проанализировано L1 чанков
    missingDeps: 0,          -- отсутствующих зависимостей
    ambiguousDeps: 0,        -- неоднозначных зависимостей
    fixedDeps: 0,            -- исправлено зависимостей
    linksAnalyzed: 0,        -- проанализировано связей
    linksFixed: 0,           -- исправлено связей
    linksMissing: 0,         -- отсутствующих связей
    linksAmbiguous: 0        -- неоднозначных связей
  },
  details: {
    fixes: [],               -- список исправлений L1
    ambiguous: [],           -- неоднозначности L1
    missing: [],             -- отсутствующие L1
    linkFixes: [],           -- исправления link
    linkMissing: [],         -- отсутствующие link
    linkAmbiguous: []        -- неоднозначные link
  },
  logs: []                   -- логи выполнения
}
```

---

## API для запуска загрузки

### Запуск полного pipeline

```bash
POST /api/pipeline/start?context-code=MY_CONTEXT
```

Pipeline автоматически выполняет Step 1 → Step 2.

### Запуск отдельных шагов

```bash
# Только Step 1 (загрузка файлов)
POST /api/pipeline/step/1/run?context-code=MY_CONTEXT

# Только Step 2 (исправление зависимостей)
POST /api/pipeline/step/2/run?context-code=MY_CONTEXT
```

### Параметры

- `context-code` (обязательный) — код контекста из kb-config

### Мониторинг состояния

```bash
# Текущий статус шагов
GET /api/pipeline/steps/status?context-code=MY_CONTEXT

# Прогресс выполнения (по ID pipeline)
GET /api/pipeline/{id}/progress

# История выполнения всех шагов
GET /api/pipeline/steps/history?context-code=MY_CONTEXT

# История конкретного шага
GET /api/pipeline/step/{id}/history?context-code=MY_CONTEXT
```

---

## Пример конфигурации kb-config

```json
{
  "contextCode": "MY_PROJECT",
  "rootPath": "C:\\project\\src, C:\\project\\shared",
  "includeMask": "**/*.{sql,js,ts,php,md}",
  "ignorePatterns": "**/node_modules/**, **/*.test.js, **/*.spec.js",
  "fileSelection": [],
  "metadata": {
    "custom_settings": "functions_loading:\n  enabled: true\njs_loading:\n  enabled: true\nts_loading:\n  enabled: true\nmd_loading:\n  enabled: true\ntable_loading:\n  enabled: true\n  schema: public\n  include_patterns: []\n  exclude_patterns: [\"log_%\", \"temp_%\"]\n  exclude_names: [\"migrations\"]"
  }
}
```

---

## Расширение системы

### Добавление нового загрузчика

1. Создать файл `routes/loaders/{name}Loader.js`
2. Экспортировать функции:
   - `parse{Name}EntitiesFromContent(content, filePath)` — парсинг сущностей из контента файла
   - `parse{Name}FunctionL1(code)` — извлечение L1 связей из тела сущности
   - `load{Name}FunctionsFromFile(filePath, contextCode, dbService, pipelineState)` — загрузка файла целиком
3. Добавить парсинг конфигурации в `step1Runner.js`:
   - `parse{Name}LoadingConfig(customSettings)` — парсер YAML конфигурации
4. Добавить сканирование и обработку в `runStep1()`
5. Добавить типы связей в таблицу `link_type` если нужно

**Примечание:** Для SQL функций используется имя `parseFunctionsFromContent` (без "Sql" префикса), для остальных — `parse{Name}EntitiesFromContent`.

---

## Связанная документация

- [README_MD_LOADING.md](README_MD_LOADING.md) — подробно о загрузке Markdown
- [README_AI_ITEM_COMPLETE.md](README_AI_ITEM_COMPLETE.md) — AI Items
- [README_links.md](README_links.md) — система связей L1
- [README_DB-VECTOR.md](README_DB-VECTOR.md) — структура БД
- [README_REST.md](README_REST.md) — API endpoints

---

**Последнее обновление:** 11 февраля 2026
