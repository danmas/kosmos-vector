// Прямой тест MD загрузчика без pipeline API
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

const DbService = require('../packages/core/DbService');
const { loadMarkdownFromFile } = require('../routes/loaders/mdLoader');

const TEST_CONTEXT = 'TEST_MD';
const TEST_FILE = path.join(__dirname, 'test_data', 'test_md_structure.md');

async function testMdLoaderDirect() {
  console.log('=== ПРЯМОЙ ТЕСТ MD ЗАГРУЗЧИКА ===\n');
  
  const pgClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'postgres',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || ''
  });

  try {
    // Подключение к БД
    console.log('[Шаг 1] Подключение к PostgreSQL...');
    await pgClient.connect();
    console.log('✓ Подключено к БД\n');

    // Инициализация DbService
    const dbService = new DbService(pgClient);
    await dbService.initializeSchema();
    console.log('✓ Схема БД инициализирована\n');

    // Проверка файла
    console.log('[Шаг 2] Проверка тестового файла...');
    const fs = require('fs');
    if (!fs.existsSync(TEST_FILE)) {
      throw new Error(`Тестовый файл не найден: ${TEST_FILE}`);
    }
    console.log(`✓ Файл найден: ${TEST_FILE}\n`);

    // Загрузка MD файла
    console.log('[Шаг 3] Загрузка MD файла...');
    const report = await loadMarkdownFromFile(TEST_FILE, TEST_CONTEXT, dbService, null);
    
    console.log('\n=== РЕЗУЛЬТАТ ЗАГРУЗКИ ===');
    console.log(`Файл: ${report.filename}`);
    console.log(`File ID: ${report.fileId}`);
    console.log(`Новый файл: ${report.isNew}`);
    console.log(`Найдено секций: ${report.sectionsFound}`);
    console.log(`Обработано секций: ${report.sectionsProcessed}`);
    console.log(`Ошибок: ${report.errors.length}\n`);

    if (report.errors.length > 0) {
      console.log('Ошибки:');
      report.errors.forEach(err => console.log(`  - ${err}`));
      console.log();
    }

    // Проверка AI Items
    console.log('[Шаг 4] Проверка созданных AI Items...\n');
    
    const mdDocQuery = await pgClient.query(
      'SELECT id, full_name, type, s_name, h_name FROM public.ai_item WHERE context_code = $1 AND type = $2',
      [TEST_CONTEXT, 'md_doc']
    );
    console.log(`✓ md_doc элементов: ${mdDocQuery.rows.length}`);
    mdDocQuery.rows.forEach(row => {
      console.log(`  - ${row.full_name}`);
    });

    const h1Query = await pgClient.query(
      'SELECT id, full_name, type, s_name, h_name FROM public.ai_item WHERE context_code = $1 AND type = $2',
      [TEST_CONTEXT, 'head_level_1']
    );
    console.log(`\n✓ head_level_1 элементов: ${h1Query.rows.length}`);
    h1Query.rows.forEach(row => {
      console.log(`  - ${row.full_name} (${row.h_name})`);
    });

    const h2Query = await pgClient.query(
      'SELECT id, full_name, type, s_name, h_name FROM public.ai_item WHERE context_code = $1 AND type = $2',
      [TEST_CONTEXT, 'head_level_2']
    );
    console.log(`\n✓ head_level_2 элементов: ${h2Query.rows.length}`);
    h2Query.rows.forEach(row => {
      console.log(`  - ${row.full_name} (${row.h_name})`);
    });

    // Проверка связей
    console.log('\n[Шаг 5] Проверка связей...\n');
    
    const linksQuery = await pgClient.query(
      `SELECT l.source, l.target, lt.code as link_type 
       FROM public.link l
       JOIN public.link_type lt ON l.link_type_id = lt.id
       WHERE l.context_code = $1
       ORDER BY l.source, lt.code`,
      [TEST_CONTEXT]
    );
    
    console.log(`✓ Всего связей: ${linksQuery.rows.length}`);
    
    // Группируем связи по типам
    const linksByType = {};
    linksQuery.rows.forEach(row => {
      if (!linksByType[row.link_type]) {
        linksByType[row.link_type] = [];
      }
      linksByType[row.link_type].push(`${row.source} → ${row.target}`);
    });
    
    Object.keys(linksByType).sort().forEach(linkType => {
      console.log(`\n  ${linkType}: ${linksByType[linkType].length} шт`);
      linksByType[linkType].slice(0, 3).forEach(link => {
        console.log(`    ${link}`);
      });
      if (linksByType[linkType].length > 3) {
        console.log(`    ... ещё ${linksByType[linkType].length - 3}`);
      }
    });

    // Проверка chunks
    console.log('\n[Шаг 6] Проверка chunks...\n');
    
    const chunksQuery = await pgClient.query(
      `SELECT id, full_name, level, type 
       FROM public.chunk_vector 
       WHERE file_id = $1
       ORDER BY created_at`,
      [report.fileId]
    );
    
    console.log(`✓ Всего chunks: ${chunksQuery.rows.length}`);
    chunksQuery.rows.slice(0, 5).forEach(row => {
      console.log(`  - ${row.full_name || 'N/A'} (${row.level}, ${row.type})`);
    });

    console.log('\n=== ТЕСТ ЗАВЕРШЁН УСПЕШНО ✓ ===\n');

  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

// Запуск
testMdLoaderDirect();
