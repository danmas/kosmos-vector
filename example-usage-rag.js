// example-usage-rag.js
// Примеры использования RAG-функциональности

require('dotenv').config();
const { Client } = require('pg');
const { DbService, RAGRetriever, ContextBuilder, EmbeddingsFactory } = require('./packages/core');

/**
 * ПРИМЕР 1: Простой RAG-запрос с иерархической стратегией
 */
async function example1_SimpleRAG() {
  console.log('\n=== ПРИМЕР 1: Простой RAG-запрос ===\n');
  
  const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
  await pgClient.connect();
  
  try {
    const dbService = new DbService(pgClient);
    const embeddingsFactory = new EmbeddingsFactory();
    const embeddings = embeddingsFactory.createEmbeddings();
    
    // Создаём RAGRetriever с иерархической стратегией
    const ragRetriever = new RAGRetriever(dbService, embeddings, {
      strategy: 'hierarchical',
      maxChunks: 5,
      includeRelations: true
    });
    
    // Выполняем поиск контекста
    const query = 'Как работает функция calculateTotal?';
    const contextCode = 'DEFAULT';
    
    const result = await ragRetriever.retrieve(query, contextCode);
    
    console.log(`Найдено чанков: ${result.chunks.length}`);
    console.log(`Время поиска: ${result.metadata.retrievalTime}мс`);
    
    // Форматируем контекст
    const contextBuilder = new ContextBuilder({
      style: 'standard',
      includeFileNames: true
    });
    
    const context = contextBuilder.build(result, 'hierarchical');
    
    console.log(`\nФорматированный контекст (${context.metadata.totalTokens} токенов):\n`);
    console.log(context.formatted);
    
  } finally {
    await pgClient.end();
  }
}

/**
 * ПРИМЕР 2: Сравнение различных стратегий
 */
async function example2_CompareStrategies() {
  console.log('\n=== ПРИМЕР 2: Сравнение стратегий ===\n');
  
  const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
  await pgClient.connect();
  
  try {
    const dbService = new DbService(pgClient);
    const embeddingsFactory = new EmbeddingsFactory();
    const embeddings = embeddingsFactory.createEmbeddings();
    
    const query = 'Какие функции работают с базой данных?';
    const contextCode = 'DEFAULT';
    
    const strategies = ['simple', 'hierarchical', 'aiitem'];
    
    for (const strategy of strategies) {
      console.log(`\n--- Стратегия: ${strategy} ---`);
      
      const ragRetriever = new RAGRetriever(dbService, embeddings, {
        strategy,
        maxChunks: 3
      });
      
      const startTime = Date.now();
      const result = await ragRetriever.retrieve(query, contextCode);
      const duration = Date.now() - startTime;
      
      console.log(`Чанков: ${result.chunks.length}, Время: ${duration}мс`);
    }
    
  } finally {
    await pgClient.end();
  }
}

/**
 * ПРИМЕР 3: Различные стили форматирования
 */
async function example3_FormattingStyles() {
  console.log('\n=== ПРИМЕР 3: Стили форматирования ===\n');
  
  const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
  await pgClient.connect();
  
  try {
    const dbService = new DbService(pgClient);
    const embeddingsFactory = new EmbeddingsFactory();
    const embeddings = embeddingsFactory.createEmbeddings();
    
    const ragRetriever = new RAGRetriever(dbService, embeddings, {
      strategy: 'hierarchical',
      maxChunks: 2
    });
    
    const result = await ragRetriever.retrieve(
      'Опиши функцию обработки данных',
      'DEFAULT'
    );
    
    if (result.chunks.length === 0) {
      console.log('Чанки не найдены');
      return;
    }
    
    const styles = ['compact', 'standard', 'full', 'markdown'];
    
    for (const style of styles) {
      console.log(`\n--- Стиль: ${style} ---`);
      
      const contextBuilder = new ContextBuilder({
        style,
        maxTokens: 2000
      });
      
      const context = contextBuilder.build(result, 'hierarchical');
      
      console.log(`Токенов: ${context.metadata.totalTokens}`);
      console.log(context.formatted.substring(0, 200) + '...\n');
    }
    
  } finally {
    await pgClient.end();
  }
}

