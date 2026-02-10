# Предложение по разбиению api-contract.yaml

## Текущее состояние

**Файл:** `docs/api-contract.yaml`  
**Версия:** 2.6.0  
**Размер:** 4105 строк  
**Формат:** Монолитный YAML с несколькими логическими блоками

## Зачем разбивать?

✅ **Преимущества разбиения:**
1. У вас **11 доменов** — удобно разделить по файлам
2. 4105 строк — порог, когда навигация становится сложной
3. Разные команды/фичи могут работать независимо
4. Проще делать code review изменений в конкретном домене
5. Снижается риск merge conflicts

## Предлагаемая структура

```
docs/
├── api-contract.yaml              # Главный файл (info, servers, tags)
└── openapi/
    ├── schemas/
    │   ├── ai-item.yaml          # AiItem, AiItemSummary, AiItemType
    │   ├── graph.yaml            # GraphNode, GraphLink
    │   ├── files.yaml            # ProjectFile
    │   ├── tags.yaml             # Tag, TagSummary
    │   ├── prompts.yaml          # Prompt schemas
    │   ├── chunks.yaml           # ChunkVector
    │   ├── natural-query.yaml    # AgentScript, NaturalQueryRequest
    │   ├── links.yaml            # L1Link, L1LinkIn
    │   └── common.yaml           # Language, ErrorResponse
    ├── paths/
    │   ├── core.yaml             # /api/items/*
    │   ├── files.yaml            # /api/files/*
    │   ├── kb-config.yaml        # /api/kb-config/*
    │   ├── chat.yaml             # /api/chat/*
    │   ├── natural-query.yaml    # /api/v1/natural-query, /api/agent-scripts
    │   ├── pipeline.yaml         # /api/pipeline/*
    │   ├── prompts.yaml          # /api/prompts/*
    │   ├── tags.yaml             # /api/tags/*, /api/ai-items/bulk/tags/*
    │   ├── chunks.yaml           # /api/files/vectorize-chunk/*
    │   └── system.yaml           # /health, /logs, /contract
    └── responses/
        ├── errors.yaml           # 400, 404, 500
        └── success.yaml          # 200, 201
```

## Логические домены в текущем API

Из секции `tags` (строки 55-83):

1. **Core** — AiItems, статистика, граф зависимостей
2. **Project** — Новая модель: дерево файлов + точный выбор
3. **Knowledge Base** — Классическая настройка проекта (kb-config)
4. **RAG Chat** — Чат с RAG-движком
5. **Natural Query** — Запросы на естественном языке с автогенерацией скриптов
6. **Pipeline** — Управление pipeline обработки
7. **Streaming** — Server-Sent Events (логи, прогресс)
8. **System** — Health, логи, контракт
9. **Prompts** — Управление промптами для LLM
10. **Tags** — Управление тегами для классификации AiItems
11. **Chunks** — Управление чанками (chunk_vector): векторизация, метаданные

## Пример переписывания с $ref

### Было (монолитный файл):

```yaml
openapi: 3.0.3
info:
  title: AiItem RAG Architect API
  version: 2.6.0

components:
  schemas:
    AiItem:
      type: object
      properties:
        id: { type: string }
        type: { type: string }
    
    ProjectFile:
      type: object
      properties:
        path: { type: string }

paths:
  /api/items:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/AiItem'
```

### Стало (разбитый на файлы):

**docs/api-contract.yaml** (главный файл):
```yaml
openapi: 3.0.3
info:
  title: AiItem RAG Architect API
  version: 2.6.0
  description: |
    RESTful API для системы RAG-анализа кодовой базы.
    (описание версий...)

servers:
  - url: http://localhost:3200
    description: Development server
  - url: https://api.aiitem.example.com
    description: Production server

tags:
  - name: Core
    description: AiItems, статистика, граф зависимостей
  # ... остальные теги

components:
  schemas:
    # Ссылки на внешние схемы
    AiItem:
      $ref: './openapi/schemas/ai-item.yaml#/AiItem'
    AiItemSummary:
      $ref: './openapi/schemas/ai-item.yaml#/AiItemSummary'
    AiItemType:
      $ref: './openapi/schemas/ai-item.yaml#/AiItemType'
    
    ProjectFile:
      $ref: './openapi/schemas/files.yaml#/ProjectFile'
    
    Language:
      $ref: './openapi/schemas/common.yaml#/Language'
    
    GraphNode:
      $ref: './openapi/schemas/graph.yaml#/GraphNode'
    GraphLink:
      $ref: './openapi/schemas/graph.yaml#/GraphLink'
    
    L1Link:
      $ref: './openapi/schemas/links.yaml#/L1Link'
    L1LinkIn:
      $ref: './openapi/schemas/links.yaml#/L1LinkIn'

paths:
  # Ссылки на внешние пути
  /api/items:
    $ref: './openapi/paths/core.yaml#/~1api~1items'
  /api/items/{id}:
    $ref: './openapi/paths/core.yaml#/~1api~1items~1{id}'
  
  /api/files:
    $ref: './openapi/paths/files.yaml#/~1api~1files'
  
  /api/kb-config:
    $ref: './openapi/paths/kb-config.yaml#/~1api~1kb-config'
  
  /api/chat:
    $ref: './openapi/paths/chat.yaml#/~1api~1chat'
  
  /api/v1/natural-query:
    $ref: './openapi/paths/natural-query.yaml#/~1api~1v1~1natural-query'
```

