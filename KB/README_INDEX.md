# 📚 Индекс документации Knowledge Base

Полный справочник по документации проекта AIAN Vector (kosmos-vector).

Последнее обновление: 2026-02-08  
Версия API: 2.8.0

---

## 🎯 Быстрый старт

Если вы новичок в проекте, начните с этих документов:

1. **[../README.md](../README.md)** - главный README проекта
2. **[README_TECH.md](README_TECH.md)** - техническая архитектура
3. **[README_REST.md](README_REST.md)** - REST API endpoints
4. **[../CHANGELOG.md](../CHANGELOG.md)** - история изменений

---

## 📂 Структура документации

### 🔧 Для Backend разработчиков

| Документ | Описание |
|----------|----------|
| **[README_REST.md](README_REST.md)** | REST API endpoints (версия 2.8.0) |
| **[README_APP_CONFIG_API.md](README_APP_CONFIG_API.md)** ⭐ НОВОЕ | App Config API - управление настройками |
| **[README_TECH.md](README_TECH.md)** | Техническая архитектура и детали |
| **[README_DB-VECTOR.md](README_DB-VECTOR.md)** | Работа с PostgreSQL и pgvector |
| **[README_EMBEDDING.md](README_EMBEDDING.md)** | Embeddings и векторизация |
| **[README_AI_ITEM_COMPLETE.md](README_AI_ITEM_COMPLETE.md)** | Полное руководство по AI Items |
| **[README_links.md](README_links.md)** | Система связей (L1 links) |
| **[current_DB_schema.sql](current_DB_schema.sql)** | Актуальная схема БД |

### 🎨 Для Frontend разработчиков

| Документ | Описание |
|----------|----------|
| **[../docs/README_Frontend_Config_Integration.md](../docs/README_Frontend_Config_Integration.md)** ⭐ НОВОЕ | Интеграция App Config API |
| **[../docs/README_Frontend_RAG_Integration.md](../docs/README_Frontend_RAG_Integration.md)** | Интеграция RAG API |
| **[../docs/api-contract.yaml](../docs/api-contract.yaml)** | OpenAPI спецификация (v2.8.0) |
| **[README_REST.md](README_REST.md)** | REST API endpoints |
| **[README_UI_COMMENTS.md](README_UI_COMMENTS.md)** | UI для комментариев AI Items |

### 🧪 Для QA и тестирования

| Документ | Описание |
|----------|----------|
| **[../tests/README_TESTS.md](../tests/README_TESTS.md)** | Руководство по тестированию |
| **[README_FULL_TEST.md](README_FULL_TEST.md)** | Полный системный тест |
| **[../tests/test_app_config.js](../tests/test_app_config.js)** ⭐ НОВОЕ | Тест App Config API |

### 🚀 Функциональные модули

| Документ | Описание |
|----------|----------|
| **[README_Natural_query.md](README_Natural_query.md)** | Natural Query Engine - запросы на естественном языке |
| **[README_agent-script.md](README_agent-script.md)** | Agent Scripts - кэширование скриптов |
| **[README_TAGS.md](README_TAGS.md)** | Система тегов для AI Items |
| **[README_IS_VECTORIZED.md](README_IS_VECTORIZED.md)** | Флаг векторизации |
| **[README_MD_LOADING.md](README_MD_LOADING.md)** | Загрузка Markdown файлов |

### 🛠️ Утилиты и инструменты

| Документ | Описание |
|----------|----------|
| **[README_pg_mcp.md](README_pg_mcp.md)** | PostgreSQL MCP server |
| **[README_clear_DB.md](README_clear_DB.md)** | Очистка базы данных |
| **[README_Fun.md](README_Fun.md)** | Развлекательный контент |

### 📖 Legacy документация

| Документ | Описание |
|----------|----------|
| **[langchain-pg_README_REST.md](langchain-pg_README_REST.md)** | Старая версия REST API (для справки) |

---

## 🆕 Новое в версии 2.8.0

### App Config API
Добавлен новый функционал для управления глобальной конфигурацией приложения через REST API.

**Документация:**
- Backend: [README_APP_CONFIG_API.md](README_APP_CONFIG_API.md)
- Frontend: [../docs/README_Frontend_Config_Integration.md](../docs/README_Frontend_Config_Integration.md)
- Тест: [../tests/test_app_config.js](../tests/test_app_config.js)

**Endpoints:**
- `GET /api/config` - получить конфигурацию
- `PATCH /api/config` - обновить конфигурацию
- `POST /api/config/reset` - сбросить к умолчаниям

**Особенности:**
- ✅ Не требует `context-code`
- ✅ Валидация: URL формат, LOG_LEVEL enum
- ✅ Частичное обновление (PATCH)
- ✅ Без перезагрузки сервера

---

## 📝 Стандарты документации

### Структура README файлов

Каждый README файл в KB следует стандартной структуре:

