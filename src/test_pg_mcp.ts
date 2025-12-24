// Загружаем переменные окружения
import "dotenv/config";
import { pgMcp } from "./pg-mcp";

const tables = await pgMcp.listTables("carl_data");
console.log(`tables:`);
console.log(tables); // ["users", "orders", "products", ...]


const schema = await pgMcp.getTableSchema("carl_data.users");
console.log(`schema:`); // полное описание столбцов
console.log(schema); // полное описание столбцов

if (tables.length > 0) {
    // const result = await pgMcp.executeQuery(`SELECT * FROM ${tables[0]} LIMIT 5`);
    console.log(`TEST`);
    const result = await pgMcp.executeQuery(`SELECT * FROM carl_data.users LIMIT 2`);
    console.log(`result.columns:`);
    console.log(result.columns);
    console.log(`result.rows:`);
    console.log(result.rows);
}

await pgMcp.closeClient();