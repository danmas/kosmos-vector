// Скрипт для переименования индексов с file_vectors на chunk_vector
// Запуск: node client/fix_indexes.js

const { Client } = require('pg');
require('dotenv').config();

const dbConfig = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'postgres',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || undefined,
};

const indexRenames = [
  { old: 'file_vectors_pkey', new: 'chunk_vector_pkey' },
  { old: 'file_vectors_created_at_index', new: 'chunk_vector_created_at_index' },
  { old: 'idx_file_vectors_ai_item_id', new: 'idx_chunk_vector_ai_item_id' },
  { old: 'idx_file_vectors_embedding', new: 'idx_chunk_vector_embedding' },
  { old: 'idx_file_vectors_file_id', new: 'idx_chunk_vector_file_id' },
  { old: 'idx_file_vectors_level', new: 'idx_chunk_vector_level' },
  { old: 'idx_file_vectors_parent_chunk_id', new: 'idx_chunk_vector_parent_chunk_id' },
  { old: 'idx_file_vectors_type', new: 'idx_chunk_vector_type' },
];

async function fixIndexes() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('✅ Подключено к базе данных\n');

    console.log('🔧 Переименование индексов...\n');

    for (const rename of indexRenames) {
      try {
        // Проверяем, существует ли индекс со старым именем
        const checkOld = await client.query(`
          SELECT 1 FROM pg_indexes 
          WHERE schemaname = 'kosmos' 
          AND indexname = $1
        `, [rename.old]);

        if (checkOld.rows.length === 0) {
          console.log(`   ⏭️  ${rename.old} — не найден (возможно, уже переименован)`);
          continue;
        }

        // Проверяем, не существует ли уже индекс с новым именем
        const checkNew = await client.query(`
          SELECT 1 FROM pg_indexes 
          WHERE schemaname = 'kosmos' 
          AND indexname = $1
        `, [rename.new]);

        if (checkNew.rows.length > 0) {
          console.log(`   ⚠️  ${rename.new} — уже существует, пропускаем`);
          continue;
        }

        // Переименовываем индекс
        await client.query(`ALTER INDEX "${rename.old}" RENAME TO "${rename.new}"`);
        console.log(`   ✅ ${rename.old} → ${rename.new}`);

      } catch (error) {
        console.log(`   ❌ Ошибка при переименовании ${rename.old}: ${error.message}`);
      }
    }

    // Проверяем результат
    console.log('\n🔍 Проверка индексов после переименования...');
    const indexes = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'kosmos'
      AND tablename = 'chunk_vector'
      ORDER BY indexname
    `);

    console.log(`\nИндексы таблицы chunk_vector (${indexes.rows.length}):`);
    indexes.rows.forEach(idx => {
      const hasOldName = idx.indexname.includes('file_vectors');
      const prefix = hasOldName ? '⚠️ ' : '✅ ';
      console.log(`   ${prefix}${idx.indexname}`);
    });

    // Проверяем, остались ли индексы со старыми именами
    const oldIndexes = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'kosmos'
      AND indexname LIKE '%file_vectors%'
    `);

    if (oldIndexes.rows.length > 0) {
      console.log(`\n⚠️  Осталось ${oldIndexes.rows.length} индексов со старыми именами`);
    } else {
      console.log('\n✅ Все индексы переименованы!');
    }

    console.log('\n✅ Готово!\n');

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.error(error);
  } finally {
    await client.end();
  }
}

fixIndexes().catch(console.error);