1. **Заголовок** - краткое название функционала
2. **Обзор** - что это и зачем нужно
3. **API Endpoints** (если применимо) - список методов с примерами
4. **Примеры использования** - код и curl команды
5. **Схема данных** - TypeScript интерфейсы или JSON примеры
6. **Связанные документы** - ссылки на другие README

### Соглашения о именовании

- `README_<FEATURE>.md` - описание функционала
- `README_<MODULE>_<SUBMODULE>.md` - описание подмодуля
- Все заголовки в CamelCase
- Русский язык для основного контента
- Английский для кода и технических терминов

---

## 🔗 Внешние ресурсы

### OpenAPI / Swagger
- **Контракт:** [docs/api-contract.yaml](../docs/api-contract.yaml)
- **Schemas:** [docs/openapi/schemas/](../docs/openapi/schemas/)
- **Paths:** [docs/openapi/paths/](../docs/openapi/paths/)
- **Responses:** [docs/openapi/responses/](../docs/openapi/responses/)

### База данных
- **Схема:** [current_DB_schema.sql](current_DB_schema.sql)
- **Миграции:** Нет автоматических миграций, схема обновляется вручную

### Тесты
- **Директория тестов:** [../tests/](../tests/)
- **Тестовые данные:** [../tests/test_data/](../tests/test_data/)

---

## 🗺️ Карта зависимостей документов

```
README.md (главный)
├── CHANGELOG.md (история)
├── KB/
│   ├── README_REST.md (API справка)
│   │   └── README_APP_CONFIG_API.md ⭐
│   ├── README_TECH.md (архитектура)
│   │   ├── README_DB-VECTOR.md
│   │   ├── README_EMBEDDING.md
│   │   └── README_AI_ITEM_COMPLETE.md
│   ├── README_Natural_query.md
│   │   └── README_agent-script.md
│   └── README_TAGS.md
├── docs/
│   ├── api-contract.yaml (OpenAPI)
│   ├── README_Frontend_RAG_Integration.md
│   └── README_Frontend_Config_Integration.md ⭐
└── tests/
    ├── README_TESTS.md
    └── test_app_config.js ⭐
```

---

## 🔍 Поиск по документации

### По функционалу

- **API endpoints** → [README_REST.md](README_REST.md)
- **Конфигурация** → [README_APP_CONFIG_API.md](README_APP_CONFIG_API.md) ⭐
- **AI Items** → [README_AI_ITEM_COMPLETE.md](README_AI_ITEM_COMPLETE.md)
- **Теги** → [README_TAGS.md](README_TAGS.md)
- **Natural Query** → [README_Natural_query.md](README_Natural_query.md)
- **Векторизация** → [README_EMBEDDING.md](README_EMBEDDING.md)
- **База данных** → [README_DB-VECTOR.md](README_DB-VECTOR.md)

### По технологиям

- **PostgreSQL** → [README_DB-VECTOR.md](README_DB-VECTOR.md)
- **pgvector** → [README_EMBEDDING.md](README_EMBEDDING.md)
- **Express.js** → [README_TECH.md](README_TECH.md)
- **OpenAPI** → [../docs/api-contract.yaml](../docs/api-contract.yaml)
- **MCP** → [README_pg_mcp.md](README_pg_mcp.md)

### По задачам

- **Настроить проект** → [../README.md](../README.md)
- **Добавить новый endpoint** → [README_REST.md](README_REST.md)
- **Изменить схему БД** → [current_DB_schema.sql](current_DB_schema.sql)
- **Написать тест** → [../tests/README_TESTS.md](../tests/README_TESTS.md)
- **Интегрировать фронтенд** → [../docs/README_Frontend_Config_Integration.md](../docs/README_Frontend_Config_Integration.md)

---

## 📊 Статистика документации

- **Всего README файлов в KB:** 19
- **Документов для фронтенда:** 3
- **Тестовых скриптов:** 30+
- **OpenAPI endpoints:** 100+
- **Строк SQL схемы:** ~3500

---

## 🤝 Контрибьюция

При создании новой документации:

1. Следуйте структуре существующих README
2. Добавьте ссылку в этот индекс
3. Обновите главный [README.md](../README.md)
4. Добавьте запись в [CHANGELOG.md](../CHANGELOG.md)
5. Обновите [OpenAPI contract](../docs/api-contract.yaml) если добавляете API

---

## 📧 Поддержка

Если вы не нашли нужную информацию:

1. Проверьте [CHANGELOG.md](../CHANGELOG.md) - возможно, функция новая
2. Посмотрите [OpenAPI contract](../docs/api-contract.yaml) - актуальная спецификация API
3. Изучите код в [packages/core/](../packages/core/) - бизнес-логика
4. Проверьте тесты в [tests/](../tests/) - примеры использования

---

**Последнее обновление:** 2026-02-08  
**Версия документации:** 2.8.0  
**Статус:** ✅ Актуально
