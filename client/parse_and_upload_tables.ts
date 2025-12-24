/*

# Загрузка таблицы carl_data.queue в контекст CARL
bun client\parse_and_upload_tables.ts carl_data.queue -c CARL

# Загрузка таблицы carl_data.users в контекст CARL(по умолчанию)
bun client\parse_and_upload_tables.ts carl_data.users 

*/

import { parse } from "url";
import { pgMcp } from "../src/pg-mcp";

const BASE_URL = "http://localhost:3200";

if (!process.env.POSTGRES_URL) {
  console.error("Ошибка: POSTGRES_URL не задан в .env");
  process.exit(1);
}

const postgresUrl = new URL(process.env.POSTGRES_URL);
const host = postgresUrl.hostname || "localhost";
const port = postgresUrl.port || "5432";
const dbname = postgresUrl.pathname.slice(1); // убираем ведущий /
const virtualFilename = `from_db_${host}_${port}_${dbname}.ddl`;

async function apiPost(endpoint: string, body: any) {
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`Ошибка API ${endpoint}: ${response.status}`, data);
      return null;
    }

    return data;
  } catch (err: any) {
    console.error(`Сетевая ошибка ${endpoint}:`, err.message);
    return null;
  }
}

async function processTable(fullTableName: string) {
  console.log(`\nОбработка таблицы: ${fullTableName}`);

  // 1. Регистрация виртуального файла
  const registerRes = await apiPost("/register-file", {
    filename: virtualFilename,
    contextCode: "CARL",
  });

  if (!registerRes || !registerRes.fileId) {
    console.error(`Не удалось зарегистрировать виртуальный файл ${virtualFilename}`);
    return;
  }

  const fileId = registerRes.fileId;
  console.log(`Файл зарегистрирован: ${virtualFilename} (fileId = ${fileId})`);

  // 2. Получение схемы таблицы через MCP
  let schemaText: string;
  try {
    schemaText = await pgMcp.getTableSchema(fullTableName);
    if (!schemaText || schemaText.trim() === "") {
      console.error(`Пустая схема для таблицы ${fullTableName}`);
      return;
    }
  } catch (err: any) {
    console.error(`Ошибка получения схемы таблицы ${fullTableName}:`, err.message);
    return;
  }

  console.log(`Схема получена (${schemaText.split("\n").length} строк)`);

  // 3. Формирование DDL-approximation
  const lines = schemaText
    .split("\n")
    .map((line) => `  ${line.trimEnd()}`)
    .join("\n");

  const ddlApprox = `CREATE TABLE ${fullTableName} (\n${lines}\n);`;

  // 4. Разбор имени
  const parts = fullTableName.split(".");
  const schema = parts.length > 1 ? parts[0] : "public";
  const tableName = parts.length > 1 ? parts[1] : parts[0];

  // 5. Контент чанка
  const chunkContent = {
    full_name: fullTableName,
    type: "table",
    schema: schema,
    table_name: tableName,
    ddl_approx: ddlApprox,
    schema_text: schemaText.trim(),
  };

  // 6. Создание AI Item
  const aiItemRes = await apiPost("/create-or-update-ai-item", {
    full_name: fullTableName,
    contextCode: "CARL",
    type: "table",
    sName: tableName,
    fileId: fileId,
  });

  if (!aiItemRes || !aiItemRes.aiItem?.id) {
    console.error(`Не удалось создать AI Item для ${fullTableName}`);
    return;
  }

  const aiItemId = aiItemRes.aiItem.id;
  console.log(`AI Item создан/обновлён: ${fullTableName} (id = ${aiItemId})`);

  // 7. Сохранение чанка L0
  const chunkRes = await apiPost("/save-chunk", {
    fileId: fileId,
    content: chunkContent,
    chunkIndex: 0,
    level: "0-исходник",
    type: "table",
    full_name: fullTableName,
    s_name: tableName,
    aiItemId: aiItemId,
  });

  if (chunkRes && chunkRes.chunkId) {
    console.log(`Чанк уровня 0 сохранён: chunkId = ${chunkRes.chunkId}`);
  } else {
    console.error(`Не удалось сохранить чанк для ${fullTableName}`);
  }
}

(async () => {
  if (process.argv.length < 3) {
    console.error("Использование: bun parse_and_upload_tables.ts <schema.table_name>");
    console.error("Пример: bun parse_and_upload_tables.ts carl_data.users");
    process.exit(1);
  }

  const fullTableName = process.argv[2].trim();

  if (!/^[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+$/.test(fullTableName) && fullTableName.includes(".")) {
    console.warn("Рекомендуется указывать схему: schema.table_name");
  }

  try {
    await processTable(fullTableName);
    console.log("\nГотово! Таблица успешно загружена в AIAN Vector.");
  } finally {
    await pgMcp.closeClient();
  }
})();