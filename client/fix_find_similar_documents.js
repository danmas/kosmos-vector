// Скрипт для исправления функции find_similar_documents
// Заменит все упоминания file_vectors на chunk_vector
// Запуск: node client/fix_find_similar_documents.js

const { Client } = require('pg');
require('dotenv').config();

const dbConfig = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'postgres',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || undefined,
};

async function fixFunction() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('✅ Подключено к базе данных\n');

    // Получаем определение функции
    console.log('🔍 Поиск функции find_similar_documents...');
    const funcResult = await client.query(`
      SELECT 
        p.proname AS function_name,
        pg_get_functiondef(p.oid) AS function_definition,
        p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'kosmos'
      AND p.proname = 'find_similar_documents'
      LIMIT 1
    `);

    if (funcResult.rows.length === 0) {
      console.log('⚠️  Функция find_similar_documents не найдена');
      return;
    }

    const funcDef = funcResult.rows[0].function_definition;
    console.log('📄 Текущее определение функции:');
    console.log('─'.repeat(60));
    console.log(funcDef);
    console.log('─'.repeat(60));

    // Проверяем, есть ли упоминания file_vectors
    if (!funcDef.includes('file_vectors') && !funcDef.includes('FILE_VECTORS')) {
      console.log('\n✅ Функция уже не содержит упоминаний file_vectors');
      return;
    }

    // Заменяем file_vectors на chunk_vector (регистронезависимо)
    let newDef = funcDef;
    newDef = newDef.replace(/file_vectors/gi, 'chunk_vector');
    
    console.log('\n📝 Новое определение функции:');
    console.log('─'.repeat(60));
    console.log(newDef);
    console.log('─'.repeat(60));

    // Удаляем старую функцию
    console.log('\n🗑️  Удаление старой функции...');
    await client.query(`DROP FUNCTION IF EXISTS kosmos.find_similar_documents CASCADE`);
    console.log('   ✅ Старая функция удалена');

    // Создаем новую функцию
    console.log('\n✨ Создание новой функции...');
    await client.query(newDef);
    console.log('   ✅ Новая функция создана');

    // Проверяем, что функция работает
    console.log('\n🔍 Проверка новой функции...');
    const checkResult = await client.query(`
      SELECT 
        p.proname AS function_name,
        pg_get_functiondef(p.oid) AS function_definition
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'kosmos'
      AND p.proname = 'find_similar_documents'
      LIMIT 1
    `);

    if (checkResult.rows.length > 0) {
      const newFuncDef = checkResult.rows[0].function_definition;
      if (!newFuncDef.includes('file_vectors') && !newFuncDef.includes('FILE_VECTORS')) {
        console.log('   ✅ Функция успешно обновлена, упоминаний file_vectors нет');
      } else {
        console.log('   ⚠️  Функция обновлена, но все еще содержит упоминания file_vectors');
      }
    }

    console.log('\n✅ Готово!\n');

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.error(error);
  } finally {
    await client.end();
  }
}

// Запуск
fixFunction().catch(console.error);

