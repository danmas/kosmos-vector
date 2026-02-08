// tests/test_rag_retrieval.js
// Тесты для проверки RAG-функциональности (поиск и сборка контекста)

require('dotenv').config();
const { Client } = require('pg');
const DbService = require('../packages/core/DbService');
const EmbeddingsFactory = require('../packages/core/EmbeddingsFactory');
const RAGRetriever = require('../packages/core/RAGRetriever');
const ContextBuilder = require('../packages/core/ContextBuilder');

// Цвета для консоли
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function success(message) {
  log(`✓ ${message}`, colors.green);
}

function error(message) {
  log(`✗ ${message}`, colors.red);
}

function info(message) {
  log(`ℹ ${message}`, colors.blue);
}

function section(message) {
  log(`\n${'='.repeat(60)}`, colors.cyan);
  log(message, colors.cyan);
  log('='.repeat(60), colors.cyan);
}

async function runTests() {
  const pgClient = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    section('ТЕСТИРОВАНИЕ RAG RETRIEVAL');
    
    // Подключаемся к БД
    info('Подключение к PostgreSQL...');
    await pgClient.connect();
    success('Подключено к PostgreSQL');

    // Инициализация сервисов
    const dbService = new DbService(pgClient);
    const embeddingsFactory = new EmbeddingsFactory();
    const embeddings = embeddingsFactory.createEmbeddings();

    info(`Используется модель эмбеддингов: ${embeddings.constructor.name}`);

    // Получаем доступные контексты
    section('Получение доступных контекстов');
    const contexts = await dbService.getContextCodes();
    info(`Найдено контекстов: ${contexts.length}`);
    contexts.forEach(ctx => info(`  - ${ctx}`));

    if (contexts.length === 0) {
      error('Нет доступных контекстов в БД. Сначала загрузите данные.');
      return;
    }

    // Используем FULL_TEST для тестирования
    const contextCode = contexts.includes('FULL_TEST') ? 'FULL_TEST' : contexts[0];
    info(`Используем контекст: ${contextCode}`);

    // Тестовые запросы для FULL_TEST (HR система)
    const testQueries = [
      'Как работает функция validateEmployee?',
      'Какие методы есть в EmployeeService?',
      'Опиши процесс создания сотрудника'
    ];

    // Тест 1: Simple Strategy
    section('ТЕСТ 1: Simple Strategy');
    await testStrategy(
      'simple',
      testQueries[0],
      contextCode,
      dbService,
      embeddings
    );

    // Тест 2: Hierarchical Strategy
    section('ТЕСТ 2: Hierarchical Strategy');
    await testStrategy(
      'hierarchical',
      testQueries[0],
      contextCode,
      dbService,
      embeddings
    );

    // Тест 3: AI Item Strategy
    section('ТЕСТ 3: AI Item Strategy');
    await testStrategy(
      'aiitem',
      testQueries[1],
      contextCode,
      dbService,
      embeddings
    );

    // Тест 4: Форматирование контекста
    section('ТЕСТ 4: Различные стили форматирования');
    await testFormatting(
      testQueries[0],
      contextCode,
      dbService,
      embeddings
    );

    // Тест 5: Производительность
    section('ТЕСТ 5: Производительность');
    await testPerformance(
      testQueries,
      contextCode,
      dbService,
      embeddings
    );

    section('ВСЕ ТЕСТЫ ЗАВЕРШЕНЫ');
    success('Все тесты пройдены успешно!');

  } catch (err) {
    error(`Критическая ошибка: ${err.message}`);
    console.error(err);
  } finally {
    await pgClient.end();
    info('Соединение с БД закрыто');
  }
}

/**
 * Тестирование конкретной стратегии RAG
 */
