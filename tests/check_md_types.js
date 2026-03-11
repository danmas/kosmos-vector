// Проверка типов AI Items для MD
const { Client } = require('pg');
require('dotenv').config();

const TEST_CONTEXT = 'TEST_MD';

async function checkTypes() {
  const pgClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'postgres',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || ''
  });

  try {
    await pgClient.connect();
    console.log('✓ Подключено к БД\n');

    // Проверка типов
    const typesQuery = await pgClient.query(
      'SELECT DISTINCT type, COUNT(*) as cnt FROM kosmos.ai_item WHERE context_code = $1 GROUP BY type',
      [TEST_CONTEXT]
    );
    
    console.log('Типы AI Items в контексте TEST_MD:');
    typesQuery.rows.forEach(row => {
      console.log(`  ${row.type}: ${row.cnt} шт`);
    });

    console.log('\nПримеры AI Items:');
    const itemsQuery = await pgClient.query(
      'SELECT id, full_name, type, h_name FROM kosmos.ai_item WHERE context_code = $1 LIMIT 10',
      [TEST_CONTEXT]
    );
    
    itemsQuery.rows.forEach(row => {
      console.log(`  [${row.type}] ${row.full_name}`);
    });

  } catch (error) {
    console.error('Ошибка:', error.message);
  } finally {
    await pgClient.end();
  }
}

checkTypes();
