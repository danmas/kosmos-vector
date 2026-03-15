// Скрипт для поиска всех объектов БД, ссылающихся на file_vectors
// Запуск: node client/find_all_file_vectors_refs.js

const { Client } = require('pg');
require('dotenv').config();

const dbConfig = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'postgres',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || undefined,
};

async function findAllReferences() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('✅ Подключено к базе данных\n');

    // 1. Поиск функций
    console.log('🔍 Поиск функций, ссылающихся на file_vectors...');
    const functions = await client.query(`
      SELECT 
        p.proname AS name,
        p.oid,
        p.prokind
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'kosmos'
      AND p.prokind = 'f'  -- только обычные функции, не агрегаты
    `);

    const funcsWithRef = [];
    for (const func of functions.rows) {
      try {
        const defResult = await client.query(
          `SELECT pg_get_functiondef($1) AS definition`,
          [func.oid]
        );
        const definition = defResult.rows[0]?.definition || '';
        if (definition.toLowerCase().includes('file_vectors')) {
          funcsWithRef.push({ name: func.name, definition });
        }
      } catch (e) {
        // Игнорируем функции, которые не могут быть получены
      }
    }

    if (funcsWithRef.length > 0) {
      console.log(`\n⚠️  Найдено ${funcsWithRef.length} функций:`);
      funcsWithRef.forEach(func => {
        console.log(`\n--- ${func.name} ---`);
        console.log(func.definition);
      });
    } else {
      console.log('   ✅ Функций не найдено');
    }

    // 2. Поиск представлений
    console.log('\n🔍 Поиск представлений, ссылающихся на file_vectors...');
    const views = await client.query(`
      SELECT viewname, definition 
      FROM pg_views 
      WHERE schemaname = 'kosmos'
    `);

    const viewsWithRef = views.rows.filter(row => 
      row.definition && row.definition.toLowerCase().includes('file_vectors')
    );

    if (viewsWithRef.length > 0) {
      console.log(`\n⚠️  Найдено ${viewsWithRef.length} представлений:`);
      viewsWithRef.forEach(view => {
        console.log(`\n--- ${view.viewname} ---`);
        console.log(view.definition);
      });
    } else {
      console.log('   ✅ Представлений не найдено');
    }

    // 3. Поиск триггеров
    console.log('\n🔍 Поиск триггеров, ссылающихся на file_vectors...');
    const triggers = await client.query(`
      SELECT 
        tgname AS trigger_name,
        relname AS table_name,
        pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'kosmos'
      AND NOT t.tgisinternal
    `);

    const triggersWithRef = triggers.rows.filter(row => 
      row.definition && row.definition.toLowerCase().includes('file_vectors')
    );

    if (triggersWithRef.length > 0) {
      console.log(`\n⚠️  Найдено ${triggersWithRef.length} триггеров:`);
      triggersWithRef.forEach(trigger => {
        console.log(`\n--- ${trigger.trigger_name} (таблица: ${trigger.table_name}) ---`);
        console.log(trigger.definition);
      });
    } else {
      console.log('   ✅ Триггеров не найдено');
    }

    // 4. Поиск ограничений
    console.log('\n🔍 Поиск ограничений, ссылающихся на file_vectors...');
    const constraints = await client.query(`
      SELECT 
        conname AS constraint_name,
        conrelid::regclass AS table_name,
        pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE connamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'kosmos')
    `);

    const constraintsWithRef = constraints.rows.filter(row => 
      row.definition && row.definition.toLowerCase().includes('file_vectors')
    );

    if (constraintsWithRef.length > 0) {
      console.log(`\n⚠️  Найдено ${constraintsWithRef.length} ограничений:`);
      constraintsWithRef.forEach(constraint => {
        console.log(`\n--- ${constraint.constraint_name} (таблица: ${constraint.table_name}) ---`);
        console.log(constraint.definition);
      });
    } else {
      console.log('   ✅ Ограничений не найдено');
    }

    // 5. Поиск индексов
    console.log('\n🔍 Поиск индексов, ссылающихся на file_vectors...');
    const indexes = await client.query(`
      SELECT 
        indexname,
        tablename,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'kosmos'
    `);

    const indexesWithRef = indexes.rows.filter(row => 
      row.indexdef && row.indexdef.toLowerCase().includes('file_vectors')
    );

    if (indexesWithRef.length > 0) {
      console.log(`\n⚠️  Найдено ${indexesWithRef.length} индексов:`);
      indexesWithRef.forEach(index => {
        console.log(`\n--- ${index.indexname} (таблица: ${index.tablename}) ---`);
        console.log(index.indexdef);
      });
    } else {
      console.log('   ✅ Индексов не найдено');
    }

    // 6. Поиск правил (rules)
    console.log('\n🔍 Поиск правил (rules), ссылающихся на file_vectors...');
    const rules = await client.query(`
      SELECT 
        rulename,
        tablename,
        definition
      FROM pg_rules
      WHERE schemaname = 'kosmos'
    `);

    const rulesWithRef = rules.rows.filter(row => 
      row.definition && row.definition.toLowerCase().includes('file_vectors')
    );

    if (rulesWithRef.length > 0) {
      console.log(`\n⚠️  Найдено ${rulesWithRef.length} правил:`);
      rulesWithRef.forEach(rule => {
        console.log(`\n--- ${rule.rulename} (таблица: ${rule.tablename}) ---`);
        console.log(rule.definition);
      });
    } else {
      console.log('   ✅ Правил не найдено');
    }

    // 7. Общий поиск в pg_depend и pg_description
    console.log('\n🔍 Поиск зависимостей от таблицы file_vectors...');
    const tableOid = await client.query(`
      SELECT oid FROM pg_class 
      WHERE relname = 'file_vectors' 
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'kosmos')
    `);

    if (tableOid.rows.length > 0) {
      console.log(`\n⚠️  Таблица file_vectors существует (oid: ${tableOid.rows[0].oid})`);
      
      const deps = await client.query(`
        SELECT 
          classid::regclass AS dep_class,
          objid::regclass AS dep_object,
          refclassid::regclass AS ref_class,
          refobjid::regclass AS ref_object,
          deptype
        FROM pg_depend
        WHERE refobjid = $1
      `, [tableOid.rows[0].oid]);

      if (deps.rows.length > 0) {
        console.log(`   Найдено ${deps.rows.length} зависимостей`);
      }
    } else {
      console.log('   ✅ Таблица file_vectors не существует');
    }

    console.log('\n' + '─'.repeat(60));
    console.log('✅ Проверка завершена\n');

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.error(error);
  } finally {
    await client.end();
  }
}

findAllReferences().catch(console.error);

