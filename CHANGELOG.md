# Changelog

Все важные изменения в проекте документируются в этом файле.

---

## [2.9.0] - 2026-02-08

### ✨ Добавлено

#### Prompts Config API - Управление конфигурацией промптов с историей изменений

**REST API эндпоинты:**
- **GET /api/prompts-config** - получить текущую конфигурацию промптов из prompts.json
- **PATCH /api/prompts-config** - обновить конфигурацию с сохранением в историю
- **GET /api/prompts-config/history** - получить список версий (с пагинацией)
- **GET /api/prompts-config/history/:id** - получить конкретную версию с полным snapshot
- **POST /api/prompts-config/restore/:id** - восстановить конфигурацию из истории
- **POST /api/prompts-config/reset** - сбросить к дефолтным значениям
- **DELETE /api/prompts-config/history/:id** - удалить запись из истории

#### База данных
- **Новая таблица:** `prompt_config_history`
  - `id` (serial) - уникальный идентификатор
  - `config_snapshot` (jsonb) - полный snapshot конфигурации
  - `created_at` (timestamp) - дата создания
  - `version` (integer, unique) - номер версии (автоинкремент)
  - `comment` (text, nullable) - комментарий к изменению
- **Индексы:** по `created_at` и `version` для быстрого поиска
- **Автоочистка:** триггер автоматически удаляет старые версии (оставляется 100 последних)

#### Валидация конфигурации
- ✅ Проверка наличия всех 4 основных секций: `l1l2Templates`, `rag`, `naturalQuery`, `vectorOperations`
- ✅ Проверка обязательных полей в `rag`: `systemPrompt`, `userPromptTemplate`
- ✅ Проверка обязательных полей в `naturalQuery`: `scriptGeneration`, `humanize`
- ✅ Проверка обязательного поля в `vectorOperations`: `qaPromptTemplate`
- ✅ Проверка типов данных (string, object)

#### Новые файлы
- `packages/core/promptsConfigService.js` - сервис для работы с prompts.json и историей
- `routes/promptsConfig.js` - REST API маршруты для управления промптами
- `tmp/add_prompt_config_history.sql` - SQL миграция для создания таблицы истории
- `tests/test_prompts_config.js` - тестовый скрипт (9 сценариев)
- `KB/README_PROMPTS_CONFIG_API.md` - документация по Backend API (548 строк)
- `docs/README_Frontend_Prompts_Integration.md` - руководство для фронтенд-разработчиков (1864 строки)

#### OpenAPI Contract обновления
- Обновлена версия контракта до **2.9.0**
- **Добавлены схемы** в `docs/openapi/schemas/common.yaml` (+193 строки):
  - `PromptsConfig` - полная конфигурация промптов
  - `PromptsConfigResponse` - ответ при получении конфигурации
  - `PromptsConfigUpdateRequest` - запрос на обновление
  - `PromptsConfigUpdateResponse` - ответ при обновлении
  - `PromptsConfigHistoryEntry` - запись истории (краткая)
  - `PromptsConfigHistoryEntryFull` - запись истории (полная)
  - `PromptsConfigHistoryResponse` - список истории
  - `PromptsConfigRestoreRequest` - запрос на восстановление
  - `PromptsConfigValidationError` - ошибка валидации
- **Добавлены пути** в `docs/openapi/paths/system.yaml` (+247 строк)
- Обновлён главный контракт `docs/api-contract.yaml`

#### Документация
- Обновлён `README.md` - добавлены ссылки на новую документацию
- Обновлён `KB/README_REST.md` - добавлена секция версии 2.9.0
- Создан `KB/README_PROMPTS_CONFIG_API.md` - полная backend документация
- Создан `docs/README_Frontend_Prompts_Integration.md` - гайд для фронтенда с React и Vue примерами

### 📝 Особенности

- **Не требует `context-code`** - промпты глобальные для всего приложения
- **История в PostgreSQL** - все изменения сохраняются в БД с версионированием
- **Комментарии** - каждое изменение можно прокомментировать
- **Восстановление** - можно откатиться к любой версии из истории
- **Автоочистка** - хранится только последние 100 версий
- **Открытый endpoint** - нет авторизации/аутентификации (для локальной разработки)

### 🔧 Технические детали