**docs/openapi/schemas/ai-item.yaml**:
```yaml
AiItemType:
  type: string
  enum: [function, class, method, module, interface, struct, table, table_column, view, procedure, trigger, index, sequence, type, domain, schema, role, grant]

AiItem:
  type: object
  required: [id, type, language, l0_code, l1_in, l1_out, l2_desc, filePath]
  properties:
    id: { type: string, example: "utils.fetchData" }
    type: { $ref: '#/AiItemType' }
    language: { $ref: '../common.yaml#/Language' }
    l0_code: { type: string }
    l1_in: 
      type: array 
      items: { $ref: '../links.yaml#/L1LinkIn' }
      description: "Входящие связи с типом: кто вызывает/использует этот элемент"
    l1_out: 
      type: array 
      items: { $ref: '../links.yaml#/L1Link' }
      description: "Исходящие связи с типом: что вызывает/использует этот элемент"
    l2_desc: { type: string }
    filePath: { type: string, example: "./src/utils/api.ts" }
    isVectorized:
      type: boolean
      description: Флаг наличия хотя бы одного embedding для чанков этого ai_item
      default: false

AiItemSummary:
  type: object
  required: [id, type, language, filePath]
  properties:
    id: { type: string, example: "utils.fetchData" }
    type: { $ref: '#/AiItemType' }
    language: { $ref: '../common.yaml#/Language' }
    filePath: { type: string, example: "./src/utils/api.ts" }
    tags:
      type: array
      description: Список тегов, связанных с элементом (опционально)
      items: { $ref: './tags.yaml#/TagSummary' }
      default: []
    isVectorized:
      type: boolean
      description: Флаг наличия хотя бы одного embedding для чанков этого ai_item
      default: false
```

**docs/openapi/schemas/common.yaml**:
```yaml
Language:
  type: string
  nullable: true
  description: Язык кода, определённый по расширению файла (например: python, javascript, sql, unknown и т.д.)
  example: sql

ErrorResponse:
  type: object
  properties:
    error:
      type: string
      description: Описание ошибки
    details:
      type: object
      description: Дополнительные детали ошибки
```

**docs/openapi/paths/core.yaml**:
```yaml
/api/items:
  get:
    tags:
      - Core
    summary: Получить список всех AiItems
    parameters:
      - name: context-code
        in: query
        required: true
        schema:
          type: string
    responses:
      '200':
        description: Список AiItems
        content:
          application/json:
            schema:
              type: array
              items:
                $ref: '../schemas/ai-item.yaml#/AiItemSummary'
      '500':
        description: Внутренняя ошибка сервера
        content:
          application/json:
            schema:
              $ref: '../schemas/common.yaml#/ErrorResponse'

/api/items/{id}:
  get:
    tags:
      - Core
    summary: Получить полный AiItem по ID
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
      - name: context-code
        in: query
        required: true
        schema:
          type: string
    responses:
      '200':
        description: Полный AiItem
        content:
          application/json:
            schema:
              $ref: '../schemas/ai-item.yaml#/AiItem'
      '404':
        description: AiItem не найден
      '500':
        description: Внутренняя ошибка сервера
```

## План миграции

### Шаг 1: Подготовка структуры директорий
```bash
mkdir -p docs/openapi/schemas
mkdir -p docs/openapi/paths
mkdir -p docs/openapi/responses
```

### Шаг 2: Извлечение schemas (примерные диапазоны строк)
1. **ai-item.yaml**: Извлечь `AiItemType`, `AiItem`, `AiItemSummary` (строки ~88-152)
2. **links.yaml**: Извлечь `L1Link`, `L1LinkIn` (строки ~154-175)
3. **graph.yaml**: Извлечь `GraphNode`, `GraphLink` (строки ~177-220)
4. **common.yaml**: Извлечь `Language`, общие типы ошибок
5. **files.yaml**: Извлечь `ProjectFile`
6. **tags.yaml**: Извлечь схемы тегов
7. **prompts.yaml**: Извлечь схемы промптов
8. **chunks.yaml**: Извлечь схемы чанков
9. **natural-query.yaml**: Извлечь схемы агентных скриптов

### Шаг 3: Извлечение paths
Нужно найти секцию `paths:` в текущем файле (после строки 200) и разбить по доменам.

### Шаг 4: Обновление главного файла
Заменить определения на `$ref` к внешним файлам.

### Шаг 5: Валидация
Использовать инструмент для валидации OpenAPI спецификации:
```bash
# Swagger CLI
npx @apidevtools/swagger-cli validate docs/api-contract.yaml

# Redocly CLI (рекомендуется)
npx @redocly/cli lint docs/api-contract.yaml
```

## Альтернативный вариант: частичное разбиение

Если полное разбиение кажется слишком трудоёмким, можно начать с **гибридного подхода**:

1. **Оставить schemas в главном файле** (они относительно компактные)
2. **Вынести только paths** (обычно самая большая секция)

```
docs/
├── api-contract.yaml              # Главный файл + все schemas
└── openapi/
    └── paths/
        ├── core.yaml
        ├── files.yaml
        ├── kb-config.yaml
        ├── chat.yaml
        ├── natural-query.yaml
        ├── pipeline.yaml
        ├── prompts.yaml
        ├── tags.yaml
        ├── chunks.yaml
        └── system.yaml
```

Это даст ~70% выгоды при ~30% трудозатрат.

## Инструменты для работы с разбитыми спецификациями

1. **Redocly CLI** — валидация и сборка разбитых спецификаций
2. **Swagger CLI** — объединение файлов в один для публикации
3. **openapi-merge** — автоматическое слияние нескольких OpenAPI файлов
4. **Stoplight Studio** — визуальный редактор с поддержкой $ref

## Рекомендация

**Начните с гибридного подхода:**
1. Вынесите `paths` в отдельные файлы по доменам (10 файлов)
2. Схемы оставьте в главном файле
3. Если будет удобно — потом вынесите и schemas

Это даст вам **быструю навигацию** и **изоляцию изменений** без необходимости переписывать все `$ref` в схемах.