async function testStrategy(strategy, query, contextCode, dbService, embeddings) {
  try {
    info(`Запрос: "${query}"`);
    info(`Стратегия: ${strategy}`);

    const ragRetriever = new RAGRetriever(dbService, embeddings, {
      strategy,
      maxChunks: 5,
      includeRelations: true
    });

    const startTime = Date.now();
    const result = await ragRetriever.retrieve(query, contextCode);
    const duration = Date.now() - startTime;

    success(`Поиск завершён за ${duration}мс`);
    info(`Найдено чанков: ${result.chunks.length}`);

    // Выводим краткую информацию о найденных чанках
    if (result.chunks.length > 0) {
      info('Найденные элементы:');
      
      result.chunks.forEach((chunk, index) => {
        if (chunk.ai_item) {
          // Hierarchical или AI Item strategy
          const aiItem = chunk.ai_item || chunk.l0?.metadata;
          console.log(`  ${index + 1}. ${aiItem?.full_name || 'Unknown'} (${aiItem?.type || 'Unknown'})`);
          
          if (chunk.l0) console.log(`     - L0: ${chunk.l0.content.substring(0, 50)}...`);
          if (chunk.l1 && chunk.l1.length > 0) console.log(`     - L1: ${chunk.l1.length} зависимостей`);
          if (chunk.l2 && chunk.l2.length > 0) console.log(`     - L2: ${chunk.l2.length} описаний`);
          if (chunk.relations && chunk.relations.length > 0) console.log(`     - Связи: ${chunk.relations.length}`);
        } else if (chunk.chunks) {
          // AI Item strategy с chunks
          console.log(`  ${index + 1}. ${chunk.ai_item?.full_name || 'Unknown'}`);
          console.log(`     - Всего чанков: ${chunk.chunks.length}`);
        } else if (chunk.content) {
          // Simple strategy
          const preview = chunk.content.substring(0, 60).replace(/\n/g, ' ');
          console.log(`  ${index + 1}. ${preview}... (similarity: ${(chunk.similarity * 100).toFixed(1)}%)`);
        }
      });
    }

    return result;

  } catch (err) {
    error(`Ошибка в стратегии ${strategy}: ${err.message}`);
    throw err;
  }
}

/**
 * Тестирование различных стилей форматирования
 */
async function testFormatting(query, contextCode, dbService, embeddings) {
  try {
    // Получаем результаты один раз
    const ragRetriever = new RAGRetriever(dbService, embeddings, {
      strategy: 'hierarchical',
      maxChunks: 3
    });

    const result = await ragRetriever.retrieve(query, contextCode);

    if (result.chunks.length === 0) {
      error('Нет чанков для форматирования');
      return;
    }

    // Тестируем разные стили
    const styles = ['compact', 'standard', 'full', 'markdown'];

    for (const style of styles) {
      info(`\nФорматирование: ${style}`);

      const contextBuilder = new ContextBuilder({
        style,
        includeFileNames: true,
        includeRelations: style !== 'compact'
      });

      const context = contextBuilder.build(result, 'hierarchical');

      console.log(`Токенов: ${context.metadata.totalTokens}`);
      console.log(`Чанков: ${context.metadata.usedChunkIds.length}`);
      console.log('\nПревью контекста:');
      console.log(context.formatted.substring(0, 300) + '...\n');
    }

    success('Все стили форматирования протестированы');

  } catch (err) {
    error(`Ошибка форматирования: ${err.message}`);
    throw err;
  }
}

/**
 * Тестирование производительности
 */
async function testPerformance(queries, contextCode, dbService, embeddings) {
  try {
    const strategies = ['simple', 'hierarchical', 'aiitem'];
    const results = {};

    for (const strategy of strategies) {
      const times = [];
      
      for (const query of queries) {
        const ragRetriever = new RAGRetriever(dbService, embeddings, {
          strategy,
          maxChunks: 5
        });

        const start = Date.now();
        await ragRetriever.retrieve(query, contextCode);
        const duration = Date.now() - start;
        
        times.push(duration);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      results[strategy] = {
        avg: avgTime.toFixed(0),
        min: Math.min(...times),
        max: Math.max(...times)
      };
    }

    info('Результаты производительности (мс):');
    console.table(results);

    success('Тест производительности завершён');

  } catch (err) {
    error(`Ошибка теста производительности: ${err.message}`);
    throw err;
  }
}

// Запуск тестов
if (require.main === module) {
  runTests()
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error('Критическая ошибка:', err);
      process.exit(1);
    });
}

module.exports = { runTests };