- Сервис реализован по аналогии с `appConfigService` (версия 2.8.0)
- Полная замена секций при обновлении (не deep merge)
- Роуты подключены ПЕРЕД middleware валидации `context-code`
- Используется `dbService.pgClient.query()` для работы с БД
- TypeScript интерфейсы для фронтенда включены в документацию
- React Hook и Vue 3 Composable примеры в документации

### ✅ Тестирование

Все 9 тестовых сценариев успешно пройдены:
1. ✅ Получение текущей конфигурации
2. ✅ Обновление с комментарием
3. ✅ Получение истории
4. ✅ Получение конкретной версии
5. ✅ Создание нескольких версий
6. ✅ Восстановление из истории
7. ✅ Валидация невалидной конфигурации
8. ✅ Сброс к дефолтным значениям
9. ✅ Проверка финальной истории

### 🔗 Связанные изменения

- Переименован старый эндпоинт `/api/config` в `/api/ui-config` в `server.js` (избежание конфликта)
- Добавлен импорт `promptsConfigService` в `routes/api.js`
- Создан отдельный файл `routes/promptsConfig.js` для изоляции маршрутов

---

## [2.8.0] - 2026-02-08

### ✨ Добавлено

#### App Config API - Управление глобальной конфигурацией приложения
- **GET /api/config** - получить текущую конфигурацию из config.json
- **PATCH /api/config** - частично обновить конфигурацию (можно передать только изменяемые поля)
- **POST /api/config/reset** - сбросить конфигурацию к значениям по умолчанию

#### Валидация конфигурации
- ✅ `KOSMOS_BASE_URL` - проверка формата URL
- ✅ `LOG_LEVEL` - enum валидация (debug, info, warn, error)
- ✅ `KOSMOS_MODEL` - строковая валидация (TODO: согласовать список моделей с kosmos-model)
- ✅ `KOSMOS_LOGIC_ARHITECT_MODEL` - строковая валидация (TODO: согласовать список моделей с kosmos-model)
- ✅ Числовые параметры - проверка диапазонов (0-1, 1-100)

#### Новые файлы
- `packages/core/appConfigService.js` - сервис для работы с config.json
- `tests/test_app_config.js` - тестовый скрипт для проверки App Config API
- `KB/README_APP_CONFIG_API.md` - документация по Backend API
- `docs/README_Frontend_Config_Integration.md` - руководство для фронтенд-разработчиков

#### OpenAPI Contract обновления
- Обновлена версия контракта до 2.8.0
- Добавлены схемы: `AppConfig`, `AppConfigResponse`, `AppConfigUpdateRequest`, `AppConfigUpdateResponse`, `AppConfigValidationError`
- Добавлены пути в `docs/openapi/paths/system.yaml`
- Обновлён главный контракт `docs/api-contract.yaml`

#### Документация
- Обновлён `README.md` - добавлены ссылки на новую документацию
- Обновлён `KB/README_REST.md` - добавлена секция с новыми endpoints
- Создан `CHANGELOG.md` - история изменений проекта

### 📋 Особенности

- **Не требует `context-code`** - настройки глобальные для всего приложения
- **Без автоматической перезагрузки** - изменения сохраняются в config.json, но не требуют перезапуска сервера (конфиг читается динамически)
- **Открытый endpoint** - нет авторизации/аутентификации (для локальной разработки)
- **Без истории изменений** - не сохраняются бэкапы или история изменений конфига

### 🔧 Технические детали

- Сервис реализован по аналогии с `kbConfigService`
- Частичное обновление через PATCH - можно менять только нужные поля
- Детальные сообщения об ошибках валидации
- Маршруты добавлены ДО middleware валидации context-code (строки до 123 в routes/api.js)

---

## [2.7.1] - 2026-02-07

### ✨ Добавлено
- **GET /api/file-content** - безопасное получение содержимого файлов для просмотра
- Защита от path traversal атак
- Ограничение размера файла 5 МБ
- Поддержка UTF-8 с обработкой ошибок для бинарных файлов

---

## [2.7.0] - 2026-02-06

### ✨ Добавлено

#### Advanced RAG API
- **POST /api/rag/retrieve** - получение структурированного контекста без LLM
- **POST /api/rag/ask** - RAG-ответы с настраиваемыми стратегиями поиска
- **POST /api/rag/compare-strategies** - сравнение эффективности стратегий
- **GET /api/rag/strategies** - список доступных RAG-стратегий

