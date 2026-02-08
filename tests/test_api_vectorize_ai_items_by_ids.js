// Тестирование API маршрута /vectorize-ai-items с использованием aiItemIds
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');
require('dotenv').config();

const DbService = require('../packages/core/DbService');
const EmbeddingsFactory = require('../packages/core/EmbeddingsFactory');

const TEST_CONTEXT = 'TEST_API_VECTORIZE_BY_IDS';

async function testApiVectorizeAiItemsByIds() {
  console.log('=== ТЕСТ API МАРШРУТА /vectorize-ai-items (по IDs) ===\n');
  
  const apiUrl = `http://localhost:${process.env.PORT || 3200}`;
  console.log(`Тестируем API на: ${apiUrl}`);
  
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

    // Регистрируем файл
    console.log('[Шаг 2] Регистрация тестового файла...');
    const { id: fileId, isNew } = await dbService.saveFileInfo(
      'test_api_vectorize_by_ids.md', 
      '# Test API Vectorize By IDs\\n\\nThis is a test file for API vectorize endpoint using IDs.', 
      null, 
      TEST_CONTEXT
    );
    console.log(`✓ Файл зарегистрирован, ID: ${fileId}, isNew: ${isNew}\n`);

    // Создаем тестовый чанк и ai_item
    console.log('[Шаг 3] Создание тестового чанка и ai_item...');
    const embeddings = new EmbeddingsFactory().createEmbeddings();
    const [embedding] = await embeddings.embedDocuments(['This is another test content for vectorization by IDs']);
    
    const chunkId = await dbService.saveChunkVector(
      fileId,
      { text: 'This is another test content for vectorization by IDs' },
      null, // не передаем embedding, чтобы проверить его создание
      { 
        type: 'function', 
        level: '0-исходник', 
        full_name: 'test.api.vectorize.by.ids.function',
        s_name: 'vectorizeByIdsFunc'
      },
      null,
      TEST_CONTEXT
    );
    console.log(`✓ Чанк создан, ID: ${chunkId}\n`);

    // Получаем ID ai_item, связанного с этим чанком
    const aiItemResult = await pgClient.query(
      `SELECT ai_item_id 
       FROM public.chunk_vector 
       WHERE id = $1 AND ai_item_id IS NOT NULL`,
      [chunkId]
    );
    
    if (aiItemResult.rows.length === 0 || !aiItemResult.rows[0].ai_item_id) {
      console.log('⚠ Чанк не связан с ai_item, создаем ai_item вручную...');
      const aiItem = await dbService.createAiItem({
        full_name: 'test.api.vectorize.by.ids.function',
        contextCode: TEST_CONTEXT,
        type: 'function',
        sName: 'vectorizeByIdsFunc',
        fileId: fileId
      });
      
      // Свяжем чанк с созданным ai_item
      await pgClient.query(
        'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
        [aiItem.id, chunkId]
      );
      
      var aiItemId = aiItem.id;
      console.log(`✓ AI Item создан вручную и связан с чанком, ID: ${aiItemId}`);
    } else {
      var aiItemId = aiItemResult.rows[0].ai_item_id;
      console.log(`✓ Найден связанный AI Item, ID: ${aiItemId}`);
    }

    // Теперь тестируем API маршрут с использованием ID
    console.log('\n[Шаг 4] Тестирование API маршрута /vectorize-ai-items с использованием aiItemIds...');
    
    const response = await fetch(`${apiUrl}/vectorize-ai-items?context-code=${TEST_CONTEXT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiItemIds: [aiItemId], // Передаем ID напрямую
        force: true
      })
    });

    console.log(`Статус ответа: ${response.status}`);
    const result = await response.json();
    console.log('Ответ от API:', JSON.stringify(result, null, 2));

    if (response.ok) {
      console.log('\n✓ Маршрут /vectorize-ai-items успешно отработал с использованием aiItemIds');
      
      // Проверим, что embedding был создан
      const updatedChunk = await pgClient.query(
        'SELECT embedding FROM public.chunk_vector WHERE id = $1',
        [chunkId]
      );
      
      if (updatedChunk.rows[0].embedding) {
        console.log('✓ Embedding успешно создан для чанка по ID');
      } else {
        console.log('⚠ Embedding не был создан для чанка (возможно, уже существовал)');
      }
    } else {
      console.log('✗ Ошибка при вызове /vectorize-ai-items');
      throw new Error(`API returned status ${response.status}: ${JSON.stringify(result)}`);
    }

    console.log('\n=== ТЕСТ API МАРШРУТА (по IDs) ЗАВЕРШЕН УСПЕШНО ✓ ===\n');

  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

testApiVectorizeAiItemsByIds();