/**
 * Тест для извлечения колонок таблиц из SQL-функций
 * Тестирует модуль routes/loaders/columnExtractor.js через API сервера
 * 
 * Запуск: node tests/test_column_extractor.js
 * Требует: запущенный сервер на порту 3200
 */

require('dotenv').config();
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');

const { parseColumnsFromSqlBody, resolveTableAliases } = require('../routes/loaders/columnExtractor');

// BASE_URL должен быть полным URL с протоколом и портом
let BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3200';
// Если URL не содержит протокол, добавляем http://
if (!BASE_URL.startsWith('http://') && !BASE_URL.startsWith('https://')) {
  BASE_URL = `http://${BASE_URL}`;
}
// Если URL не содержит порт, добавляем :3200
if (!BASE_URL.match(/:\d+$/)) {
  BASE_URL = `${BASE_URL}:3200`;
}
const TEST_CONTEXT = 'TEST_COLUMN_EXTRACTOR';

// Конфигурация БД из переменных окружения (.env)
const dbConfig = process.env.DATABASE_URL 
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT) || 5432,
        database: process.env.PGDATABASE || 'postgres',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres'
    };

// Тестовые данные
const testFunctionSQL = `
create or replace function carl_auct.getAuctLabels(p_id_auction int)
	returns setof json security definer as $$
declare
  _j_out json;
begin
	for _j_out in
		select row_to_json(r) from (
            select l.id_label, l.name, l.color_code, l.description
              from auction_label al, label l
              where l.id_label = al.id_label
              and al.id_auction = p_id_auction
            order by l.id_label
        ) r
	loop
		return next json_strip_nulls(_j_out);
	end loop;
end $$
language plpgsql;
`;

