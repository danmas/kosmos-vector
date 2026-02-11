# KB README Index - Оглавление базы знаний

**Назначение:** Навигация по документации проекта AIAN Vector (KOSMOS-VECTOR).

---

## Содержание

1. [Архитектура и технологии](#1-архитектура-и-технологии)
2. [База данных](#2-база-данных)
3. [API и интеграции](#3-api-и-интеграции)
4. [Загрузка и обработка файлов](#4-загрузка-и-обработка-файлов)
5. [AI Items и метаданные](#5-ai-items-и-метаданные)
6. [Тестирование](#6-тестирование)
7. [Утилиты и прочее](#7-утилиты-и-прочее)

---

## 1. Архитектура и технологии

| Файл | Описание | Ключевые темы | Актуализация |
|------|----------|---------------|--------------|
| [README_TECH.md](./README_TECH.md) | Техническая архитектура проекта | Express, PostgreSQL, pgvector, LangChain, микросервисы эмбеддингов, схема БД, переменные окружения | |
| [README_EMBEDDING.md](./README_EMBEDDING.md) | Система эмбеддингов и векторизации | EmbeddingsFactory, SimpleEmbeddings, OpenAIEmbeddings, процесс векторизации, поиск по векторам | |
| [README_Fun.md](./README_Fun.md) | Общее описание RAG-подхода | Что такое RAG, установка, структура проекта, веб-интерфейс | |

---

## 2. База данных

| Файл | Описание | Ключевые темы | Актуализация |
|------|----------|---------------|--------------|
| [README_DB-VECTOR.md](./README_DB-VECTOR.md) | Схема базы данных и DbService | Таблицы files, chunk_vector, ai_item, link_type/link, индексы | |
| [README_pg_mcp.md](./README_pg_mcp.md) | PostgreSQL MCP Client | Работа с PostgreSQL через Model Context Protocol, listTables, getTableSchema, executeQuery | |
| [README_clear_DB.md](./README_clear_DB.md) | Очистка базы данных | Эндпоинты /clear-database, /truncate-database, /cleanup-orphaned-ai-items | |
| [current_DB_schema.sql](./current_DB_schema.sql) | Текущая схема БД (SQL) | Полный DDL для создания всех таблиц и индексов | |

---

## 3. API и интеграции

| Файл | Описание | Ключевые темы | Актуализация |
|------|----------|---------------|--------------|
| [README_REST.md](./README_REST.md) | Полный REST API reference | Все эндпоинты API, RAG, векторизация, AI Items, чанки, файлы | |
| [README_APP_CONFIG_API.md](./README_APP_CONFIG_API.md) | Управление глобальной конфигурацией | GET/PATCH /api/config, валидация, сброс к дефолтам | |
| [README_PROMPTS_CONFIG_API.md](./README_PROMPTS_CONFIG_API.md) | Управление конфигурацией промптов | GET/PATCH /api/prompts-config, история изменений, версионирование | |
| [langchain-pg_README_REST.md](./langchain-pg_README_REST.md) | Дополнительная REST документация | Расширенное описание API endpoints | |

---

## 4. Загрузка и обработка файлов

| Файл | Описание | Ключевые темы | Актуализация |
|------|----------|---------------|--------------|
| [README_LOADING_FILES.md](./README_LOADING_FILES.md) | **Общая логика загрузки файлов** | Двухшаговый pipeline (Step1/Step2), kb-config, loaders, AI Items, L0/L1 чанки | 2026-02-11 |
| [README_MD_LOADING.md](./README_MD_LOADING.md) | Загрузка Markdown файлов | md_doc, H1/H2 структура, иерархические связи, md_includes, md_follows | |

### Подробнее: README_LOADING_FILES.md

Документ описывает архитектуру загрузки файлов:
- **Step 1** (`step1Runner.js`): Парсинг файлов, создание AI Items и L0-чанков
- **Step 2** (`step2Runner.js`): Исправление зависимостей, создание L1-чанков
- **Специализированные loaders:**
  - `sqlFunctionLoader.js` - PL/pgSQL функции
  - `jsFunctionLoader.js` - JavaScript
  - `tsFunctionLoader.js` - TypeScript
  - `phpFunctionLoader.js` - PHP
  - `mdLoader.js` - Markdown
  - `ddlSchemaLoader.js` - DDL схемы
  - `tableSchemaLoader.js` - Таблицы из БД
  - `columnExtractor.js` - Извлечение колонок из SQL функций

---

## 5. AI Items и метаданные

| Файл | Описание | Ключевые темы | Актуализация |
|------|----------|---------------|--------------|
| [README_AI_ITEM_COMPLETE.md](./README_AI_ITEM_COMPLETE.md) | Полное описание AI Item | Структура AI Item, L0/L1/L2 уровни, API endpoints, парсинг зависимостей | |
| [README_links.md](./README_links.md) | Связи L1 (граф зависимостей) | Таблица link, link_type, типы связей (calls, reads_from, updates), Column Extraction | |
| [README_TAGS.md](./README_TAGS.md) | Теги для AI Items | CRUD тегов, many-to-many связь ai_item_tag, классификация | |
| [README_UI_COMMENTS.md](./README_UI_COMMENTS.md) | Комментарии AI Items | GET/POST/PUT/DELETE /api/items/{id}/comment, интеграция с UI | |
| [README_IS_VECTORIZED.md](./README_IS_VECTORIZED.md) | Флаг векторизации | Поле isVectorized в API ответах, проверка наличия эмбеддингов | |
| [README_agent-script.md](./README_agent-script.md) | Natural Query Engine | Генерация JS-скриптов из вопросов на естественном языке, sandbox, поиск похожих вопросов | |

---

## 6. Тестирование

| Файл | Описание | Ключевые темы |
|------|----------|---------------|
| [README_FULL_TEST.md](./README_FULL_TEST.md) | Полный системный тест | E2E тестирование, multi-root конфигурация, все типы файлов, проверки |

---

## 7. Утилиты и прочее

| Файл | Описание | Ключевые темы | Актуализация |
|------|----------|---------------|--------------|
| [README_INDEX.md](./README_INDEX.md) | Этот файл | Оглавление всех README в KB | 2026-02-11 |

---

## Быстрый поиск по темам

### Начать изучение проекта
1. [README_TECH.md](./README_TECH.md) - общая архитектура
2. [README_DB-VECTOR.md](./README_DB-VECTOR.md) - структура БД
3. [README_REST.md](./README_REST.md) - API reference

### Работа с файлами и pipeline
1. [README_LOADING_FILES.md](./README_LOADING_FILES.md) - общая логика
2. [README_MD_LOADING.md](./README_MD_LOADING.md) - Markdown
3. [README_FULL_TEST.md](./README_FULL_TEST.md) - примеры тестирования

### AI Items и связи
1. [README_AI_ITEM_COMPLETE.md](./README_AI_ITEM_COMPLETE.md) - структура
2. [README_links.md](./README_links.md) - граф зависимостей
3. [README_TAGS.md](./README_TAGS.md) - тегирование
4. [README_UI_COMMENTS.md](./README_UI_COMMENTS.md) - комментарии

### Конфигурация
1. [README_APP_CONFIG_API.md](./README_APP_CONFIG_API.md) - глобальные настройки
2. [README_PROMPTS_CONFIG_API.md](./README_PROMPTS_CONFIG_API.md) - промпты LLM

### Интеграции
1. [README_EMBEDDING.md](./README_EMBEDDING.md) - эмбеддинги
2. [README_pg_mcp.md](./README_pg_mcp.md) - PostgreSQL MCP
3. [README_agent-script.md](./README_agent-script.md) - Natural Query

---

**Последнее обновление:** 11 февраля 2026
