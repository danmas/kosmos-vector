// example-usage.js
import dotenv from 'dotenv';
import pg from 'pg';
import { DbService, PostgresVectorStore, vectorizeFile } from './microservices/common-service/src/index.js';
import { SimpleEmbeddings, answerQuestion as simpleAnswerQuestion } from './microservices/simple-service/src/index.js';
import { OpenAIEmbeddingsWrapper, answerQuestion as openaiAnswerQuestion } from './microservices/openai-service/src/index.js';

// Загрузка переменных окружения
dotenv.config();

// Инициализация клиента PostgreSQL
const pgClient = new pg.Client({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'postgres',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres'
});

async function main() {
  try {
    // Подключение к базе данных
    await pgClient.connect();
    console.log('Подключение к PostgreSQL установлено');

    // Инициализация DbService
    const dbService = new DbService(pgClient, {
      docsDir: './docs' // Путь к директории с документами
    });

    // Инициализация схемы базы данных
    await dbService.initializeSchema();

    // Выбор модели эмбеддингов (SimpleEmbeddings или OpenAIEmbeddingsWrapper)
    let embeddingsModel;
    
    if (process.env.USE_OPENAI === 'true') {
      // Использование OpenAI для эмбеддингов
      embeddingsModel = new OpenAIEmbeddingsWrapper();
      console.log('Используется OpenAI для эмбеддингов');
    } else {
      // Использование простой модели для эмбеддингов
      embeddingsModel = new SimpleEmbeddings();
      console.log('Используется SimpleEmbeddings для эмбеддингов');
    }

    // Инициализация векторного хранилища
    const vectorStore = new PostgresVectorStore(embeddingsModel, dbService);

    // Пример векторизации файла
    const fileName = 'example.txt';
    try {
      const result = await vectorizeFile(
        fileName,
        dbService,
        embeddingsModel,
        vectorStore,
        'EXAMPLE', // Код контекста
        { chunkSize: 300, chunkOverlap: 50 } // Параметры векторизации
      );
      console.log('Результат векторизации:', result);
    } catch (error) {
      console.error('Ошибка при векторизации файла:', error);
    }

    // Пример ответа на вопрос с использованием SimpleEmbeddings
    const simpleQuestion = 'Что такое векторное хранилище?';
    try {
      const simpleAnswer = await simpleAnswerQuestion(
        simpleQuestion,
        vectorStore,
        'EXAMPLE', // Код контекста
        true // Возвращать документы и промпт
      );
      console.log('Ответ (Simple):', simpleAnswer.text);
    } catch (error) {
      console.error('Ошибка при ответе на вопрос (Simple):', error);
    }

    // Пример ответа на вопрос с использованием OpenAI (если доступен)
    if (process.env.USE_OPENAI === 'true') {
      const openaiQuestion = 'Как работает векторное хранилище?';
      try {
        const openaiAnswer = await openaiAnswerQuestion(
          openaiQuestion,
          vectorStore,
          'EXAMPLE', // Код контекста
          true, // Возвращать документы и промпт
          { temperature: 0.3 } // Конфигурация модели
        );
        console.log('Ответ (OpenAI):', openaiAnswer.text);
      } catch (error) {
        console.error('Ошибка при ответе на вопрос (OpenAI):', error);
      }
    }

  } catch (error) {
    console.error('Ошибка в основном процессе:', error);
  } finally {
    // Закрытие соединения с базой данных
    await pgClient.end();
    console.log('Соединение с PostgreSQL закрыто');
  }
}

// Запуск основной функции
main().catch(console.error); 