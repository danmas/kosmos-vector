// Тест векторизации ai_item, созданных из Markdown (прямой вызов без HTTP)
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');
require('dotenv').config();

const DbService = require('../packages/core/DbService');
const EmbeddingsFactory = require('../packages/core/EmbeddingsFactory');
const { loadMarkdownFromFile } = require('../routes/loaders/mdLoader');

const TEST_CONTEXT = 'TEST_MD_VECTORIZE';
const TEST_FILE = path.join(__dirname, 'README_TESTS.md');

async function vectorizeAiItems(dbService, embeddings, aiItemIds, force = false) {
  let totalUpdated = 0;
  const errors = [];
  for (const aiItemId of aiItemIds) {
    try {
      const chunks = await dbService.getAiItemChunks(aiItemId);
      for (const chunk of chunks) {
        const raw = chunk.chunk_content;
        const text = typeof raw === 'string' ? raw : (raw && raw.text ? raw.text : String(raw || ''));
        if (!text || text.trim() === '') continue;
        const shouldUpdate = force || !chunk.has_embedding;
        if (!shouldUpdate) continue;
        const [embedding] = await embeddings.embedDocuments([text]);
        await dbService.updateChunkEmbedding(chunk.id, embedding);
        totalUpdated++;
      }
    } catch (err) {
      errors.push({ aiItemId, message: err.message });
    }
  }
  return { totalUpdated, errors };
}

async function testMdVectorizeAiItems() {
  console.log('=== ТЕСТ ВЕКТОРИЗАЦИИ MD AI_ITEMS ===');
  console.log('Тестовый файл: README_TESTS.md (реальная документация)\n');

  const pgClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'postgres',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || ''
  });

  try {
    console.log('[Шаг 1] Подключение к PostgreSQL...');
    await pgClient.connect();
    console.log('✓ Подключено к БД\n');

    const dbService = new DbService(pgClient);
    await dbService.initializeSchema();
    console.log('✓ Схема БД инициализирована\n');

    console.log('[Шаг 2] Проверка тестового MD файла...');
    if (!fs.existsSync(TEST_FILE)) {
      throw new Error(`Тестовый файл не найден: ${TEST_FILE}`);
    }
    console.log(`✓ Файл: ${TEST_FILE}\n`);

    console.log('[Шаг 3] Загрузка MD (создание ai_item и chunk_vector без embedding)...');
    const report = await loadMarkdownFromFile(TEST_FILE, TEST_CONTEXT, dbService, null);
    console.log(`  Файл: ${report.filename}, fileId: ${report.fileId}`);
    console.log(`  Секций: ${report.sectionsProcessed}, ошибок: ${report.errors.length}\n`);

    const aiItemsRes = await pgClient.query(
      'SELECT id, full_name, type FROM public.ai_item WHERE context_code = $1 ORDER BY id',
      [TEST_CONTEXT]
    );
    const aiItemIds = aiItemsRes.rows.map(r => r.id);
    if (aiItemIds.length === 0) {
      throw new Error('После загрузки MD не найдено ни одного ai_item');
    }
    console.log(`[Шаг 4] Найдено ai_item: ${aiItemIds.length}`);
    aiItemsRes.rows.slice(0, 5).forEach(row => {
      console.log(`  - id=${row.id} ${row.full_name} (${row.type})`);
    });
    if (aiItemsRes.rows.length > 5) {
      console.log(`  ... и ещё ${aiItemsRes.rows.length - 5}`);
    }
    console.log();

    const chunksBefore = await pgClient.query(
      `SELECT COUNT(*) AS total,
              COUNT(embedding) FILTER (WHERE embedding IS NOT NULL) AS with_embedding
       FROM public.chunk_vector WHERE ai_item_id = ANY($1::int[])`,
      [aiItemIds]
    );
    console.log('[Шаг 5] Чанки до векторизации:', chunksBefore.rows[0].total, 'всего, с embedding:', chunksBefore.rows[0].with_embedding);

    console.log('\n[Шаг 6] Векторизация ai_item (SimpleEmbeddings)...');
    const embeddingsFactory = new EmbeddingsFactory({ defaultModel: 'simple' });
    const embeddings = embeddingsFactory.createEmbeddings();
    const { totalUpdated, errors } = await vectorizeAiItems(dbService, embeddings, aiItemIds, false);
    console.log(`  Обновлено чанков: ${totalUpdated}`);
    if (errors.length > 0) {
      console.log('  Ошибки по item:', errors);
    }
    console.log();

    const chunksAfter = await pgClient.query(
      `SELECT COUNT(*) AS total,
              COUNT(embedding) FILTER (WHERE embedding IS NOT NULL) AS with_embedding
       FROM public.chunk_vector WHERE ai_item_id = ANY($1::int[])`,
      [aiItemIds]
    );
    console.log('[Шаг 7] Чанки после векторизации:', chunksAfter.rows[0].total, 'всего, с embedding:', chunksAfter.rows[0].with_embedding);

    const withEmbedding = parseInt(chunksAfter.rows[0].with_embedding, 10);
    const total = parseInt(chunksAfter.rows[0].total, 10);
    if (total > 0 && withEmbedding < total) {
      throw new Error(`Ожидалось, что все чанки получат embedding, получено: ${withEmbedding}/${total}`);
    }
    if (total === 0) {
      throw new Error('Нет чанков для проверки');
    }

    console.log('\n[Шаг 8] Проверка по fullNames + context-code (getAiItemIdsByFullNames)...');
    const fullNames = aiItemsRes.rows.map(r => r.full_name).slice(0, 3);
    const resolved = await dbService.getAiItemIdsByFullNames(fullNames, TEST_CONTEXT);
    if (resolved.length !== fullNames.length) {
      throw new Error(`getAiItemIdsByFullNames: ожидалось ${fullNames.length} id, получено ${resolved.length}`);
    }
    console.log(`  fullNames [${fullNames.length}]: разрешены в id: [${resolved.map(r => r.id).join(', ')}]`);

    console.log('\n=== ТЕСТ ЗАВЕРШЁН УСПЕШНО ✓ ===\n');

  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

testMdVectorizeAiItems();
