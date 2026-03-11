// Тестовый скрипт для отладки getDashboardStats
// Запуск: node client/test_dashboard_stats.js

const { Client } = require('pg');
const path = require('path');

// Загрузка переменных окружения из .env
require('dotenv').config();

// Конфигурация БД
const dbConfig = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'postgres',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || undefined, // undefined вместо пустой строки
};

const contextCode = 'CARL';

async function testDashboardStats() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('✅ Подключено к базе данных\n');

    // Проверяем существование таблиц
    console.log('📊 Проверка существования таблиц:');
    const tablesCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('files', 'ai_item', 'chunk_vector', 'file_vectors')
      ORDER BY table_name
    `);
    
    console.log('Найденные таблицы:');
    tablesCheck.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    console.log('');

    // Проверяем, есть ли таблица file_vectors
    const fileVectorsExists = tablesCheck.rows.some(r => r.table_name === 'file_vectors');
    const chunkVectorExists = tablesCheck.rows.some(r => r.table_name === 'chunk_vector');
    
    if (fileVectorsExists && !chunkVectorExists) {
      console.log('⚠️  Обнаружена таблица file_vectors, но нет chunk_vector');
      console.log('   Нужно переименовать таблицу в БД\n');
    } else if (fileVectorsExists && chunkVectorExists) {
      console.log('⚠️  Обнаружены обе таблицы (file_vectors и chunk_vector)');
      console.log('   Рекомендуется удалить старую таблицу file_vectors\n');
    }

    // Тестируем каждый запрос из getDashboardStats по отдельности
    console.log('🔍 Тестирование запросов getDashboardStats для контекста:', contextCode);
    console.log('─'.repeat(60));

    const params = [contextCode];

    // 1. Общее количество AiItems
    console.log('\n1️⃣  Тест: Общее количество AiItems');
    try {
      const totalItemsQuery = `SELECT COUNT(*) AS count FROM kosmos.ai_item WHERE context_code = $1`;
      const totalItemsRes = await client.query(totalItemsQuery, params);
      console.log(`   ✅ Успешно: ${totalItemsRes.rows[0].count} AI Items`);
    } catch (error) {
      console.log(`   ❌ Ошибка: ${error.message}`);
    }

    // 2. Количество чанков уровня 1 (зависимости) - с JOIN
    console.log('\n2️⃣  Тест: Количество чанков уровня 1 (с JOIN files)');
    try {
      const depsQuery = `SELECT COUNT(*) AS count 
           FROM kosmos.chunk_vector fv
           JOIN kosmos.files f ON fv.file_id = f.id
           WHERE fv.level LIKE '1-%' AND f.context_code = $1`;
      const depsRes = await client.query(depsQuery, params);
      console.log(`   ✅ Успешно: ${depsRes.rows[0].count} чанков уровня 1`);
    } catch (error) {
      console.log(`   ❌ Ошибка: ${error.message}`);
      console.log(`   📍 Позиция в SQL: ${error.position || 'не указана'}`);
    }

    // 2b. Количество чанков уровня 1 (зависимости) - без JOIN
    console.log('\n2️⃣b Тест: Количество чанков уровня 1 (без JOIN)');
    try {
      const depsQuerySimple = `SELECT COUNT(*) AS count 
           FROM kosmos.chunk_vector 
           WHERE level LIKE '1-%'`;
      const depsResSimple = await client.query(depsQuerySimple, []);
      console.log(`   ✅ Успешно: ${depsResSimple.rows[0].count} чанков уровня 1`);
    } catch (error) {
      console.log(`   ❌ Ошибка: ${error.message}`);
      console.log(`   📍 Позиция в SQL: ${error.position || 'не указана'}`);
    }

    // 3. Статистика по типам AiItem
    console.log('\n3️⃣  Тест: Статистика по типам AiItem');
    try {
      const typeStatsQuery = `SELECT type, COUNT(*) AS count 
           FROM kosmos.ai_item 
           WHERE type IS NOT NULL AND type != '' AND context_code = $1
           GROUP BY type
           ORDER BY count DESC`;
      const typeStatsRes = await client.query(typeStatsQuery, params);
      console.log(`   ✅ Успешно: ${typeStatsRes.rows.length} типов`);
    } catch (error) {
      console.log(`   ❌ Ошибка: ${error.message}`);
    }

    // 4. Статистика по языкам
    console.log('\n4️⃣  Тест: Статистика по языкам');
    try {
      const langStatsQuery = `SELECT 
           LOWER(SUBSTRING(f.filename FROM '\.([^\.]+)$')) AS ext,
           COUNT(*) AS count
           FROM kosmos.files f
           JOIN kosmos.ai_item ai ON f.id = ai.file_id
           WHERE f.context_code = $1
           GROUP BY ext
           ORDER BY count DESC`;
      const langStatsRes = await client.query(langStatsQuery, params);
      console.log(`   ✅ Успешно: ${langStatsRes.rows.length} языков`);
    } catch (error) {
      console.log(`   ❌ Ошибка: ${error.message}`);
    }

    // 5. Размер векторного индекса (с JOIN)
    console.log('\n5️⃣  Тест: Размер векторного индекса (с JOIN files)');
    try {
      const vectorSizeQuery = `SELECT COUNT(*) AS count 
           FROM kosmos.chunk_vector fv
           JOIN kosmos.files f ON fv.file_id = f.id
           WHERE fv.embedding IS NOT NULL AND f.context_code = $1`;
      const vectorSizeRes = await client.query(vectorSizeQuery, params);
      console.log(`   ✅ Успешно: ${vectorSizeRes.rows[0].count} векторов`);
    } catch (error) {
      console.log(`   ❌ Ошибка: ${error.message}`);
      console.log(`   📍 Позиция в SQL: ${error.position || 'не указана'}`);
    }

    // 5b. Размер векторного индекса (без JOIN)
    console.log('\n5️⃣b Тест: Размер векторного индекса (без JOIN)');
    try {
      const vectorSizeQuerySimple = `SELECT COUNT(*) AS count 
           FROM kosmos.chunk_vector 
           WHERE embedding IS NOT NULL`;
      const vectorSizeResSimple = await client.query(vectorSizeQuerySimple, []);
      console.log(`   ✅ Успешно: ${vectorSizeResSimple.rows[0].count} векторов`);
    } catch (error) {
      console.log(`   ❌ Ошибка: ${error.message}`);
      console.log(`   📍 Позиция в SQL: ${error.position || 'не указана'}`);
    }

    // 6. Дата последней модификации (с JOIN)
    console.log('\n6️⃣  Тест: Дата последней модификации (с JOIN files)');
    try {
      const lastScanQuery = `SELECT MAX(fv.created_at) AS last 
           FROM kosmos.chunk_vector fv
           JOIN kosmos.files f ON fv.file_id = f.id
           WHERE f.context_code = $1`;
      const lastScanRes = await client.query(lastScanQuery, params);
      console.log(`   ✅ Успешно: ${lastScanRes.rows[0].last || 'нет данных'}`);
    } catch (error) {
      console.log(`   ❌ Ошибка: ${error.message}`);
      console.log(`   📍 Позиция в SQL: ${error.position || 'не указана'}`);
    }

    // 6b. Дата последней модификации (без JOIN)
    console.log('\n6️⃣b Тест: Дата последней модификации (без JOIN)');
    try {
      const lastScanQuerySimple = `SELECT MAX(created_at) AS last 
           FROM kosmos.chunk_vector`;
      const lastScanResSimple = await client.query(lastScanQuerySimple, []);
      console.log(`   ✅ Успешно: ${lastScanResSimple.rows[0].last || 'нет данных'}`);
    } catch (error) {
      console.log(`   ❌ Ошибка: ${error.message}`);
      console.log(`   📍 Позиция в SQL: ${error.position || 'не указана'}`);
    }

    // Проверяем представления и функции, которые могут ссылаться на file_vectors
    console.log('\n🔍 Проверка объектов БД, ссылающихся на file_vectors:');
    console.log('─'.repeat(60));
    
    try {
      const views = await client.query(`
        SELECT viewname, definition 
        FROM pg_views 
        WHERE schemaname = 'public' 
        AND definition LIKE '%file_vectors%'
      `);
      
      if (views.rows.length > 0) {
        console.log(`\n⚠️  Найдено ${views.rows.length} представлений, ссылающихся на file_vectors:`);
        views.rows.forEach(view => {
          console.log(`   - ${view.viewname}`);
        });
      } else {
        console.log('   ✅ Представлений не найдено');
      }
    } catch (error) {
      console.log(`   ⚠️  Ошибка при проверке представлений: ${error.message}`);
    }

    try {
      const functions = await client.query(`
        SELECT routine_name, routine_definition 
        FROM information_schema.routines 
        WHERE routine_schema = 'public' 
        AND routine_definition LIKE '%file_vectors%'
      `);
      
      if (functions.rows.length > 0) {
        console.log(`\n⚠️  Найдено ${functions.rows.length} функций, ссылающихся на file_vectors:`);
        functions.rows.forEach(func => {
          console.log(`   - ${func.routine_name}`);
        });
      } else {
        console.log('   ✅ Функций не найдено');
      }
    } catch (error) {
      console.log(`   ⚠️  Ошибка при проверке функций: ${error.message}`);
    }

    try {
      const triggers = await client.query(`
        SELECT trigger_name, event_object_table, action_statement
        FROM information_schema.triggers
        WHERE trigger_schema = 'public'
        AND action_statement LIKE '%file_vectors%'
      `);
      
      if (triggers.rows.length > 0) {
        console.log(`\n⚠️  Найдено ${triggers.rows.length} триггеров, ссылающихся на file_vectors:`);
        triggers.rows.forEach(trigger => {
          console.log(`   - ${trigger.trigger_name} (таблица: ${trigger.event_object_table})`);
        });
      } else {
        console.log('   ✅ Триггеров не найдено');
      }
    } catch (error) {
      console.log(`   ⚠️  Ошибка при проверке триггеров: ${error.message}`);
    }

    console.log('\n' + '─'.repeat(60));
    console.log('✅ Тестирование завершено\n');

  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
  } finally {
    await client.end();
  }
}

// Запуск теста
testDashboardStats().catch(console.error);

