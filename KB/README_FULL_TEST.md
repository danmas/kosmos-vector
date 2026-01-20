# FULL_TEST — Полный системный тест

## Обзор

Полный E2E тест системы Kosmos-Vector, проверяющий:
- Multi-root конфигурацию (несколько rootPath)
- Парсинг и загрузку файлов разных типов (JS, TS, PHP, SQL, DDL)
- Создание ai_items и chunk_vector
- Связи L1 в таблице link
- Logic Architect API (анализ логики функций через LLM)
- Natural Query API

## Структура тестовых данных

```
tests/
├── hr_test_project/              ← Root 1: JS, TS, SQL, DDL
│   ├── schema/
│   │   ├── hr_schema.sql         ← DDL: 6 таблиц (hr.*)
│   │   └── hr_functions.sql      ← 2 PL/pgSQL функции
│   └── src/
│       ├── employeeService.js    ← JS: класс, функции, arrow functions
│       ├── departmentService.ts  ← TS: интерфейсы, класс, generics
│       └── utils/
│           ├── validators.js     ← JS утилиты
│           └── formatters.ts     ← TS утилиты
│
└── hr_test_project_php/          ← Root 2: PHP (отдельный проект)
    └── src/
        └── SkillService.php      ← PHP: класс с методами
```

## Конфигурация (kb-configs/FULL_TEST.json)

```json
{
  "rootPath": "...\\hr_test_project,...\\hr_test_project_php",
  "includeMask": "**/*",
  "metadata": {
    "custom_settings": "
      js_loading:
        enabled: true
      ts_loading:
        enabled: true
      php_loading:
        enabled: true
      functions_loading:
        enabled: true
      ddl_loading:
        enabled: true
        files:
          - ./schema/hr_schema.sql
      table_loading:
        enabled: false
    "
  }
}
```

## Запуск теста

```bash
node tests/full_system_test.js
```

**Требования:**
- Сервер запущен на порту 3200
- `.env` содержит настройки БД (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD)
- LLM API ключ для Natural Query и Logic Architect

## Этапы теста

### 1. Cleanup
Удаление данных предыдущего запуска:
```sql
DELETE FROM chunk_vector WHERE context_code = 'FULL_TEST';
DELETE FROM ai_item WHERE context_code = 'FULL_TEST';
DELETE FROM link WHERE context_code = 'FULL_TEST';
DELETE FROM files WHERE context_code = 'FULL_TEST';
```

### 2. Step1 (Parsing + Loading)
- Сканирование файлов из обоих rootPath
- Парсинг AST для каждого типа файла
- Создание ai_item и chunk_vector записей
- Сохранение L1 связей в таблицу link

**API:** `POST /api/pipeline/step/1/run?context-code=FULL_TEST`

### 3. Step2 (L1 Fix)
- Резолвинг коротких имён в полные (schema.name)
- Обновление chunk_vector.chunk_content
- Обновление link.target

**API:** `POST /api/pipeline/step/2/run?context-code=FULL_TEST`

### 4. Проверки

#### Проверка 0: Multi-root
Файлы загружены из обоих rootPath:
- `hr_test_project` — JS, TS, DDL, SQL
- `hr_test_project_php` — PHP

#### Проверка 1: ai_items
- Ожидаемое количество: 28-36 записей
- DDL/SQL элементы (`hr.*`) имеют схему в full_name
- JS/TS функции могут быть без схемы (это нормально)

**Типы элементов:**
| Тип | Источник |
|-----|----------|
| table | DDL (hr_schema.sql) |
| function | SQL функции, JS/TS функции |
| class | JS/TS/PHP классы |
| method | Методы классов |
| interface | TS интерфейсы |

#### Проверка 2: L1 связи
- Минимум 5 связей в таблице link
- HR связи (`source LIKE 'hr.%'`) должны иметь схему в target
- JS/TS связи без схемы в target — ожидаемо

**Типы связей:**
| link_type | Описание |
|-----------|----------|
| calls | Вызов функции |
| reads_from | SELECT из таблицы |
| updates | UPDATE таблицы |
| inserts_into | INSERT в таблицу |
| imports | import/require |

#### Проверка 3: Natural Query
Тестовые запросы:
1. "Какие функции работают с таблицей employees?" → `get_department_employees`
2. "Какие классы есть в проекте?" → `EmployeeService`, `DepartmentService`
3. "Расскажи про HR схему базы данных" → `employees`, `departments`

## Ожидаемые результаты

```
================================================================================
                    ПОЛНЫЙ СИСТЕМНЫЙ ТЕСТ KOSMOS-VECTOR
================================================================================
...
Step1 (Parsing): ✅
Step2 (L1 Fix): ✅
Multi-root: ✅
Проверка ai_items: ✅
Проверка L1 связей: ✅
Natural Query тесты:
  1. ✅ "Какие функции работают с таблицей employees..."
  2. ✅ "Какие классы есть в проекте..."
  3. ✅ "Расскажи про HR схему базы данных..."

================================================================================
✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО
================================================================================
```

## Диагностика

### Проверка ai_items вручную
```sql
SELECT type, COUNT(*) 
FROM ai_item 
WHERE context_code = 'FULL_TEST' 
GROUP BY type;
```

### Проверка связей
```sql
SELECT lt.code, COUNT(*) 
FROM link l
JOIN link_type lt ON l.link_type_id = lt.id
WHERE l.context_code = 'FULL_TEST'
GROUP BY lt.code;
```

### Проверка файлов из разных rootPath
```sql
SELECT file_url, filename 
FROM files 
WHERE context_code = 'FULL_TEST';
```

### Проверка Logic Architect результатов
```sql
-- Получить все сохранённые анализы логики
SELECT ai.full_name, lg.logic, lg.graph
FROM logic_graph lg
JOIN ai_item ai ON lg.ai_item_id = ai.id
WHERE ai.context_code = 'FULL_TEST';
```

## Известные особенности

1. **JS/TS функции без схемы** — top-level функции сохраняются как `validateEmail`, а не `validators.validateEmail`. Это текущее поведение парсеров.

2. **Multi-root порядок** — файлы сканируются последовательно по каждому rootPath. Порядок в конфиге влияет на порядок обработки.

3. **DDL files** — для DDL загрузки нужно явно указать файлы в `custom_settings.ddl_loading.files` с путями относительно первого rootPath.
