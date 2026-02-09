# Тестирование проекта Aian-Vector

В проекте `aian-vector` используется несколько уровней тестирования для проверки корректной работы нового сервера `server-v2` и ядра `packages/core`.

## 1. API Smoke Test (`server-v2/api_test.js`)

Этот скрипт выполняет базовую проверку ("smoke test") доступности и работоспособности основных `GET` эндпоинтов сервера.

### Что проверяет:
-   **Доступность сервера**: Отправляет запрос на несуществующий роут и ожидает получить ответ `404 Not Found`.
-   **Получение списка файлов**: Проверяет эндпоинт `GET /files`, ожидает ответ `200 OK` и список файлов.
-   **Получение кодов контекста**: Проверяет `GET /context-codes`.
-   **Работоспособность RAG**: Отправляет запрос `POST /ask` и проверяет, что сервер отвечает, даже если контекст не найден.

### Как запустить:
1.  Убедитесь, что сервер `server-v2` запущен.
    ```bash
    node server-v2/index.js
    ```
2.  В отдельном терминале выполните команду:
    ```bash
    node server-v2/api_test.js
    ```

## 2. End-to-End (E2E) Full Cycle Test (`server-v2/full_cycle_test.js`)

Это комплексный тест, который проверяет весь жизненный цикл обработки одного файла: от векторизации до получения ответа от RAG и последующей очистки.

### Что проверяет:
-   **Полный CRUD-цикл для документов**:
    1.  **Удаление (Cleanup)**: Перед тестом отправляется `DELETE /file/:filename`, чтобы гарантировать отсутствие тестового файла в базе.
    2.  **Создание (Vectorization)**: Тестовый файл `server-v2/test_data/test_file.js` векторизуется через эндпоинт `POST /vectorize`. Тест проверяет, что API возвращает успешный статус и ненулевое количество созданных чанков.
    3.  **Чтение (Verification)**: Скрипт запрашивает чанки для созданного файла через `GET /file-chunks/:filename` и убеждается, что они появились в базе данных.
    4.  **Удаление (Final Cleanup)**: После всех проверок тестовый файл и все его чанки удаляются из базы данных через `DELETE /file/:filename`.
-   **Работоспособность RAG с реальным контекстом**:
    -   Тест задает конкретный вопрос, ответ на который содержится в `test_file.js`.
    -   Проверяется, что ответ от `POST /ask` содержит в себе фрагменты кода/текста из найденных чанков, а не ответ по умолчанию "информация не найдена". Это подтверждает, что вся цепочка (поиск -> ретривер -> модель) работает корректно.

### Как запустить:
1.  Убедитесь, что сервер `server-v2` запущен.
    ```bash
    node server-v2/index.js
    ```
2.  В отдельном терминале выполните команду:
    ```bash
    node server-v2/full_cycle_test.js
    ```

## 3. End-to-End (E2E) Folder Scan Test (`server-v2/folder_cycle_test.js`)

Этот тест проверяет весь конвейер для функциональности "Сканировать папку". Он эмулирует пакетную обработку нескольких файлов, расположенных в специальной тестовой директории.

### Что проверяет:
-   **Пакетная обработка**:
    1.  **Подготовка**: Создана тестовая папка `server-v2/test_data/test_folder` с несколькими файлами (`.js`, `.md`).
    2.  **Предварительная очистка**: Перед тестом скрипт удаляет все документы, связанные с тестовыми файлами, чтобы обеспечить чистоту эксперимента.
    3.  **Запуск сканирования**: Вызывается эндпоинт `POST /scan-and-vectorize` с путем к тестовой папке. Тест проверяет, что API возвращает успешный статус.
    4.  **Проверка (Verification)**: Для каждого файла из тестовой папки скрипт отправляет запрос `GET /file-chunks/:filename` и убеждается, что для всех файлов были созданы и сохранены чанки в базе данных.
-   **Работоспособность RAG с контекстом из нескольких файлов**:
    -   Тест задает конкретные вопросы, ответы на которые содержатся в разных файлах тестовой папки.
    -   Проверяется, что RAG находит правильный контекст для каждого вопроса и отвечает на основе содержимого соответствующего файла.
