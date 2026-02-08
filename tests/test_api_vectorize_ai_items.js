// Тестирование API маршрута /vectorize-ai-items
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');
require('dotenv').config();

const DbService = require('../packages/core/DbService');
const EmbeddingsFactory = require('../packages/core/EmbeddingsFactory');

const TEST_CONTEXT = 'TEST_API_VECTORIZE';

async function testApiVectorizeAiItems() {
  console.log('=== ТЕСТ API МАРШРУТА /vectorize-ai-items ===\n');
  
  const apiUrl = `http://localhost:${process.env.PORT || 3001}`;
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
      'test_api_vectorize.md', 
      '# Test API Vectorize\\n\\nThis is a test file for API vectorize endpoint.', 
      null, 
      TEST_CONTEXT
    );
    console.log(`✓ Файл зарегистрирован, ID: ${fileId}, isNew: ${isNew}\n`);

    // Создаем тестовый чанк
    console.log('[Шаг 3] Создание тестового чанка и ai_item...');
    const embeddings = new EmbeddingsFactory().createEmbeddings();
    const [embedding] = await embeddings.embedDocuments(['This is a test content for vectorization']);
    
    const chunkId = await dbService.saveChunkVector(
      fileId,
      { text: 'This is a test content for vectorization' },
      embedding, // передаем embedding, чтобы потом протестировать его обновление
      { 
        type: 'function', 
        level: '0-исходник', 
        full_name: 'test.api.vectorize.function',
        s_name: 'vectorizeFunc'
      },
      null,
      TEST_CONTEXT
    );
    console.log(`✓ Чанк создан, ID: ${chunkId}\n`);

    // Проверяем, что ai_item был создан
    const aiItemCheck = await pgClient.query(
      'SELECT id, full_name, type FROM public.ai_item WHERE full_name = $1 AND context_code = $2',
      ['test.api.vectorize.function', TEST_CONTEXT]
    );
    
    if (aiItemCheck.rows.length === 0) {
      console.log('⚠ AI Item не был автоматически создан, создаем вручную...');
      const aiItem = await dbService.createAiItem({
        full_name: 'test.api.vectorize.function',
        contextCode: TEST_CONTEXT,
        type: 'function',
        sName: 'vectorizeFunc',
        fileId: fileId
      });
      console.log(`✓ AI Item создан вручную, ID: ${aiItem.id}`);
    } else {
      console.log(`✓ AI Item найден, ID: ${aiItemCheck.rows[0].id}`);
    }

    // Теперь тестируем API маршрут
    console.log('\n[Шаг 4] Тестирование API маршрута /vectorize-ai-items...');
    
    // Сначала удалим embedding, чтобы проверить, что он будет пересоздан
    await pgClient.query(
      'UPDATE public.chunk_vector SET embedding = NULL WHERE id = $1',
      [chunkId]
    );
    console.log('✓ Embedding удален для теста пересоздания');
    
    const response = await fetch(`${apiUrl}/vectorize-ai-items?context-code=${TEST_CONTEXT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullNames: ['test.api.vectorize.function'],
        force: true
      })
    });

    console.log(`Статус ответа: ${response.status}`);
    const result = await response.json();
    console.log('Ответ от API:', JSON.stringify(result, null, 2));

    if (response.ok) {
      console.log('\n✓ Маршрут /vectorize-ai-items успешно отработал');
      
      // Проверим, что embedding был создан
      const updatedChunk = await pgClient.query(
        'SELECT embedding FROM public.chunk_vector WHERE id = $1',
        [chunkId]
      );
      
      if (updatedChunk.rows[0].embedding) {
        console.log('✓ Embedding успешно создан для чанка');
      } else {
        console.log('✗ Embedding не был создан для чанка');
      }
    } else {
      console.log('✗ Ошибка при вызове /vectorize-ai-items');
      throw new Error(`API returned status ${response.status}: ${JSON.stringify(result)}`);
    }

    console.log('\n=== ТЕСТ API МАРШРУТА ЗАВЕРШЕН УСПЕШНО ✓ ===\n');

  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

testApiVectorizeAiItems();