/**
 * ПРИМЕР 4: Использование через API (fetch пример)
 */
function example4_APIUsage() {
  console.log('\n=== ПРИМЕР 4: Использование API ===\n');
  
  const apiExamples = {
    // 1. Получить контекст без LLM
    retrieve: {
      method: 'POST',
      url: 'http://localhost:3005/api/rag/retrieve',
      body: {
        query: 'Как работает аутентификация?',
        contextCode: 'DEFAULT',
        strategy: 'hierarchical',
        maxChunks: 5,
        formatting: {
          style: 'standard',
          includeFileNames: true,
          includeRelations: true
        }
      }
    },
    
    // 2. Получить ответ LLM с RAG
    ask: {
      method: 'POST',
      url: 'http://localhost:3005/api/rag/ask',
      body: {
        query: 'Объясни, как работает система аутентификации',
        contextCode: 'DEFAULT',
        ragConfig: {
          strategy: 'hierarchical',
          maxChunks: 10,
          formatting: {
            style: 'full',
            maxTokens: 4000
          }
        }
      }
    },
    
    // 3. Сравнить стратегии
    compare: {
      method: 'POST',
      url: 'http://localhost:3005/api/rag/compare-strategies',
      body: {
        query: 'Найди функции для работы с пользователями',
        contextCode: 'DEFAULT',
        strategies: ['simple', 'hierarchical', 'aiitem']
      }
    },
    
    // 4. Получить список стратегий
    strategies: {
      method: 'GET',
      url: 'http://localhost:3005/api/rag/strategies'
    }
  };
  
  console.log('Примеры API запросов:\n');
  console.log(JSON.stringify(apiExamples, null, 2));
}

/**
 * ПРИМЕР 5: Кастомная конфигурация RAG
 */
async function example5_CustomConfig() {
  console.log('\n=== ПРИМЕР 5: Кастомная конфигурация ===\n');
  
  const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
  await pgClient.connect();
  
  try {
    const dbService = new DbService(pgClient);
    const embeddingsFactory = new EmbeddingsFactory();
    const embeddings = embeddingsFactory.createEmbeddings();
    
    // Создаём RAG с детальной конфигурацией
    const ragRetriever = new RAGRetriever(dbService, embeddings, {
      strategy: 'hierarchical',
      maxChunks: 10,
      maxTokens: 8000,
      levels: ['0-исходник', '2-логика'], // Только код и описание, без L1
      includeRelations: true,
      expandGraph: false,
      similarityThreshold: 0.75
    });
    
    const result = await ragRetriever.retrieve(
      'Покажи все функции для работы с API',
      'DEFAULT'
    );
    
    // Форматируем с кастомными настройками
    const contextBuilder = new ContextBuilder({
      style: 'markdown',
      includeFileNames: true,
      includeRelations: true,
      includeSimilarity: true,
      maxTokens: 6000
    });
    
    const context = contextBuilder.build(result, 'hierarchical');
    
    console.log('Метаданные контекста:');
    console.log(JSON.stringify(context.metadata, null, 2));
    
  } finally {
    await pgClient.end();
  }
}

// Запуск примеров
async function runExamples() {
  try {
    // Раскомментируйте нужный пример:
    
    // await example1_SimpleRAG();
    // await example2_CompareStrategies();
    // await example3_FormattingStyles();
    example4_APIUsage();
    // await example5_CustomConfig();
    
  } catch (error) {
    console.error('Ошибка:', error);
  }
}

if (require.main === module) {
  runExamples();
}

module.exports = {
  example1_SimpleRAG,
  example2_CompareStrategies,
  example3_FormattingStyles,
  example4_APIUsage,
  example5_CustomConfig
};
