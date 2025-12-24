# PostgreSQL MCP Client

Модуль для работы с PostgreSQL через Model Context Protocol (MCP). Предоставляет удобный интерфейс для выполнения SQL-запросов, получения списка таблиц и схем через MCP сервер.

## Назначение

Модуль `pg-mcp.ts` оборачивает MCP сервер PostgreSQL (`@modelcontextprotocol/server-postgres`) и предоставляет высокоуровневые функции для:
- Получения списка таблиц в схеме
- Получения схемы таблицы
- Выполнения произвольных SQL-запросов (только чтение)
- Управления подключением к MCP серверу

## Установка и настройка

### Зависимости

Модуль использует:
- `@modelcontextprotocol/sdk` — SDK для работы с MCP
- `@modelcontextprotocol/server-postgres` — MCP сервер для PostgreSQL (устанавливается автоматически через npx)

### Переменные окружения

Необходимо установить переменную окружения `POSTGRES_URL` с connection string:

```env
POSTGRES_URL=postgresql://user:password@host:port/database
```

Пример:
```env
POSTGRES_URL=postgresql://postgres:mypassword@localhost:5432/mydb
```

**Важно:** Модуль автоматически загружает переменные окружения через `dotenv/config` при импорте.

## API

### `pgMcp.listTables(schema: string): Promise<string[]>`

Возвращает список таблиц в указанной схеме базы данных.

**Параметры:**
- `schema` — имя схемы (например, `"public"`, `"carl_data"`)

**Возвращает:**
- Массив строк с именами таблиц

**Пример:**
```typescript
const tables = await pgMcp.listTables("carl_data");
console.log(tables); // ["users", "orders", "products", ...]
```

### `pgMcp.getTableSchema(tableNameWithSchema: string): Promise<string>`

Возвращает схему таблицы в текстовом формате.

**Параметры:**
- `tableNameWithSchema` — имя таблицы со схемой через точку (например, `"carl_data.users"`) или просто имя таблицы (по умолчанию используется схема `"public"`)

**Возвращает:**
- Строку с описанием колонок таблицы в формате:
  ```
  column_name data_type [NOT NULL] [DEFAULT value]
  ```

**Пример:**
```typescript
const schema = await pgMcp.getTableSchema("carl_data.users");
console.log(schema);
// id_user integer NOT NULL DEFAULT nextval('users_id_user_seq'::regclass)
// first_name character varying
// email character varying
// ...
```

### `pgMcp.executeQuery(sql: string): Promise<{columns: string[], rows: any[][], rawText?: string}>`

Выполняет SQL-запрос (только чтение) и возвращает результат в структурированном виде.

**Параметры:**
- `sql` — SQL-запрос для выполнения

**Возвращает:**
- Объект с полями:
  - `columns: string[]` — массив названий колонок
  - `rows: any[][]` — массив строк, где каждая строка — массив значений в порядке колонок
  - `rawText?: string` — необработанный текст ответа (если не удалось распарсить)

**Пример:**
```typescript
const result = await pgMcp.executeQuery("SELECT * FROM carl_data.users LIMIT 5");
console.log(result.columns); // ["id_user", "first_name", "email", ...]
console.log(result.rows);    // [[1038, "Tett", null, ...], [19, "Андрей", ...], ...]
```

### `pgMcp.listTools(): Promise<any[]>`

Возвращает список доступных инструментов MCP сервера.

**Возвращает:**
- Массив объектов с описанием инструментов

**Пример:**
```typescript
const tools = await pgMcp.listTools();
console.log(tools);
// [{ name: "query", description: "Run a read-only SQL query", ... }]
```

### `pgMcp.closeClient(): Promise<void>`

Закрывает подключение к MCP серверу. Рекомендуется вызывать в конце работы для освобождения ресурсов.

**Пример:**
```typescript
await pgMcp.closeClient();
```

## Примеры использования

### Базовый пример

```typescript
// Загружаем переменные окружения
import "dotenv/config";
import { pgMcp } from "./pg-mcp";

// Получаем список таблиц
const tables = await pgMcp.listTables("carl_data");
console.log("Таблицы:", tables);

// Получаем схему таблицы
const schema = await pgMcp.getTableSchema("carl_data.users");
console.log("Схема:", schema);

// Выполняем запрос
const result = await pgMcp.executeQuery("SELECT * FROM carl_data.users LIMIT 5");
console.log("Колонки:", result.columns);
console.log("Строки:", result.rows);

// Закрываем подключение
await pgMcp.closeClient();
```

### Работа с несколькими схемами

```typescript
import "dotenv/config";
import { pgMcp } from "./pg-mcp";

// Получаем таблицы из разных схем
const publicTables = await pgMcp.listTables("public");
const carlTables = await pgMcp.listTables("carl_data");

console.log("Public схема:", publicTables);
console.log("Carl_data схема:", carlTables);

// Получаем схемы таблиц
const userSchema = await pgMcp.getTableSchema("carl_data.users");
const orderSchema = await pgMcp.getTableSchema("public.orders");

await pgMcp.closeClient();
```

### Обработка результатов запросов

```typescript
import "dotenv/config";
import { pgMcp } from "./pg-mcp";

const result = await pgMcp.executeQuery(`
  SELECT id_user, first_name, last_name, email 
  FROM carl_data.users 
  WHERE status = 'CONFIRMED' 
  LIMIT 10
`);

// Преобразуем в массив объектов для удобства
const users = result.rows.map(row => {
  const user: any = {};
  result.columns.forEach((col, idx) => {
    user[col] = row[idx];
  });
  return user;
});

console.log("Пользователи:", users);
// [{ id_user: 19, first_name: "Андрей", last_name: "Дьячков", email: "..." }, ...]

await pgMcp.closeClient();
```

## Особенности работы

### Подключение к MCP серверу

- Подключение создается автоматически при первом вызове любой функции
- Используется единый клиент для всех запросов (singleton pattern)
- MCP сервер запускается через `npx` при первом подключении
- Connection string передается через переменную окружения `POSTGRES_URL`

### Обработка ответов

Модуль автоматически обрабатывает разные форматы ответов от MCP сервера:
- **Табличный формат** (`type: "table"`) — извлекает колонки и строки напрямую
- **JSON в тексте** (`type: "text"` с JSON) — парсит JSON и преобразует в табличный формат
- **Обычный текст** — возвращает как `rawText`

### Безопасность

- MCP сервер PostgreSQL поддерживает **только read-only запросы**
- Запросы на изменение данных (INSERT, UPDATE, DELETE) не выполняются
- SQL-инъекции частично защищены через параметризацию в MCP сервере, но рекомендуется валидировать входные данные

### Производительность

- Подключение к MCP серверу переиспользуется между запросами
- Каждый запрос создает новый процесс MCP сервера через `npx`, что может быть медленнее прямого подключения к PostgreSQL
- Рекомендуется использовать для разовых запросов или в сценариях, где важна изоляция

## Ограничения

1. **Только чтение** — модуль не поддерживает запросы на изменение данных
2. **Производительность** — запуск через `npx` добавляет накладные расходы
3. **Зависимость от окружения** — требует установленного Node.js/npx для запуска MCP сервера

## Интеграция с проектом

Модуль используется в проекте для:
- Исследования структуры базы данных
- Получения метаданных о таблицах и колонках
- Выполнения аналитических запросов через MCP протокол

## См. также

- [README_TECH.md](./README_TECH.md) — общая техническая документация проекта
- [README_DB.md](./README_DB.md) — документация по работе с базой данных
- [Model Context Protocol](https://modelcontextprotocol.io/) — официальная документация MCP

