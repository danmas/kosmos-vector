//  ./src/pg-mcp.js 
//
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Connection string в формате: postgresql://user:password@host:port/database
// Рекомендуется задавать через переменную окружения POSTGRES_URL
const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  throw new Error(
    "POSTGRES_URL is not set. Example: postgresql://user:pass@localhost:5432/mydb"
  );
}

let client: Client | null = null;

export async function getMcpClient(): Promise<Client> {
  if (client) return client;

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", POSTGRES_URL],
    env: { ...process.env },
  });

  client = new Client(
    { name: "bun-pg-mcp-agent", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}

export async function listTools() {
  const c = await getMcpClient();
  const result = await c.listTools();
  return result.tools;
}

export async function listTables(schema: string): Promise<string[]> {
  const c = await getMcpClient();

  const res = await c.callTool({
    name: "query",
    arguments: {
      sql: `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}' ORDER BY table_name`,
    },
  });

  if (!Array.isArray(res.content)) return [];

  // Ищем таблицу в ответе
  const tableContent = res.content.find((item: any) => item.type === "table");
  if (tableContent && tableContent.rows) {
    // Если первая колонка - это table_name, берем её значение
    const tableNameIndex = tableContent.columns.findIndex((col: any) => col.name === "table_name");
    if (tableNameIndex >= 0) {
      return tableContent.rows.map((row: any[]) => row[tableNameIndex]).filter(Boolean);
    }
    // Иначе берем первую колонку
    return tableContent.rows.map((row: any[]) => row[0]).filter(Boolean);
  }

  // Запасной вариант: парсим текст (может быть JSON)
  const rawText = res.content
    .filter((item: any) => item.type === "text")
    .map((item: any) => item.text)
    .join("\n");

  try {
    // Пытаемся распарсить как JSON
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      return parsed.map((item: any) => item.table_name || item).filter(Boolean);
    }
  } catch {
    // Не JSON, парсим как текст
  }

  return rawText.split("\n").map((line) => line.trim()).filter(Boolean);
}

export async function getTableSchema(tableNameWithSchema: string): Promise<string> {
  // Парсим схему и имя таблицы из строки вида "schema.table" или просто "table" (по умолчанию public)
  const parts = tableNameWithSchema.split('.');
  const schema = parts.length > 1 ? parts[0] : 'public';
  const tableName = parts.length > 1 ? parts[1] : parts[0];

  const c = await getMcpClient();

  const res = await c.callTool({
    name: "query",
    arguments: {
      sql: `SELECT column_name, data_type, is_nullable, column_default 
               FROM information_schema.columns 
               WHERE table_schema = '${schema}' AND table_name = '${tableName}' 
               ORDER BY ordinal_position`,
    },
  });

  if (!Array.isArray(res.content)) return "";

  // Ищем таблицу в ответе
  const tableContent = res.content.find((item: any) => item.type === "table");
  if (tableContent && tableContent.rows) {
    const columns = tableContent.columns.map((col: any) => col.name);
    return tableContent.rows
      .map((row: any[]) => {
        const obj: any = {};
        columns.forEach((col, idx) => {
          obj[col] = row[idx];
        });
        return obj;
      })
      .map((col: any) => `${col.column_name} ${col.data_type}${col.is_nullable === 'NO' ? ' NOT NULL' : ''}${col.column_default ? ` DEFAULT ${col.column_default}` : ''}`)
      .join("\n");
  }

  // Запасной вариант: возвращаем текст
  return res.content
    .filter((item: any) => item.type === "text")
    .map((item: any) => item.text)
    .join("\n");
}

export async function executeQuery(sql: string): Promise<{
  columns: string[];
  rows: any[][];
  rawText?: string;
}> {
  const c = await getMcpClient();

  const res = await c.callTool({
    name: "query",
    arguments: { sql: sql },
  });

  if (!Array.isArray(res.content)) {
    return { columns: [], rows: [], rawText: "" };
  }

  // Ищем часть с таблицей — обычно это объект с type: "table"
  const tableContent = res.content.find((item: any) => item.type === "table");

  if (tableContent) {
    return {
      columns: tableContent.columns.map((col: any) => col.name),
      rows: tableContent.rows,
    };
  }

  // Ищем текстовый контент с JSON
  const textContent = res.content
    .filter((item: any) => item.type === "text")
    .map((item: any) => item.text)
    .join("\n");

  if (textContent) {
    try {
      // Пытаемся распарсить JSON
      const jsonData = JSON.parse(textContent);
      
      // Если это массив объектов
      if (Array.isArray(jsonData) && jsonData.length > 0 && typeof jsonData[0] === "object") {
        // Извлекаем колонки из первого объекта
        const columns = Object.keys(jsonData[0]);
        // Преобразуем массив объектов в массив массивов значений
        const rows = jsonData.map((obj: any) => columns.map((col) => obj[col]));
        
        return {
          columns,
          rows,
        };
      }
      
      // Если это не массив объектов, возвращаем как есть
      return { columns: [], rows: [], rawText: textContent };
    } catch (e) {
      // Не JSON, возвращаем как текст
      return { columns: [], rows: [], rawText: textContent };
    }
  }

  return { columns: [], rows: [], rawText: "" };
}

export async function closeClient() {
  if (client) {
    await client.close();
    client = null;
  }
}

// Единый объект для импорта в агентах
export const pgMcp = {
  getMcpClient,
  listTools,
  listTables,
  getTableSchema,
  executeQuery,
  closeClient,
};
