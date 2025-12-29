# README_DB-VECTOR.md

## Обзор

`DbService.js` — сервис для работы с PostgreSQL + pgvector в проекте KOSMOS-VECTOR.  
Хранит файлы, чанки с эмбеддингами, структурированные AI-элементы (функции, классы, таблицы и т.д.), комментарии, связи и вспомогательные метаданные.

## Текущая схема базы данных (актуальна на 29.12.2025)

### Основные таблицы

#### `files`
Хранит загруженные файлы/документы.

| Поле         | Тип                            | Описание                                      |
|--------------|--------------------------------|-----------------------------------------------|
| id           | UUID PRIMARY KEY (default gen_random_uuid()) | Уникальный ID файла                          |
| context_code | TEXT NOT NULL (default 'UNKNOWN')         | Код контекста (проект/пространство имён)     |
| filename     | TEXT NOT NULL                             | Имя файла                                    |
| file_url     | TEXT NOT NULL                             | Путь/URL к файлу                             |
| content      | TEXT                                      | Полное содержимое (опционально)              |
| modified_at  | TIMESTAMP WITH TIME ZONE NOT NULL         | Время последнего изменения                   |
| created_at   | TIMESTAMP default now() NOT NULL          | Время создания                               |

#### `chunk_vector`
Основная таблица для чанков с векторами (все уровни: L0-код, L1-зависимости, L2-описание).

| Поле             | Тип                            | Описание                                                                 |
|------------------|--------------------------------|--------------------------------------------------------------------------|
| id               | UUID PRIMARY KEY (default gen_random_uuid()) | Уникальный ID чанка                                                    |
| file_id          | UUID NOT NULL → files (ON DELETE CASCADE)   | Ссылка на файл                                                         |
| embedding        | VECTOR(1536)                           | Вектор эмбеддинга                                                      |
| chunk_content    | JSONB NOT NULL                         | Содержимое чанка (обычно `{text: "...", comment?: "..."`)              |
| chunk_index      | INTEGER                                | Порядковый индекс в файле/уровне                                       |
| content          | JSONB                                  | Дополнительное содержимое (legacy/опционально)                         |
| type             | TEXT default 'текст'                   | Тип чанка                                                              |
| level            | TEXT default '0-исходник'              | Уровень иерархии (0-исходник, 1-зависимости, 2-описание и т.д.)        |
| parent_chunk_id  | UUID → chunk_vector (ON DELETE CASCADE)     | Родительский чанк (для L1/L2)                                          |
| s_name           | TEXT                                   | Короткое имя                                                           |
| h_name           | TEXT                                   | Иерархическое имя                                                      |
| full_name        | TEXT                                   | Полное имя (для L0 с сущностями)                                       |
| ai_item_id       | INTEGER → ai_item (ON DELETE SET NULL)      | Ссылка на связанный AI-элемент                                         |
| created_at       | TIMESTAMP default now() NOT NULL       | Время создания                                                         |
| updated_at       | TIMESTAMP WITH TIME ZONE default now() | Время обновления                                                       |

#### `ai_item`
Структурированные элементы кода (функции, классы, таблицы, процедуры и т.д.).

| Поле         | Тип                            | Описание                                      |
|--------------|--------------------------------|-----------------------------------------------|
| id           | SERIAL PRIMARY KEY             | Уникальный ID                                 |
| full_name    | TEXT NOT NULL                  | Полное имя элемента                           |
| context_code | TEXT default 'DEFAULT' NOT NULL| Код контекста                                 |
| created_at   | TIMESTAMP WITH TIME ZONE       | Время создания                                |
| updated_at   | TIMESTAMP WITH TIME ZONE       | Время обновления                              |
| type         | TEXT default 'текст'           | Тип элемента                                  |
| s_name       | TEXT                           | Короткое имя                                  |
| h_name       | TEXT                           | Иерархическое имя                             |
| file_id      | UUID NOT NULL → files (ON DELETE CASCADE) | Ссылка на файл                             |
| UNIQUE(full_name, context_code)               |                                               |

#### `ai_comment`
Комментарии/описания к AI-элементам (логическая связь по context_code + full_name).

| Поле         | Тип                            | Описание                                      |
|--------------|--------------------------------|-----------------------------------------------|
| id           | SERIAL PRIMARY KEY             |                                               |
| context_code | TEXT NOT NULL                  |                                               |
| full_name    | TEXT NOT NULL                  |                                               |
| comment      | TEXT                           | Текст комментария                             |
| created_at   | TIMESTAMP WITH TIME ZONE       |                                               |
| updated_at   | TIMESTAMP WITH TIME ZONE       |                                               |
| UNIQUE(context_code, full_name)               |                                               |

#### `link_type` и `link`
Граф зависимостей между AI-элементами.

- `link_type`: справочник типов связей (code, label, description, is_active).
- `link`: сами связи (context_code, source, target, link_type_id, опциональные ссылки на ai_item и file).

### Вспомогательные / legacy таблицы
(Возможно, не используются активно — проверь код на упоминания)

- `documents`, `documents384` — старые таблицы векторов (1536 и 384 dim).
- `file_info` — метаданные файлов (filename unique, context_code, file_hash, timestamps).
- `chunks_info` — счётчик чанков по file_id (ссылается на chunk_vector.id — выглядит ошибочно).
- `rag_documents` + `rag_chunks` — альтернативная RAG-структура.
- `tasks` — простые задачи с RLS по user_id.

## Индексы (ключевые)
- chunk_vector: по file_id, parent_chunk_id, ai_item_id, level, type, embedding (ivfflat cosine), created_at.
- ai_item: по context_code, full_name.
- files: по context_code.
- link: несколько композитных для быстрого поиска по context/source/target/type.

## Рекомендации
- Основной workflow идёт через `files` → `chunk_vector` → `ai_item`.
- Для новых фич используй только эти таблицы, legacy постепенно мигрируй или дропай.
- Если нужно добавить поля — делай миграции через DbService.initializeSchema() с ALTER TABLE IF NOT EXISTS.

🌌