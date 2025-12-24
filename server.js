require('dotenv').config();

// Глобальный буфер логов (в памяти)
// Структура: массив объектов { timestamp, level, message }
const LOG_BUFFER = [];
const MAX_LOG_LINES = 1000; // Чтобы не жрать бесконечно память

// Подписчики на SSE поток логов
const logSubscribers = new Set();

// Экспортируем для использования в маршрутах (до require routes/api)
module.exports.LOG_BUFFER = LOG_BUFFER;
module.exports.logSubscribers = logSubscribers;

// Перехватываем console.log, console.error и т.д.
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function addLog(level, ...args) {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
  
  // Сохраняем структурированный объект вместо строки
  const logEntry = {
    timestamp: timestamp,
    level: level,
    message: message
  };
  
  LOG_BUFFER.push(logEntry);
  
  // Обрезаем буфер
  if (LOG_BUFFER.length > MAX_LOG_LINES) {
    LOG_BUFFER.shift();
  }
  
  // Отправляем новое событие всем подписчикам SSE
  logSubscribers.forEach(res => {
    try {
      res.write(`data: ${JSON.stringify(logEntry)}\n\n`);
    } catch (err) {
      // Клиент отключился, удаляем из подписчиков
      logSubscribers.delete(res);
    }
  });
  
  // Оригинальный вывод в консоль
  if (level === 'ERROR') originalError(...args);
  else if (level === 'WARN') originalWarn(...args);
  else originalLog(...args);
}

console.log = (...args) => addLog('INFO', ...args);
console.error = (...args) => addLog('ERROR', ...args);
console.warn = (...args) => addLog('WARN', ...args);

// Добавляем стартовое сообщение
console.log('Server started — log buffer initialized');

const express = require('express');
const { Client } = require('pg');
const { DbService, EmbeddingsFactory, PostgresVectorStore } = require('@aian-vector/core');
const path = require('path');
const aiRoutes = require('./routes/ai');
const filesRoutes = require('./routes/files');

const cors = require('cors');

const app = express();
const port = process.env.PORT || 3001;
app.use(cors()); // Разрешает всё (удобно для разработки)

// Добавляем middleware для раздачи статических файлов из папки 'public'
app.use(express.static('public'));

app.use(express.json()); // Для парсинга JSON в теле запроса

// Инициализация клиента PostgreSQL
const pgClient = new Client({
  connectionString: process.env.DATABASE_URL,
});

pgClient.connect();

// Инициализация сервиса БД из нашего ядра
const dbService = new DbService(pgClient);

// Инициализация фабрики эмбеддингов
const embeddingsFactory = new EmbeddingsFactory();
const embeddings = embeddingsFactory.createEmbeddings();

// Инициализация векторного хранилища
const vectorStore = new PostgresVectorStore(embeddings, dbService);

const apiRouter = require('./routes/api')(dbService, LOG_BUFFER);;
app.use('/api', apiRouter);

// Информация о сервере
app.get('/server-info', (req, res) => {
  const info = {
    baseUrl: `http://${req.hostname}:${port}`,
    hostname: req.hostname,
    port: port,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    uptime: process.uptime(),
    appName: 'AIAN Vector',
    env: {
      NODE_ENV: process.env.NODE_ENV || 'development',
      USE_OPENAI: process.env.USE_OPENAI === 'true',
      DOCS_DIR: process.env.DOCS_DIR || 'docs'
    }
  };
  res.json(info);
});

// Подключаем роуты для AI
app.use(aiRoutes(dbService, vectorStore, embeddings));

// Подключаем роуты для файлов
app.use(filesRoutes(dbService, embeddings));

// Конфигурация для UI
app.get('/api/config', (req, res) => {
  try {
    const config = {
      models: [
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', default: true },
        { id: 'gpt-4', name: 'GPT-4' },
        { id: 'local', name: 'Local Model' }
      ],
      sqlTemplates: {
        L1: process.env.SQL_L1_TEMPLATE || 'Опишите связи между таблицами',
        L2: process.env.SQL_L2_TEMPLATE || 'Опишите логику работы с данными'
      }
    };
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Прокси для получения доступных моделей
app.get('/api/available-models', async (req, res) => {
  try {
    // Проверяем, настроен ли URL для запросов к внешнему серверу
    const reqServerUrl = process.env.REQ_SERVER_URL;
    if (!reqServerUrl) {
      return res.json({
        models: [
          { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo (mock)', default: true },
          { id: 'gpt-4', name: 'GPT-4 (mock)' },
          { id: 'local', name: 'Local Model' }
        ]
      });
    }

    // Пытаемся получить список моделей с внешнего сервера
    const response = await fetch(`${reqServerUrl}/api/available-models`);
    if (!response.ok) {
      throw new Error(`External server responded with status: ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching available models:', error);
    res.status(500).json({ 
      error: error.message,
      models: [
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo (fallback)', default: true },
        { id: 'gpt-4', name: 'GPT-4 (fallback)' }
      ] 
    });
  }
});

const server = app.listen(port, () => {
  console.log(`Server v2 listening at http://localhost:${port}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nОшибка: Порт ${port} уже занят!`);
    console.error(`Используйте другой порт, установив переменную PORT в .env файле, или остановите процесс, использующий порт ${port}`);
    process.exit(1);
  } else {
    console.error('Ошибка при запуске сервера:', err);
    process.exit(1);
  }
});