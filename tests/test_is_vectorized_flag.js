require('dotenv').config();
const { Client } = require('pg');
const DbService = require('../packages/core/DbService');
const EmbeddingsFactory = require('../packages/core/EmbeddingsFactory');
const fetch = require('node-fetch');

const TEST_CONTEXT = 'TEST_IS_VECTORIZED';
const API_URL = `http://localhost:${process.env.PORT || 3200}`;

/**
 * Тест проверяет работу флага isVectorized в API маршрутах:
 * - GET /api/items-list должен возвращать isVectorized: true/false для каждого элемента
 * - GET /api/items/:id должен возвращать isVectorized: true/false
 */
async function testIsVectorizedFlag() {
  console.log('=== ТЕСТ ФЛАГА isVectorized В API ===\n');
  
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

    // Создаем два тестовых файла
    console.log('[Шаг 2] Создание тестовых файлов и ai_items...');
    
    // Файл 1 - с векторизацией
    const { id: fileId1 } = await dbService.saveFileInfo(
      'test_vectorized.js',
      '// Test file with vectorization\nfunction testFunc() { return true; }',
      null,
      TEST_CONTEXT
    );
    
    // Файл 2 - без векторизации
    const { id: fileId2 } = await dbService.saveFileInfo(
      'test_not_vectorized.js',
      '// Test file without vectorization\nfunction anotherFunc() { return false; }',
      null,
      TEST_CONTEXT
    );
    
    console.log(`✓ Файлы созданы: fileId1=${fileId1}, fileId2=${fileId2}\n`);

    // Создаем чанки и ai_items
    const embeddings = new EmbeddingsFactory().createEmbeddings();
    const [embedding] = await embeddings.embedDocuments(['test content with embedding']);
    
    // AI Item 1 - С ВЕКТОРИЗАЦИЕЙ (есть embedding)
    console.log('[Шаг 3] Создание ai_item с векторизацией...');
    const chunkId1 = await dbService.saveChunkVector(
      fileId1,
      { text: 'function testFunc() { return true; }' },
      embedding, // передаем embedding
      {
        type: 'function',
        level: '0-исходник',
        full_name: 'test_vectorized.js::function::testFunc',
        s_name: 'testFunc'
      },
      null,
      TEST_CONTEXT
    );
    console.log(`✓ Чанк с embedding создан, ID: ${chunkId1}`);
    
    // AI Item 2 - БЕЗ ВЕКТОРИЗАЦИИ (нет embedding)
    console.log('[Шаг 4] Создание ai_item без векторизации...');
    const chunkId2 = await dbService.saveChunkVector(
      fileId2,
      { text: 'function anotherFunc() { return false; }' },
      null, // НЕ передаем embedding
      {
        type: 'function',
        level: '0-исходник',
        full_name: 'test_not_vectorized.js::function::anotherFunc',
        s_name: 'anotherFunc'
      },
      null,
      TEST_CONTEXT
    );
    console.log(`✓ Чанк без embedding создан, ID: ${chunkId2}\n`);

    // Тестируем API /items-list
    console.log('[Шаг 5] Тестирование GET /api/items-list...');
    const listResponse = await fetch(`${API_URL}/api/items-list?context-code=${TEST_CONTEXT}`);
    
    if (!listResponse.ok) {
      throw new Error(`API /items-list returned status ${listResponse.status}`);
    }
    
    const itemsList = await listResponse.json();
    console.log(`✓ Получен список из ${itemsList.length} элементов\n`);
    
    // Проверяем наличие флага isVectorized
    const item1 = itemsList.find(i => i.id === 'test_vectorized.js::function::testFunc');
    const item2 = itemsList.find(i => i.id === 'test_not_vectorized.js::function::anotherFunc');
    
    if (!item1) {
      throw new Error('Не найден item1 в списке');
    }
    if (!item2) {
      throw new Error('Не найден item2 в списке');
    }
    
    console.log('Проверка item1 (должен быть векторизован):');
    console.log(`  id: ${item1.id}`);
    console.log(`  isVectorized: ${item1.isVectorized}`);
    
    console.log('\nПроверка item2 (НЕ должен быть векторизован):');
    console.log(`  id: ${item2.id}`);
    console.log(`  isVectorized: ${item2.isVectorized}`);
    
    if (item1.isVectorized !== true) {
      throw new Error(`Ошибка: item1.isVectorized должен быть true, получено: ${item1.isVectorized}`);
    }
    
    if (item2.isVectorized !== false) {
      throw new Error(`Ошибка: item2.isVectorized должен быть false, получено: ${item2.isVectorized}`);
    }
    
    console.log('\n✓ Флаги isVectorized в /items-list корректны!\n');

    // Тестируем API /items/:id
    console.log('[Шаг 6] Тестирование GET /api/items/:id...');
    
    const item1DetailResponse = await fetch(
      `${API_URL}/api/items/${encodeURIComponent('test_vectorized.js::function::testFunc')}?context-code=${TEST_CONTEXT}`
    );
    
    if (!item1DetailResponse.ok) {
      throw new Error(`API /items/:id returned status ${item1DetailResponse.status}`);
    }
    
    const item1Detail = await item1DetailResponse.json();
    console.log('Детали item1:');
    console.log(`  id: ${item1Detail.id}`);
    console.log(`  isVectorized: ${item1Detail.isVectorized}`);
    
    if (item1Detail.isVectorized !== true) {
      throw new Error(`Ошибка: item1Detail.isVectorized должен быть true, получено: ${item1Detail.isVectorized}`);
    }
    
    const item2DetailResponse = await fetch(
      `${API_URL}/api/items/${encodeURIComponent('test_not_vectorized.js::function::anotherFunc')}?context-code=${TEST_CONTEXT}`
    );
    
    if (!item2DetailResponse.ok) {
      throw new Error(`API /items/:id returned status ${item2DetailResponse.status}`);
    }
    
    const item2Detail = await item2DetailResponse.json();
    console.log('\nДетали item2:');
    console.log(`  id: ${item2Detail.id}`);
    console.log(`  isVectorized: ${item2Detail.isVectorized}`);
    
    if (item2Detail.isVectorized !== false) {
      throw new Error(`Ошибка: item2Detail.isVectorized должен быть false, получено: ${item2Detail.isVectorized}`);
    }
    
    console.log('\n✓ Флаги isVectorized в /items/:id корректны!\n');

    console.log('=== ТЕСТ ЗАВЕРШЁН УСПЕШНО ✓ ===\n');

  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

// Запуск теста
testIsVectorizedFlag().catch(error => {
  console.error('Необработанная ошибка:', error);
  process.exit(1);
});