-   **Финальная очистка**: После всех проверок тестовые файлы и все их чанки удаляются из базы данных.

### Как запустить:
1.  Убедитесь, что сервер `server-v2` запущен.
    ```bash
    node server-v2/index.js
    ```
2.  В отдельном терминале выполните команду:
    ```bash
    node server-v2/folder_cycle_test.js
    ```

## 4. Full System Test (`tests/full_system_test.js`)

Полный E2E тест системы, проверяющий весь pipeline обработки кода.

### Что проверяет:
- Multi-root конфигурацию (несколько rootPath)
- Парсинг и загрузку файлов разных типов (JS, TS, PHP, SQL, DDL)
- Создание ai_items и chunk_vector
- Связи L1 в таблице link
- Извлечение колонок таблиц из SQL-функций
- Logic Architect API
- Natural Query API

### Как запустить:
```bash
node tests/full_system_test.js
```

Подробнее см. [KB/README_FULL_TEST.md](../KB/README_FULL_TEST.md)

## 5. Column Extractor Test (`tests/test_column_extractor.js`)

Тест извлечения колонок таблиц из SQL-функций.

### Что проверяет:
- Парсинг алиасов таблиц из FROM/JOIN
- Извлечение колонок из SELECT, UPDATE SET, INSERT
- Резолвинг полных имён колонок через загруженные таблицы
- Создание ai_item типа `table_column`
- Создание связей function→column с типами reads_column, updates_column, inserts_column

### Как запустить:
```bash
node tests/test_column_extractor.js
```

## 6. Пакетное извлечение колонок

Для извлечения колонок из всех SQL-функций в контексте используйте API:

```bash
curl -X POST "http://localhost:3200/api/extract-all-columns?context-code=CARL"
```

Или из full_system_test.js — функция `testColumnExtraction()` автоматически обрабатывает все SQL-функции.

## 7. Markdown Loader Tests

Тесты для проверки загрузки и обработки Markdown файлов с созданием иерархической структуры ai_items и связей.

### 7.1. Direct MD Loader Test (`tests/test_md_loader_direct.js`)

Прямой тест MD загрузчика без использования pipeline API. Проверяет загрузку Markdown файла, создание ai_items и связей.

**ВАЖНО:** Этот тест использует сам файл `README_TESTS.md` в качестве тестового документа, проверяя загрузку реальной документации.

#### Что проверяет:
- Парсинг структуры Markdown (H1, H2 заголовки)
- Создание ai_items типов: `md_doc`, `head_level_1`, `head_level_2`
- Создание L0 чанков для каждой секции
- Создание связей: `md_includes`, `md_included_in`, `md_follows`, `md_precedes`
- Иерархическую структуру документа (mdDoc → H1 → H2)

#### Как запустить:
```bash
bun tests/test_md_loader_direct.js
```

**Тестовый файл:** `tests/README_TESTS.md` (этот файл!)
**Контекст:** `TEST_MD`

### 7.2. MD Loader via Pipeline (`tests/test_md_loader.js`)

Тест загрузки Markdown через pipeline API (HTTP).

#### Что проверяет:
- Полный цикл через HTTP API
- Работу Step1 pipeline с MD файлами
- Конфигурацию kb-config с `md_loading.enabled`
- Создание ai_items и связей через pipeline

#### Как запустить:
1. Запустите сервер:
   ```bash
   node server.js
   ```
2. В отдельном терминале:
   ```bash
   node tests/test_md_loader.js
   ```

Базовый URL: `http://localhost:3200`
Контекст: `TEST_MD`

### 7.3. MD Types Check (`tests/check_md_types.js`)

Проверка типов созданных ai_items для Markdown документов.

#### Что проверяет:
- Наличие ai_items типов `md_doc`, `head_level_1`, `head_level_2`
- Количество созданных элементов каждого типа
- Корректность full_name для каждого типа

#### Как запустить:
```bash
node tests/check_md_types.js
```

