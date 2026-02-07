# Загрузка Markdown файлов в AIAN Vector

## Обзор

Markdown файлы загружаются через kb-config pipeline с разбиением на иерархическую структуру:

- **md_doc** — пролог документа (до первого `#`)
- **head_level_1** — разделы первого уровня (`#`)
- **head_level_2** — подразделы (`##`)

## Модель данных

### AI Items

Для каждой секции создаётся `ai_item`:

| Тип | full_name формат | Описание |
|-----|------------------|----------|
| `md_doc` | `doc:{filename}` | Пролог документа |
| `head_level_1` | `doc:{filename}#H1:{slug}` | Раздел H1 |
| `head_level_2` | `doc:{filename}##H2:{h1_slug}.{h2_slug}` | Подраздел H2 |

### Chunk Vector (L0)

Для каждого AI Item создаётся L0-чанк с содержимым секции:

- `level = '0-исходник'`
- `type = 'markdown'`
- `md_level = 'doc' | 1 | 2`
- Содержимое **не пересекается** между чанками

### Связи (L1)

Создаются связи в таблице `link`:

#### Иерархические связи

- `md_doc` **md_includes** → `H1` (md_doc включает все H1)
- `H1` **md_included_in** → `md_doc` (H1 включён в md_doc)
- `H1` **md_includes** → `H2` (H1 включает свои H2)
- `H2` **md_included_in** → `H1` (H2 включён в H1)

#### Последовательные связи (только H2)

- `H2[i]` **md_follows** → `H2[i+1]` (следующий раздел)
- `H2[i+1]` **md_precedes** → `H2[i]` (предыдущий раздел)

## Настройка

### 1. Миграция БД

Выполните SQL-скрипт для добавления типов связей:

```bash
psql -U postgres -d your_db -f tmp/add_md_link_types.sql
```

### 2. Конфигурация kb-config

В `metadata.custom_settings` (YAML формат):

```yaml
md_loading:
  enabled: true
```

Пример полной конфигурации в `kb-configs/TEST_MD.json`.

### 3. Маска файлов

В `includeMask` добавьте `*.md`:

```json
{
  "includeMask": "**/*.{sql,js,ts,php,md}"
}
```

## Использование

### Через Pipeline

Запустите Step1 для вашего context-code:

```bash
POST /api/pipeline/run?context-code=MY_CONTEXT
```

MD файлы будут обработаны автоматически по настройкам kb-config.

### Что будет создано

Для файла `docs/guide.md`:

```markdown
# Introduction

Some intro text.

## Getting Started

First steps.

## Configuration

Setup guide.
```

Будет создано:

1. **AI Items (5 шт):**
   - `doc:guide.md` (md_doc)
   - `doc:guide.md#H1:introduction` (head_level_1)
   - `doc:guide.md##H2:introduction.getting_started` (head_level_2)
   - `doc:guide.md##H2:introduction.configuration` (head_level_2)

2. **Chunks (5 L0):**
   - По одному для каждого AI Item

3. **Links (8 связей):**
   - md_doc → H1 (includes/included_in)
   - H1 → H2 × 2 (includes/included_in)
   - H2[0] → H2[1] (follows/precedes)

## Поиск и навигация

### Семантический поиск

Обычный поиск по векторам найдёт релевантные H2-разделы:

```javascript
POST /api/ask
{
  "question": "Как настроить систему?"
}
```

Вернёт чанк `##H2:introduction.configuration`.

### Навигация по графу

Через API связей можно:

- Подняться от H2 к H1 (`md_included_in`)
- Спуститься от H1 ко всем H2 (`md_includes`)
- Пройти по соседним разделам (`md_follows`, `md_precedes`)

```javascript
GET /api/items/doc:guide.md%23%23H2:introduction.configuration?context-code=MY_CONTEXT
```

Вернёт AI Item с `l1_in` и `l1_out` связями.

## Ограничения

- Поддерживаются только `#` и `##` (H1 и H2)
- H3-H6 игнорируются (можно расширить при необходимости)
- Связи `md_follows`/`md_precedes` только между H2

## Тестирование

Тестовый файл: `tests/test_data/test_md_structure.md`

Тестовая конфигурация: `kb-configs/TEST_MD.json`

Для запуска:

1. Создайте контекст `TEST_MD`
2. Выполните миграцию `add_md_link_types.sql`
3. Запустите pipeline:
   ```bash
   POST /api/pipeline/run?context-code=TEST_MD
   ```
4. Проверьте результаты:
   ```bash
   GET /api/items?context-code=TEST_MD&type=md_doc
   GET /api/items?context-code=TEST_MD&type=head_level_1
   GET /api/items?context-code=TEST_MD&type=head_level_2
   ```

## Расширение

Для поддержки H3-H6:

1. Добавить обработку в `mdLoader.parseMdStructure()`
2. Создать соответствующие типы `head_level_3`, `head_level_4`, etc.
3. Добавить связи включения H2 → H3

---

Последнее обновление: 7 февраля 2026
