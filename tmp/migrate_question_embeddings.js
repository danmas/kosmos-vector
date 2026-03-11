// Скрипт миграции для векторизации существующих вопросов в agent_script
// Использование: node tmp/migrate_question_embeddings.js

const { Client } = require('pg');
const EmbeddingsFactory = require('../packages/core/EmbeddingsFactory');
const DbService = require('../packages/core/DbService');

async function migrateQuestionEmbeddings() {
  let pgClient = null;
  let dbService = null;
  let embeddings = null;

  try {
    // Подключение к БД
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL or POSTGRES_URL environment variable is required');
    }

    pgClient = new Client({ connectionString });
    await pgClient.connect();
    console.log('✅ Подключение к БД установлено');

    dbService = new DbService(pgClient);

    // Инициализация эмбеддингов
    const embeddingsFactory = new EmbeddingsFactory();
    embeddings = embeddingsFactory.createEmbeddings();
    console.log('✅ Фабрика эмбеддингов инициализирована');

    // Получаем все скрипты без эмбеддингов (колонка question_embedding IS NULL)
    const scriptsResult = await pgClient.query(`
      SELECT id, question, context_code
      FROM kosmos.agent_script
      WHERE question_embedding IS NULL
      ORDER BY id
    `);

    const scripts = scriptsResult.rows;
    console.log(`📊 Найдено ${scripts.length} скриптов без эмбеддингов`);

    if (scripts.length === 0) {
      console.log('✅ Все скрипты уже имеют эмбеддинги');
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    // Векторизуем каждый вопрос
    for (let i = 0; i < scripts.length; i++) {
      const script = scripts[i];
      try {
        console.log(`[${i + 1}/${scripts.length}] Векторизация скрипта #${script.id}: "${script.question.substring(0, 50)}..."`);

        const questionVector = await embeddings.embedQuery(script.question);
        await dbService.saveQuestionEmbedding(script.id, questionVector);

        successCount++;
        console.log(`  ✅ Эмбеддинг сохранён для скрипта #${script.id}`);
      } catch (error) {
        errorCount++;
        console.error(`  ❌ Ошибка при векторизации скрипта #${script.id}:`, error.message);
      }

      // Небольшая задержка, чтобы не перегружать API эмбеддингов
      if (i < scripts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log('\n📈 Результаты миграции:');
    console.log(`  ✅ Успешно: ${successCount}`);
    console.log(`  ❌ Ошибок: ${errorCount}`);
    console.log(`  📊 Всего: ${scripts.length}`);

  } catch (error) {
    console.error('❌ Критическая ошибка миграции:', error);
    process.exit(1);
  } finally {
    if (pgClient) {
      await pgClient.end();
      console.log('✅ Соединение с БД закрыто');
    }
  }
}

// Запуск миграции
if (require.main === module) {
  migrateQuestionEmbeddings()
    .then(() => {
      console.log('✅ Миграция завершена');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Ошибка при выполнении миграции:', error);
      process.exit(1);
    });
}

module.exports = { migrateQuestionEmbeddings };