### 7.4. MD Links Check (`tests/check_md_links.js`)

Проверка связей между Markdown секциями.

#### Что проверяет:
- Связи типа `md_follows` (последовательность H2 внутри одного H1)
- Связи типа `md_precedes` (обратные к follows)
- Связи типа `md_includes` (H1 включает H2, mdDoc включает H1)
- Связи типа `md_included_in` (обратные к includes)

#### Как запустить:
```bash
node tests/check_md_links.js
```

### 7.5. MD Vectorization Tests

#### Simple Embeddings (`tests/test_md_vectorize_ai_items.js`)

Тест векторизации MD ai_items с использованием SimpleEmbeddings.

**ВАЖНО:** Использует `README_TESTS.md` как тестовый файл.

**Что проверяет:**
- Загрузку MD файла и создание ai_items без embeddings
- Векторизацию всех L0 чанков
- Обновление поля embedding в chunk_vector

**Как запустить:**
```bash
bun tests/test_md_vectorize_ai_items.js
```

**Тестовый файл:** `tests/README_TESTS.md`
**Контекст:** `TEST_MD_VECTORIZE`

#### OpenAI Embeddings (`tests/test_md_vectorize_ai_items_openai.js`)

Тест векторизации с реальной моделью OpenAI (text-embedding-ada-002).

**ВАЖНО:** Использует `README_TESTS.md` как тестовый файл.

**Что проверяет:**
- Векторизацию с OpenAI API
- Работу с реальными embeddings (1536 измерений)
- API маршрут `/api/vectorize-ai-items`

**Требования:**
- OPENAI_API_KEY в .env файле
- При отсутствии ключа тест пропускается (exit 0)

**Как запустить:**
```bash
bun tests/test_md_vectorize_ai_items_openai.js
```

**Тестовый файл:** `tests/README_TESTS.md`
**Контекст:** `TEST_MD_VECTORIZE_OPENAI`

### 7.6. MD Parser Test (`tests/test_md_parser.js`)

Юнит-тест парсера Markdown структуры.

#### Что проверяет:
- Корректность регулярных выражений для H1 и H2
- Различение H1 от H2 (# vs ##)
- Извлечение заголовков и их позиций

#### Как запустить:
```bash
node tests/test_md_parser.js
```

Тестовый файл: `tests/test_data/test_simple.md`

### Конфигурация для MD тестов

Тестовая конфигурация: `kb-configs/TEST_MD.json`

**Ключевые параметры:**
```json
{
  "metadata": {
    "custom_settings": {
      "md_loading": {
        "enabled": true
      }
    }
  },
  "includeMask": "**/*.{sql,js,ts,php,md}"
}
```

### Структура Markdown ai_items

Для файла `guide.md`:
```markdown
# Introduction
Some intro text.

## Getting Started
First steps.
```

Создаются ai_items:
- `doc:guide.md` (md_doc) — пролог/весь документ
- `doc:guide.md#H1:introduction` (head_level_1) — H1 секция
- `doc:guide.md##H2:introduction.getting_started` (head_level_2) — H2 секция

### Утилиты очистки

**Очистка TEST_MD данных:**
```bash
node temp_cleanup.js
```

Удаляет из БД все данные для контекста TEST_MD:
- links
- chunk_vector
- ai_item
- files

### Дополнительная информация

Подробное описание MD загрузки см. в [KB/README_MD_LOADING.md](../KB/README_MD_LOADING.md)

## Важные замечания

-   Все тесты используют `SimpleEmbeddings` и `SimpleChatModel` из ядра `packages/core`, которые являются "заглушками" и не предназначены для качественной семантической работы. Их цель — проверить работоспособность конвейера, а не качество AI-моделей.
-   Тесты спроектированы так, чтобы быть идемпотентными: `full_cycle_test.js` и `folder_cycle_test.js` сами за собой прибираются, удаляя созданные ими сущности.
-   `full_system_test.js` оставляет данные в БД для ручной проверки (context_code = FULL_TEST).
-   `test_column_extractor.js` использует отдельный context_code (COLUMN_TEST) и очищает данные после себя. 