// Helper functions
async function apiCall(method, endpoint, body = null) {
  const url = `${BASE_URL}${endpoint}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(`API Error ${response.status}: ${data.error || JSON.stringify(data)}`);
  }
  
  return data;
}

async function getAiItems(contextCode) {
  return await apiCall('GET', `/api/items?context-code=${contextCode}`);
}

async function extractColumns(fullName, contextCode) {
  return await apiCall('POST', `/api/items/${encodeURIComponent(fullName)}/extract-columns?context-code=${contextCode}`);
}

async function runTest() {
  console.log('=== Тест извлечения колонок из SQL-функций ===\n');
  console.log(`Сервер: ${BASE_URL}`);
  console.log(`Контекст: ${TEST_CONTEXT}\n`);
  
  let pgClient;
  
  try {
    // 0. Подключение к БД для подготовки тестовых данных
    console.log('[Подготовка] Подключение к БД...');
    pgClient = new Client(dbConfig);
    await pgClient.connect();
    console.log('  ✓ Подключение к БД установлено\n');

    // 1. Тест парсинга алиасов (юнит-тест, без сервера)
    console.log('[Тест 1] Парсинг алиасов таблиц (юнит-тест)...');
    const aliasMap = resolveTableAliases(testFunctionSQL);
    console.log('  Алиасы:', aliasMap);
    assert(aliasMap['l'] === 'label', 'Алиас l должен указывать на label');
    assert(aliasMap['al'] === 'auction_label', 'Алиас al должен указывать на auction_label');
    console.log('  ✓ Парсинг алиасов работает корректно\n');
    
    // 2. Тест парсинга колонок (юнит-тест, без сервера)
    console.log('[Тест 2] Парсинг колонок из SELECT (юнит-тест)...');
    const parsedColumns = parseColumnsFromSqlBody(testFunctionSQL);
    console.log('  Найдено колонок:', parsedColumns.length);
    console.log('  Колонки:', parsedColumns.map(c => `${c.tableAlias || 'noalias'}.${c.column} (${c.operation})`));
    
    const expectedColumns = ['id_label', 'name', 'color_code', 'description'];
    const foundColumns = parsedColumns.filter(c => c.operation === 'select').map(c => c.column);
    for (const col of expectedColumns) {
      assert(foundColumns.includes(col), `Колонка ${col} должна быть найдена`);
    }
    console.log('  ✓ Парсинг колонок работает корректно\n');
    
    // 3. Подготовка: создаём тестовые таблицы в клиентской БД
    console.log('[Тест 3] Подготовка тестовых таблиц в клиентской БД...');
    try {
      // Проверяем, что link_type для колонок существуют
      const linkTypeCheck = await pgClient.query(
        `SELECT code FROM public.link_type WHERE code IN ('reads_column', 'updates_column', 'inserts_column')`
      );
      
      if (linkTypeCheck.rows.length < 3) {
        console.log('  ⚠ Добавляем отсутствующие link_type...');
        await pgClient.query(`
          INSERT INTO link_type (code, label, description) VALUES
            ('reads_column', 'reads_column', 'Function reads column in SELECT'),
            ('updates_column', 'updates_column', 'Function updates column in SET'),
            ('inserts_column', 'inserts_column', 'Function inserts into column')
          ON CONFLICT (code) DO NOTHING
        `);
      }
      console.log('  ✓ link_type проверены\n');
    } catch (err) {
      console.log('  ⚠ Ошибка подготовки link_type:', err.message, '\n');
    }
    
    // 4. Создаём тестовый SQL файл
    console.log('[Тест 4] Создание тестового SQL файла...');
    const testSqlDir = path.join(__dirname, 'test_data', 'sql');
    if (!fs.existsSync(testSqlDir)) {
      fs.mkdirSync(testSqlDir, { recursive: true });
    }
    const testSqlFile = path.join(testSqlDir, 'test_column_extractor_function.sql');
    fs.writeFileSync(testSqlFile, testFunctionSQL, 'utf8');
    console.log(`  ✓ Файл создан: ${testSqlFile}\n`);
    
    // 5. Проверяем здоровье сервера
    console.log('[Тест 5] Проверка здоровья сервера...');
    try {
      const healthRes = await fetch(`${BASE_URL}/api/health?context-code=${TEST_CONTEXT}`);
      if (!healthRes.ok) {
        throw new Error(`Сервер не отвечает: ${healthRes.status}`);
      }
      console.log('  ✓ Сервер доступен\n');
    } catch (err) {
      throw new Error(`Сервер недоступен на ${BASE_URL}: ${err.message}`);
    }
    
    // 6. Загружаем таблицы через pipeline step 1
    console.log('[Тест 6] Подготовка ai_item для таблиц...');
    // Создаём ai_item для таблиц напрямую в БД (так как loadTableSchema требует MCP)
    try {
      // Создаём виртуальный file
      const fileResult = await pgClient.query(
        `INSERT INTO public.files (id, filename, file_url, context_code, created_at, modified_at)
         VALUES (gen_random_uuid(), 'test_tables.ddl', 'test://test_tables.ddl', $1, now(), now())
         ON CONFLICT (id) DO UPDATE SET modified_at = now()
         RETURNING id`,
        [TEST_CONTEXT]
      );
      const fileId = fileResult.rows[0].id;
      
      // Создаём ai_item для таблицы label
      await pgClient.query(
        `INSERT INTO public.ai_item (full_name, context_code, type, s_name, file_id)
         VALUES ('carl_data.label', $1, 'table', 'label', $2)
         ON CONFLICT (full_name, context_code) DO UPDATE SET updated_at = now()`,
        [TEST_CONTEXT, fileId]
      );
      
      // Создаём chunk с колонками для таблицы label
      const labelColumns = [
        { column_name: 'id_label', data_type: 'integer', is_nullable: 'NO' },
        { column_name: 'name', data_type: 'text', is_nullable: 'YES' },
        { column_name: 'color_code', data_type: 'text', is_nullable: 'YES' },
        { column_name: 'description', data_type: 'text', is_nullable: 'YES' }
      ];
      
      const labelAiItemResult = await pgClient.query(
        `SELECT id FROM public.ai_item WHERE full_name = 'carl_data.label' AND context_code = $1`,
        [TEST_CONTEXT]
      );
      const labelAiItemId = labelAiItemResult.rows[0].id;
      
      await pgClient.query(
        `INSERT INTO public.chunk_vector (id, file_id, chunk_content, level, type, full_name, s_name, ai_item_id)
         VALUES (gen_random_uuid(), $1, $2, '0-исходник', 'table', 'carl_data.label', 'label', $3)
         ON CONFLICT DO NOTHING`,
        [fileId, JSON.stringify({ text: { full_name: 'carl_data.label', type: 'table', columns: labelColumns } }), labelAiItemId]
      );
      
      // Создаём ai_item для таблицы auction_label
      await pgClient.query(
        `INSERT INTO public.ai_item (full_name, context_code, type, s_name, file_id)
         VALUES ('carl_data.auction_label', $1, 'table', 'auction_label', $2)
         ON CONFLICT (full_name, context_code) DO UPDATE SET updated_at = now()`,
        [TEST_CONTEXT, fileId]
      );
      
      const auctionLabelColumns = [
        { column_name: 'id_auction', data_type: 'integer', is_nullable: 'YES' },
        { column_name: 'id_label', data_type: 'integer', is_nullable: 'YES' }
      ];
      
      const auctionLabelAiItemResult = await pgClient.query(
        `SELECT id FROM public.ai_item WHERE full_name = 'carl_data.auction_label' AND context_code = $1`,
        [TEST_CONTEXT]
      );
      const auctionLabelAiItemId = auctionLabelAiItemResult.rows[0].id;
      
      await pgClient.query(
        `INSERT INTO public.chunk_vector (id, file_id, chunk_content, level, type, full_name, s_name, ai_item_id)
         VALUES (gen_random_uuid(), $1, $2, '0-исходник', 'table', 'carl_data.auction_label', 'auction_label', $3)
         ON CONFLICT DO NOTHING`,
        [fileId, JSON.stringify({ text: { full_name: 'carl_data.auction_label', type: 'table', columns: auctionLabelColumns } }), auctionLabelAiItemId]
      );
      
      // Создаём ai_item для функции
      await pgClient.query(
        `INSERT INTO public.ai_item (full_name, context_code, type, s_name, file_id)
         VALUES ('carl_auct.getAuctLabels', $1, 'function', 'getAuctLabels', $2)
         ON CONFLICT (full_name, context_code) DO UPDATE SET updated_at = now()`,
        [TEST_CONTEXT, fileId]
      );
      
      const functionAiItemResult = await pgClient.query(
        `SELECT id FROM public.ai_item WHERE full_name = 'carl_auct.getAuctLabels' AND context_code = $1`,
        [TEST_CONTEXT]
      );
      const functionAiItemId = functionAiItemResult.rows[0].id;
      
      // Создаём chunk с телом функции
      const functionContent = {
        text: {
          full_name: 'carl_auct.getAuctLabels',
          s_name: 'getAuctLabels',
          signature: 'carl_auct.getAuctLabels(p_id_auction int)',
          body: testFunctionSQL
        }
      };
      
      await pgClient.query(
        `INSERT INTO public.chunk_vector (id, file_id, chunk_content, level, type, full_name, s_name, ai_item_id)
         VALUES (gen_random_uuid(), $1, $2, '0-исходник', 'function', 'carl_auct.getAuctLabels', 'getAuctLabels', $3)
         ON CONFLICT DO NOTHING`,
        [fileId, JSON.stringify(functionContent), functionAiItemId]
      );
      
      console.log('  ✓ Тестовые ai_item и chunks созданы\n');
    } catch (err) {
      throw new Error(`Ошибка подготовки тестовых данных: ${err.message}`);
    }
    
    // 7. Тест извлечения колонок через API
    console.log('[Тест 7] Извлечение колонок через API...');
    const extractResult = await extractColumns('carl_auct.getAuctLabels', TEST_CONTEXT);
    
    console.log('  Результаты извлечения:');
    console.log(`    Найдено колонок: ${extractResult.report.columnsFound}`);
    console.log(`    Резолвлено: ${extractResult.report.columnsResolved}`);
    console.log(`    Нерезолвлено: ${extractResult.report.columnsUnresolved}`);
    console.log(`    Создано связей: ${extractResult.report.linksCreated}`);
    
    if (extractResult.report.errors && extractResult.report.errors.length > 0) {
      console.log('  Ошибки:', extractResult.report.errors);
    }
    
    assert(extractResult.success, 'API должно вернуть success: true');
    assert(extractResult.report.columnsFound >= 4, 'Должно быть найдено минимум 4 колонки');
    console.log('  ✓ Извлечение колонок через API работает\n');
    
    // 8. Проверяем созданные ai_item для колонок
    console.log('[Тест 8] Проверка созданных ai_item для колонок...');
    const columnItemsResult = await pgClient.query(
      `SELECT full_name FROM public.ai_item 
       WHERE context_code = $1 AND type = 'table_column'`,
      [TEST_CONTEXT]
    );
    
    console.log(`  ✓ Создано ai_item для колонок: ${columnItemsResult.rows.length}`);
    console.log('  Колонки:', columnItemsResult.rows.map(r => r.full_name));
    
    assert(columnItemsResult.rows.length >= 4, 'Должно быть создано минимум 4 ai_item для колонок');
    
    // 9. Проверяем связи
    console.log('\n[Тест 9] Проверка созданных связей...');
    const linksResult = await pgClient.query(
      `SELECT lt.code, l.target 
       FROM public.link l
       JOIN public.link_type lt ON l.link_type_id = lt.id
       WHERE l.source = $1 AND l.context_code = $2 
       AND lt.code IN ('reads_column', 'updates_column', 'inserts_column')`,
      ['carl_auct.getAuctLabels', TEST_CONTEXT]
    );
    
    console.log(`  ✓ Создано связей: ${linksResult.rows.length}`);
    console.log('  Связи:', linksResult.rows.map(r => `${r.code} -> ${r.target}`));
    
    assert(linksResult.rows.length >= 4, 'Должно быть создано минимум 4 связи');
    
    console.log('\n========================================');
    console.log('✓ ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО!');
    console.log('========================================\n');
    
  } catch (error) {
    console.error('\n❌ Ошибка теста:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Очистка
    console.log('[Очистка] Удаление тестовых данных...');
    try {
      if (pgClient) {
        await pgClient.query(`DELETE FROM public.link WHERE context_code = $1`, [TEST_CONTEXT]);
        // chunk_vector не имеет context_code, удаляем через file_id
        await pgClient.query(`
          DELETE FROM public.chunk_vector 
          WHERE file_id IN (SELECT id FROM public.files WHERE context_code = $1)
        `, [TEST_CONTEXT]);
        await pgClient.query(`DELETE FROM public.ai_item WHERE context_code = $1`, [TEST_CONTEXT]);
        await pgClient.query(`DELETE FROM public.files WHERE context_code = $1`, [TEST_CONTEXT]);
        console.log('  ✓ Тестовые данные удалены\n');
      }
    } catch (err) {
      console.log('  ⚠ Ошибка очистки:', err.message);
    }
    
    // Удаляем тестовый файл
    const testSqlFile = path.join(__dirname, 'test_data', 'sql', 'test_column_extractor_function.sql');
    if (fs.existsSync(testSqlFile)) {
      fs.unlinkSync(testSqlFile);
    }
    
    if (pgClient) {
      await pgClient.end();
      console.log('✓ Соединение с БД закрыто');
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Запуск теста
if (require.main === module) {
  runTest().catch(error => {
    console.error('Критическая ошибка:', error);
    process.exit(1);
  });
}

module.exports = { runTest };
