// Тест векторизации MD ai_item с реальной моделью OpenAI (text-embedding-ada-002).
// Требуется OPENAI_API_KEY в .env. При отсутствии ключа тест пропускается (exit 0).
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');
require('dotenv').config();

const DbService = require('../packages/core/DbService');
const EmbeddingsFactory = require('../packages/core/EmbeddingsFactory');
const { loadMarkdownFromFile } = require('../routes/loaders/mdLoader');

const TEST_CONTEXT = 'TEST_MD_VECTORIZE_OPENAI';
const TEST_FILE = path.join(__dirname, '..', 'KB', 'README_TESTS.md');

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

// Функция для тестирования API маршрута /vectorize-ai-items
async function testApiRoute() {
  console.log('\n[Шаг A] Тестируем API маршрут /vectorize-ai-items...');
  
  // Попробуем вызвать API маршрут напрямую
  const apiUrl = `http://localhost:${process.env.PORT || 3001}`;
  
  try {
    // Сначала создадим тестовый файл и ai_item для тестирования API
    const pgClient = new Client({
      host: process.env.PGHOST || 'localhost',
      port: process.env.PGPORT || 5432,
      database: process.env.PGDATABASE || 'postgres',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || ''
    });
    
    await pgClient.connect();
    const dbService = new DbService(pgClient);
    
    // Регистрируем файл
    const { id: fileId } = await dbService.saveFileInfo('test_api_file.md', '# Test File\n\nTest content', null, TEST_CONTEXT);
    
    // Создаем тестовый чанк и ai_item
    const [embedding] = await new EmbeddingsFactory().createEmbeddings().embedDocuments(['Test content']);
    const chunkId = await dbService.saveChunkVector(
      fileId,
      { text: 'Test content' },
      embedding,
      { type: 'test', level: '0-исходник', full_name: 'test.api.function' },
      null,
      TEST_CONTEXT
    );
    
    // Теперь вызываем API маршрут
    const response = await fetch(`${apiUrl}/vectorize-ai-items?context-code=${TEST_CONTEXT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullNames: ['test.api.function'],
        force: true
      })
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('✓ Маршрут /vectorize-ai-items успешно отработал:', result);
    } else {
      console.log('✗ Ошибка при вызове /vectorize-ai-items:', result);
    }
    
    await pgClient.end();
    
  } catch (error) {
    console.log('✗ Ошибка при тестировании API маршрута:', error.message);
  }
}


async function testMdVectorizeAiItemsOpenAI() {
  console.log('=== ТЕСТ ВЕКТОРИЗАЦИИ MD AI_ITEMS (OpenAI Embeddings) ===');
  console.log('Тестовый файл: README_TESTS.md (реальная документация)\n');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey.startsWith('<')) {
    console.log('Пропуск: OPENAI_API_KEY не задан или задан плейсхолдером.');
    console.log('Задайте реальный ключ в .env для запуска теста с OpenAI.\n');
    process.exit(0);
  }

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

    console.log('\n[Шаг 6] Векторизация ai_item (OpenAI text-embedding-ada-002)...');
    const embeddingsFactory = new EmbeddingsFactory({ defaultModel: 'openai' });
    const embeddings = embeddingsFactory.createEmbeddings();
    const { totalUpdated, errors } = await vectorizeAiItems(dbService, embeddings, aiItemIds, false);
    console.log(`  Обновлено чанков: ${totalUpdated}`);
    if (errors.length > 0) {
      errors.forEach(e => console.log(`  Ошибка ai_item ${e.aiItemId}: ${e.message}`));
      throw new Error(`Векторизация завершилась с ошибками: ${errors.length}`);
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

    // Проверка размерности (OpenAI ada-002 = 1536). pgvector: vector_dims() или по строке.
    let dim = null;
    try {
      const dimRes = await pgClient.query(
        `SELECT vector_dims(embedding) AS dim
         FROM public.chunk_vector
         WHERE ai_item_id = $1 AND embedding IS NOT NULL
         LIMIT 1`,
        [aiItemIds[0]]
      );
      if (dimRes.rows.length > 0 && dimRes.rows[0].dim != null) {
        dim = parseInt(dimRes.rows[0].dim, 10);
      }
    } catch (_) {
      // vector_dims может отсутствовать — пробуем по длине строки вектора
      const rawRes = await pgClient.query(
        `SELECT embedding::text AS vec
         FROM public.chunk_vector
         WHERE ai_item_id = $1 AND embedding IS NOT NULL
         LIMIT 1`,
        [aiItemIds[0]]
      );
      if (rawRes.rows.length > 0 && rawRes.rows[0].vec) {
        dim = (rawRes.rows[0].vec.match(/,/g) || []).length + 1;
      }
    }
    if (dim != null && dim !== 1536) {
      throw new Error(`Ожидаемая размерность embedding 1536, получено: ${dim}`);
    }
    console.log('[Шаг 8] Размерность вектора:', dim == null ? 'не проверялась' : `${dim} (text-embedding-ada-002)`);

    console.log('\n=== ТЕСТ ЗАВЕРШЁН УСПЕШНО ✓ ===\n');
    
    // Тестируем API маршрут
    await testApiRoute();

  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

testMdVectorizeAiItemsOpenAI();