#### RAG стратегии
- Simple - базовый векторный поиск
- Hierarchical - многоуровневая иерархия чанков (L0/L1/L2)
- AI Item - поиск по полным AI Items с автоматической сборкой контекста
- Hybrid - комбинация нескольких стратегий

#### Форматирование контекста
- Compact - минимальный формат
- Standard - стандартный формат
- Full - полный формат с метаданными
- Markdown - форматирование в Markdown

### 🔄 Изменено
- Обновлён `/api/chat` для использования улучшенного RAG-движка
- Интеграция со связями (link table) для расширенного контекста

---

## [2.6.0] - 2026-02-05

### ✨ Добавлено

#### Column Extraction API
- **POST /api/items/{id}/extract-columns** - извлечение колонок таблиц из SQL-функций
- **POST /api/extract-all-columns** - пакетное извлечение колонок из всех SQL-функций
- Новый тип ai_item: `table_column` для представления колонок таблиц
- Новые типы связей: `reads_column`, `updates_column`, `inserts_column`
- Резолвинг полных имён колонок через загруженные таблицы

---

## [2.5.1] - 2026-02-04

### ✨ Добавлено
- **POST /api/ai-items/bulk/tags/add** - массовое добавление тегов
- **POST /api/ai-items/bulk/tags/remove** - массовое удаление тегов
- Поддержка bulk операций для эффективного управления тегами множества AiItems

---

## [2.4.1] - 2026-02-03

### ✨ Добавлено
- **POST /api/files/vectorize-chunk/{chunkId}** - векторизация конкретного чанка

---

## [2.4.0] - 2026-02-02

### ✨ Добавлено

#### Prompts API
- Полный CRUD для управления промптами LLM
- **GET /api/prompts** - получить все промпты
- **PATCH /api/prompts/{category}** - обновить промпты категории
- **GET /api/prompts/l1l2/{fileType}/{objectType}/{level}** - гранулярный доступ
- **GET /api/prompts/l1l2/{fileType}** - получить все промпты для типа файла
- **POST /api/prompts/reload** - перезагрузить промпты из файла
- **POST /api/prompts/validate** - валидация структуры промптов
- **GET /api/prompts/export** - экспорт в JSON/YAML
- **POST /api/prompts/import** - импорт из JSON/YAML

### 📋 Особенности
- Промпты хранятся глобально в prompts.json (файловая система)
- Изменения персистентны между перезапусками

---

## [2.3.0] - 2026-02-01

### ✨ Добавлено

#### Natural Query Engine
- **POST /api/v1/natural-query** - запросы на естественном языке с автогенерацией скриптов
- **GET /api/v1/natural-query/suggest** - подсказки похожих вопросов

#### Agent Scripts CRUD
- **GET /api/agent-scripts** - список всех скриптов
- **GET /api/agent-scripts/{id}** - получить скрипт по ID
- **PATCH /api/agent-scripts/{id}** - обновить скрипт
- **DELETE /api/agent-scripts/{id}** - удалить скрипт
- **POST /api/agent-scripts/{id}/embed** - векторизировать вопрос скрипта
- **POST /api/agent-scripts/{id}/execute** - выполнить скрипт

### 📋 Особенности
- FTS-поиск похожих вопросов для переиспользования скриптов
- Интеллектуальный анализ кодовой базы

---

## [2.2.0] - 2026-01-31

### ✨ Добавлено
- **GET /api/items/{id}/logic-graph** - получить граф логики функции
- **POST /api/items/{id}/logic-graph** - сохранить граф логики функции
- Интеграция с Logic Architect для визуализации потока управления функций

---

## [2.1.2] - 2026-01-30

### 🔄 Изменено
- Расширена поддержка языков: `language` теперь свободное поле (sql, csharp, rust и любые другие)
- Убрано жёсткое ограничение enum для гибкости
- Полная совместимость с предыдущими версиями

---

## Формат

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/),
и этот проект придерживается [Semantic Versioning](https://semver.org/lang/ru/).

### Типы изменений
- **✨ Добавлено** - новые функции
- **🔄 Изменено** - изменения существующей функциональности
- **❌ Удалено** - удалённая функциональность
- **🐛 Исправлено** - исправления ошибок
- **🔒 Безопасность** - исправления уязвимостей
- **📋 Особенности** - важные детали реализации
- **🔧 Технические детали** - под капотом
