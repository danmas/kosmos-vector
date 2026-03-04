# SQL Order System E2E Test

## Описание

Полноценный end-to-end тест для проверки векторизации SQL объектов и генерации многоуровневых AI Items.

## Тестовая база данных

### Структура

Система управления заказами интернет-магазина:

**Таблицы:**
- `customers` - Клиенты с программой лояльности
- `products` - Каталог товаров
- `orders` - Заказы клиентов
- `order_items` - Позиции заказов

**Хранимые процедуры (5 шт.):**

1. **`apply_discount(customer_id, subtotal)`** - Независимая процедура
   - Вычисляет размер скидки на основе уровня лояльности клиента
   - Дополнительная скидка 5% при сумме > 1000
   - Не вызывает другие процедуры

2. **`calculate_order_total(order_id)`** - Процедура с зависимостью
   - Вычисляет итоговую сумму заказа
   - **Вызывает:** `apply_discount()`
   - Обновляет поля в таблице `orders`

3. **`create_order(customer_id, items_json)`** - Процедура верхнего уровня
   - Создает новый заказ с товарами
   - Проверяет остатки на складе
   - **Вызывает:** `calculate_order_total()`, которая вызывает `apply_discount()`
   - Обновляет таблицы `orders`, `order_items`, `products`

4. **`update_order_status(order_id, new_status)`** - Независимая процедура
   - Обновляет статус заказа
   - При завершении обновляет `total_spent` клиента и уровень лояльности
   - При отмене возвращает товары на склад
   - Не вызывает другие процедуры

5. **`get_customer_orders(customer_id, status)`** - Независимая процедура (только чтение)
   - Возвращает список заказов клиента
   - Опциональный фильтр по статусу
   - Не модифицирует данные, не вызывает другие процедуры

### Граф зависимостей

```
create_order()
    └─> calculate_order_total()
            └─> apply_discount()

update_order_status()  [независимая]

get_customer_orders()  [независимая, только чтение]
```

## Файлы теста

1. **`docs/test_order_system.sql`** - SQL скрипт с DDL и процедурами
2. **`docs/test_order_system_spec.md`** - Спецификация системы на русском
3. **`tests/test-sql-order-system.js`** - Тестовый скрипт

## Что проверяет тест

### ✅ Шаг 0: Очистка
- Удаление существующих тестовых файлов из БД

### ✅ Шаг 1: Векторизация
- SQL файл → создание AI Items для всех 5 процедур и 4 таблиц
- MD файл → создание AI Items для секций спецификации

### ✅ Шаг 2: Поиск AI Items
- Проверка автоматического создания AI Items
- Поиск процедур: `calculate_order_total`, `apply_discount`, `create_order`
- Поиск таблиц: `customers`
- Поиск секций MD спецификации

### ✅ Шаг 3: Custom режим генерации L1
- Передача пользовательских `prompt` и `inputText`
- Проверка `promptInfo.type === 'custom'`
- Проверка сохранения переданных значений

### ✅ Шаг 4: Automatic режим для SQL функций
- Генерация L1 без передачи промптов
- Проверка автоматического выбора шаблона `SQL_L1_FUNCTION_PROMPT`
- Проверка `promptInfo.type === 'auto'`

### ✅ Шаг 5: Automatic режим L2 для SQL функций
- Генерация L2 чанка
- Проверка шаблона `SQL_L2_FUNCTION_PROMPT`

### ✅ Шаг 6: Automatic режим для SQL таблиц
- Генерация L1 для таблицы `customers`
- Проверка шаблона `SQL_L1_TABLE_PROMPT`

### ✅ Шаг 7: Проверка L0 чанков
- L0 чанк содержит исходный SQL код процедуры
- Проверка наличия кода в `chunk_content`

### ✅ Шаг 8: Проверка иерархии чанков
- Каждый AI Item имеет L0, L1, L2 чанки
- Проверка связей через `parent_chunk_id`

### ✅ Шаг 9: Markdown AI Items
- Генерация L1 для секции спецификации
- Проверка шаблона `MD_L1_SECTION_PROMPT`

## Запуск теста

### Требования

1. Запущенный сервер:
```powershell
npm start
```

2. Настроенные переменные окружения в `.env`:
```env
SQL_L1_FUNCTION_PROMPT=...
SQL_L1_FUNCTION_INPUT_TEXT=...
SQL_L2_FUNCTION_PROMPT=...
SQL_L2_FUNCTION_INPUT_TEXT=...
SQL_L1_TABLE_PROMPT=...
SQL_L1_TABLE_INPUT_TEXT=...
SQL_L2_TABLE_PROMPT=...
SQL_L2_TABLE_INPUT_TEXT=...
MD_L1_SECTION_PROMPT=...
MD_L1_SECTION_INPUT_TEXT=...
MD_L2_SECTION_PROMPT=...
MD_L2_SECTION_INPUT_TEXT=...
```

Все необходимые переменные есть в `env.template`.

### Команда запуска

```powershell
npm run test:sql-order-system
```

Или напрямую:

```powershell
node tests/test-sql-order-system.js
```

## Ожидаемый результат

При успешном прохождении теста вы увидите:

```
======================================================================
  STARTING SQL ORDER SYSTEM E2E TEST
======================================================================

--- Step 0: Cleanup existing test data ---
✓ Deleted existing file: docs/test_order_system.sql
✓ Deleted existing file: docs/test_order_system_spec.md

--- Step 1: Vectorize SQL and MD files ---
✓ SQL file vectorized: 9 chunks created
✓ MD file vectorized: 5 chunks created

--- Step 2: Find AI Items for stored procedures ---
✓ Found AI Item: "public.calculate_order_total(p_order_id integer)" (ID: 123, type: function)
✓ Found AI Item: "public.apply_discount(p_customer_id integer, p_subtotal numeric)" (ID: 124, type: function)
✓ Found AI Item: "public.create_order(p_customer_id integer, p_items jsonb)" (ID: 125, type: function)
✓ Found AI Item: "calculate_order_total" (ID: 126, type: markdown)
✓ All required AI Items found

======================================================================
--- Step 3: Testing CUSTOM prompt mode for L1 generation ---
======================================================================
✓ Successfully generated Level 1 chunk
✅ [SUCCESS] Custom L1 chunk generated correctly

======================================================================
--- Step 4: Testing AUTOMATIC prompt mode for SQL function ---
======================================================================
✓ Successfully generated Level 1 chunk
✅ [SUCCESS] Automatic L1 chunk for SQL function generated correctly
   Template used: SQL_L1_FUNCTION_PROMPT

======================================================================
--- Step 5: Testing AUTOMATIC L2 generation for SQL function ---
======================================================================
✓ Successfully generated Level 2 chunk
✅ [SUCCESS] Automatic L2 chunk generated correctly
   Template used: SQL_L2_FUNCTION_PROMPT

======================================================================
--- Step 6: Testing AI Items for SQL tables ---
======================================================================
✓ Successfully generated Level 1 chunk
✅ [SUCCESS] Table L1 chunk generated correctly
   Template used: SQL_L1_TABLE_PROMPT

======================================================================
--- Step 7: Verify L0 chunks contain source code ---
======================================================================
✅ [SUCCESS] L0 chunk verified
   Content length: 1234 characters
   Preview: CREATE OR REPLACE FUNCTION public.calculate_order_total(...

======================================================================
--- Step 8: Verify chunk hierarchy ---
======================================================================
AI Item "public.apply_discount(p_customer_id integer, p_subtotal numeric)":
  L0 chunks: 1
  L1 chunks: 1
  L2 chunks: 0

AI Item "public.create_order(p_customer_id integer, p_items jsonb)":
  L0 chunks: 1
  L1 chunks: 0
  L2 chunks: 1
✅ [SUCCESS] Chunk hierarchy verified

======================================================================
--- Step 9: Testing Markdown specification AI Item ---
======================================================================
✓ Successfully generated Level 1 chunk
✅ [SUCCESS] Markdown L1 chunk generated correctly
   Template used: MD_L1_SECTION_PROMPT

======================================================================
  TEST SUMMARY
======================================================================
✅ SQL file vectorization: PASSED
✅ MD file vectorization: PASSED
✅ AI Items auto-creation: PASSED
✅ Custom prompt mode: PASSED
✅ Auto prompt mode (SQL function): PASSED
✅ Auto prompt mode (SQL table): PASSED
✅ Auto prompt mode (Markdown): PASSED
✅ L0/L1/L2 chunk hierarchy: PASSED
✅ Template selection: PASSED
======================================================================

🎉 ALL TESTS PASSED! 🎉
```

## Отладка

При ошибках тест выводит детальную информацию:

- Список всех найденных AI Items
- Типы AI Items
- Используемые шаблоны
- Содержимое чанков
- Stack trace ошибок

## Особенности SQL векторизации

### Автоматическое извлечение имен

Для SQL объектов система автоматически извлекает:

- **full_name**: полное имя с схемой и сигнатурой
  - Пример: `public.calculate_order_total(p_order_id integer)`
  
- **s_name**: короткое имя без схемы
  - Пример: `calculate_order_total`

- **h_name**: человеко-читаемое имя (совпадает с s_name для процедур)

### Типы SQL объектов

Поддерживаются следующие типы:
- `function` - функции и процедуры
- `table` - таблицы
- `view` - представления
- `materialized_view` - материализованные представления
- `trigger` - триггеры
- `index` - индексы
- `sequence` - последовательности
- `type` - пользовательские типы
- `domain` - домены

### Нормализация типов для шаблонов

При выборе шаблонов промптов происходит нормализация:

- `function`, `procedure` → используют `SQL_L*_FUNCTION_*` шаблоны
- `table`, `type`, `domain`, `sequence` → используют `SQL_L*_TABLE_*` шаблоны
- `view` → используют `SQL_L*_VIEW_*` шаблоны (если настроены)

## Сравнение с тестом ShoppingCart

| Аспект | ShoppingCart (JS+MD) | Order System (SQL+MD) |
|--------|---------------------|----------------------|
| Язык кода | JavaScript | SQL |
| Количество объектов | 1 функция | 5 процедур + 4 таблицы |
| Зависимости | Нет | Есть (3 уровня вызовов) |
| Тестируемые шаблоны | JS_L*, MD_L* | SQL_L*, MD_L* |
| Сложность кода | Простая | Средняя |
| Типы AI Items | function, markdown | function, table, markdown |

## Дальнейшие улучшения

Возможные расширения теста:

1. Добавить проверку VIEW и MATERIALIZED VIEW
2. Добавить проверку TRIGGER
3. Проверить генерацию для INDEX и SEQUENCE
4. Тестировать различные схемы БД (не только public)
5. Проверить обработку ошибок (несуществующие AI Items)
6. Добавить тесты производительности для больших SQL файлов
7. Проверить корректность извлечения сложных сигнатур функций

## Используемые технологии

- **Node.js** - исполнение тестов
- **node-fetch** - HTTP запросы к API
- **assert** - проверка утверждений
- **PostgreSQL** - хранение векторов и метаданных
- **LangChain** - векторизация и поиск

## Связанные файлы

- `tests/test-epample-ShoppingCart.js` - аналогичный тест для JS
- `routes/ai.js` - API для генерации L1/L2 чанков
- `packages/core/textSplitters.js` - логика разбиения SQL
- `KB/README_AI_ITEM_STATUS.md` - документация по статусу реализации

