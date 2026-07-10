// Загрузка .env с явным путём (для корректной работы с pm2)
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const { writeToFile } = require('./packages/core/logger');

// === SSE LOGGING SYSTEM WITH SESSION SUPPORT ===
// Глобальный буфер логов (в памяти)
// Структура: массив объектов { id, timestamp, level, message, sessionId? }
// Новые логи добавляются в начало массива (unshift)
const MAX_LOG_LINES = 1000;
const serverLogs = [];

// Подписчики на SSE поток логов
const logsSseConnections = new Set();

const process_cwd = process.cwd ();
const process_env_PORT = process.env.PORT;
console.log(`*********************************************`);
console.log(`**${process_cwd}***`);
console.log(`**${process_env_PORT}***`);
console.log(`*********************************************`);
  
// Директория для сохранения сессий логов
const SESSIONS_DIR = path.join(process.cwd(), 'data', 'logs', 'sessions');

// Создаём директорию для сессий при старте
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  console.log(`[Logs] Создана директория для сессий: ${SESSIONS_DIR}`);
}

// Экспортируем для использования в маршрутах (до require routes/api)
/**
 * Добавить лог из внешнего источника (например, SSE от сервера данных)
 * @param {object} logEntry - Объект лога с полями {id, timestamp, level, message, sessionId}
 */
function addLogFromExternal(logEntry) {
  if (!logEntry || !logEntry.id) {
    // Если нет id, генерируем
    logEntry.id = Date.now().toString() + Math.random().toString().slice(2);
  }

  // Добавляем в начало массива (новые сверху)
  serverLogs.unshift(logEntry);

  // Обрезаем буфер с конца
  if (serverLogs.length > MAX_LOG_LINES) {
    serverLogs.pop();
  }

  // Рассылаем через SSE всем подписчикам
  if (logsSseConnections.size > 0) {
    const data = `data: ${JSON.stringify({
      type: 'log',
      log: logEntry,
      timestamp: Date.now()
    })}\n\n`;

    logsSseConnections.forEach(res => {
      try {
        res.write(data);
      } catch (error) {
        // Клиент отключился, удаляем из подписчиков
        logsSseConnections.delete(res);
      }
    });
  }
}

module.exports.serverLogs = serverLogs;
module.exports.logsSseConnections = logsSseConnections;
module.exports.getLogsBySession = getLogsBySession;
module.exports.saveSessionLogs = saveSessionLogs;
module.exports.addLogFromExternal = addLogFromExternal;
module.exports.SESSIONS_DIR = SESSIONS_DIR;

// Перехватываем console.log, console.error и т.д.
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function addLog(level, message, sessionId = null, ...args) {
  const timestamp = new Date().toISOString();
  const formattedArgs = args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');

  const fullMessage = message + (formattedArgs ? ' ' + formattedArgs : '');

  // Записываем в файл logs/combined-YYYY-MM-DD.log (и error.log для ERROR)
  writeToFile(level, 'SERVER', fullMessage);

  // Сохраняем структурированный объект с уникальным id и опциональным sessionId
  const logEntry = {
    id: Date.now().toString() + Math.random().toString().slice(2),
    timestamp: timestamp,
    level: level,
    message: fullMessage,
    sessionId: sessionId || null
  };

  // Добавляем в начало массива (новые сверху)
  serverLogs.unshift(logEntry);

  // Обрезаем буфер с конца
  if (serverLogs.length > MAX_LOG_LINES) {
    serverLogs.pop();
  }

  // Выводим в консоль как обычно (используем process.stdout чтобы избежать рекурсии)
  process.stdout.write(`[${level}] ${logEntry.message}\n`);

  // Рассылаем через SSE всем подписчикам
  if (logsSseConnections.size > 0) {
    const data = `data: ${JSON.stringify({
      type: 'log',
      log: logEntry,
      timestamp: Date.now()
    })}\n\n`;

    logsSseConnections.forEach(res => {
      try {
        res.write(data);
      } catch (error) {
        // Клиент отключился, удаляем из подписчиков
        logsSseConnections.delete(res);
      }
    });
  }
}

/**
 * Получить все логи для конкретной сессии
 * @param {string} sessionId - ID сессии
 * @returns {Array} Массив логов сессии
 */
function getLogsBySession(sessionId) {
  if (!sessionId) return [];
  return serverLogs.filter(log => log.sessionId === sessionId);
}

/**
 * Сохранить логи сессии на диск
 * @param {string} sessionId - ID сессии
 * @param {string} contextCode - Код контекста
 * @param {number} stepId - ID шага
 * @param {object} stepData - Данные шага из pipelineStateManager
 * @returns {Promise<object>} Информация о сохранённой сессии
 */
async function saveSessionLogs(sessionId, contextCode, stepId, stepData) {
  if (!sessionId) {
    throw new Error('sessionId is required');
  }

  try {
    // Получаем все логи сессии
    const sessionLogs = getLogsBySession(sessionId);

    // Сортируем логи по времени (старые → новые)
    const sortedLogs = [...sessionLogs].sort((a, b) =>
      new Date(a.timestamp) - new Date(b.timestamp)
    );

    // Подсчитываем статистику
    const summary = {
      totalLogs: sortedLogs.length,
      infoCount: sortedLogs.filter(log => log.level === 'INFO').length,
      warnCount: sortedLogs.filter(log => log.level === 'WARN').length,
      errorCount: sortedLogs.filter(log => log.level === 'ERROR').length
    };

    // Получаем имя шага
    const stepName = stepData.name || `step_${stepId}`;

    // Формируем объект сессии
    const sessionData = {
      sessionId: sessionId,
      contextCode: contextCode,
      stepId: stepId,
      stepName: stepName,
      startedAt: stepData.startedAt || null,
      completedAt: stepData.completedAt || null,
      status: stepData.status || 'unknown',
      logs: sortedLogs,
      summary: summary,
      stepReport: stepData.report || null
    };

    // Сохраняем в файл
    const sessionFilePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    fs.writeFileSync(sessionFilePath, JSON.stringify(sessionData, null, 2), 'utf-8');

    console.log(`[Logs] Сессия ${sessionId} сохранена: ${sortedLogs.length} логов`);

    return sessionData;
  } catch (error) {
    console.error(`[Logs] Ошибка сохранения сессии ${sessionId}:`, error.message);
    throw error;
  }
}

// Глобальный контекст для передачи sessionId через все вызовы console.log
// Используется AsyncLocalStorage для изоляции контекста между запросами
const { AsyncLocalStorage } = require('async_hooks');
const logContext = new AsyncLocalStorage();

// Экспортируем logContext для использования в других модулях
module.exports.logContext = logContext;

function _serializeArg(a) {
  if (a instanceof Error) {
    return a.stack || `${a.name}: ${a.message}`;
  }
  if (typeof a === 'object' && a !== null) {
    try { return JSON.stringify(a); } catch { return String(a); }
  }
  return String(a);
}

// Обёртки для console.log/error/warn с поддержкой sessionId из контекста
console.log = (...args) => {
  const sessionId = logContext.getStore()?.sessionId || null;
  const message = args.map(_serializeArg).join(' ');
  addLog('INFO', message, sessionId);
};

console.error = (...args) => {
  const sessionId = logContext.getStore()?.sessionId || null;
  const message = args.map(_serializeArg).join(' ');
  addLog('ERROR', message, sessionId);
};

console.warn = (...args) => {
  const sessionId = logContext.getStore()?.sessionId || null;
  const message = args.map(_serializeArg).join(' ');
  addLog('WARN', message, sessionId);
};

// Добавляем стартовое сообщение
console.log('Server started — log buffer initialized');

const express = require('express');
const { Pool } = require('pg');
const { DbService, EmbeddingsFactory, PostgresVectorStore } = require('./packages/core');
const { checkLLMAvailability, KOSMOS_BASE_URL, KOSMOS_MODEL, callLLM } = require('./packages/core/llmClient');

// Import db-core components for optional advanced usage
const { Database, Migrator, FilesRepository, VectorRepository, AiItemsRepository } = require('@kosmos-vector/db-core');

const aiRoutes = require('./routes/ai');
const filesRoutes = require('./routes/files');
const chatRoutes = require('./routes/chat');
const promptsRoutes = require('./routes/prompts');

const cors = require('cors');

const app = express();
if(process.env.PORT!='3200') {
  console.log('NOT READ process.env.PORT&! ');
} 

const port = process.env.PORT || 3200;
app.use(cors()); // Разрешает всё (удобно для разработки)

// Добавляем middleware для раздачи статических файлов из папки 'kosmos'
app.use(express.static('kosmos'));

app.use(express.json()); // Для парсинга JSON в теле запроса

// Middleware для логирования HTTP запросов
app.use((req, res, next) => {
  // Пропускаем SSE endpoints и статику
  if (req.path === '/api/logs/stream' || req.path === '/server-info' || !req.path.startsWith('/api')) {
    return next();
  }
  
  // Пропускаем частые запросы статуса pipeline (забивают лог)
  if (req.path === '/api/pipeline/steps/status' && req.query['context-code']) {
    return next();
  }
  
  const start = Date.now();
  const method = req.method;
  const url = req.originalUrl;
  
  // Логируем входящий запрос
  // console.log(`[API] → ${method} ${url}`);
  
  // Перехватываем завершение ответа
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const statusIcon = status < 400 ? '✓' : '✗';
    // console.log(`[API] ← ${method} ${url} ${statusIcon} ${status} (${duration}ms)`);
  });
  
  next();
});

// Обработчик ошибок для некорректного JSON
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON in request body'
    });
  }
  next(err);
});

// Инициализация клиента PostgreSQL
// Поддерживает как DATABASE_URL, так и отдельные PG* переменные
const pgConfig = process.env.DATABASE_URL 
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD
    };

const PG_CONNECTION_TIMEOUT_MS = 10000;
const PG_IDLE_TIMEOUT_MS = 30000;

const pgClient = new Pool({
  ...pgConfig,
  options: '-csearch_path=kosmos,public',  // Схема kosmos первая в search_path
  max: 5,
  idleTimeoutMillis: PG_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

pgClient.on('error', (err) => {
  console.error('[PostgreSQL Pool] Idle client error (векторная БД):', err.message);
});

// db-core Database переиспользует тот же Pool (один пул на всё приложение)
const database = new Database(pgClient);
const filesRepo = new FilesRepository(database);
const vectorRepo = new VectorRepository(database);
const aiItemsRepo = new AiItemsRepository(database);

// Инициализация сервиса БД из нашего ядра с инъекцией репозиториев
const dbService = new DbService(pgClient, {
  database: database,
  filesRepository: filesRepo,
  vectorRepository: vectorRepo,
  aiItemsRepository: aiItemsRepo
});

// Инициализация фабрики эмбеддингов
const embeddingsFactory = new EmbeddingsFactory();
const embeddings = embeddingsFactory.createEmbeddings();

// Инициализация векторного хранилища
const vectorStore = new PostgresVectorStore(embeddings, dbService);

// Подключаем роуты для Natural Query Engine (agent scripts) ПЕРЕД apiRouter
// чтобы избежать конфликта с validateContextCode middleware
const agentScriptRoutes = require('./routes/agentScript');
app.use('/api', agentScriptRoutes(dbService, embeddings));

// Подключаем роуты для Prompts Config ПЕРЕД apiRouter (не требует context-code)
const promptsConfigRoutes = require('./routes/promptsConfig');
app.use('/api', promptsConfigRoutes(dbService));

const apiRouter = require('./routes/api')(dbService, serverLogs, embeddings);
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

// Подключаем роуты для промптов
app.use('/api/prompts', promptsRoutes);

// Подключаем роуты для чата
app.use('/api', chatRoutes(dbService, vectorStore, embeddings));

// Подключаем роуты для RAG
const ragRoutes = require('./routes/rag');
app.use('/api/rag', ragRoutes(dbService, vectorStore, embeddings));

// Подключаем роуты для Graph Snapshots
const graphSnapshotsRoutes = require('./routes/graphSnapshots');
app.use('/api/graph-snapshots', graphSnapshotsRoutes(dbService));

// Онтология: валидация консистентности (см. KB/README_ONTO_LOADING.md)
const ontologyRoutes = require('./routes/ontology');
app.use('/api/ontology', ontologyRoutes(dbService, embeddings));

// Конфигурация моделей для UI (DEPRECATED - используйте /api/config из routes/api.js)
app.get('/api/ui-config', (req, res) => {
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
    // Используем KOSMOS_BASE_URL (обрезаем /v1 для REST-эндпоинтов)
    const baseUrl = KOSMOS_BASE_URL();
    if (!baseUrl) {
      return res.json({
        models: [
          { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo (mock)', default: true },
          { id: 'gpt-4', name: 'GPT-4 (mock)' },
          { id: 'local', name: 'Local Model' }
        ]
      });
    }

    // Пытаемся получить список моделей с внешнего сервера
    const serverOrigin = new URL(baseUrl).origin; // http://localhost:3002
    const response = await fetch(`${serverOrigin}/api/available-models`);
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

let server;

pgClient.query('SELECT 1')
  .then(() => {
    console.log('[PostgreSQL] Подключение проверено (Pool, единый на всё приложение)');
  })
  .then(() => {
    server = app.listen(port, async () => {
      console.log(`Server v2 listening at http://localhost:${port}`);
  
  // Проверка доступности LLM сервера
  console.log('Проверка доступности LLM сервера...');
  const isLLMAvailable = await checkLLMAvailability();
  if (isLLMAvailable) {
    console.log('✅ LLM сервер (kosmos-model) доступен');
    
    // Тестовый запрос для проверки работоспособности
    try {
      console.log('Проверка работоспособности LLM...');
      const testMessages = [
        { role: 'user', content: 'Какая ты модель? Ответь коротко.' }
      ];
      const testResponse = await callLLM(testMessages);
      console.log(`✅ LLM ответил: ${testResponse.trim()}`);
    } catch (error) {
      console.warn(`⚠️  LLM сервер доступен, но запрос не выполнен: ${error.message}`);
      
      // Логируем детали запроса для отладки
      const requestBody = {
        model: KOSMOS_MODEL(),
        messages: [
          { role: 'user', content: 'Какая ты модель? Ответь коротко.' }
        ],
        temperature: 0.3
      };
      
      const requestHeaders = {
        "Content-Type": "application/json"
      };
      
      if (process.env.KOSMOS_API_KEY) {
        requestHeaders["Authorization"] = "Bearer [скрыто]";
      }
      
      console.error('📤 Отправленный запрос к LLM:');
      console.error(`   URL: ${KOSMOS_BASE_URL()}/chat/completions`);
      console.error(`   Method: POST`);
      console.error(`   Headers:`, JSON.stringify(requestHeaders, null, 2));
      console.error(`   Body:`, JSON.stringify(requestBody, null, 2));
    }
  } else {
    console.warn('⚠️  LLM сервер (kosmos-model) недоступен!');
    console.warn('⚠️  Маршрут /api/chat может не работать корректно.');
    console.warn(`⚠️  Проверьте настройки KOSMOS_BASE_URL (текущее: ${KOSMOS_BASE_URL()})`);
  }
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
  })
  .catch((err) => {
    const dbLabel = process.env.DATABASE_URL ? 'DATABASE_URL (векторная БД)' : 'PGHOST/PGPORT (векторная БД)';
    console.error(`[SERVER] PostgreSQL: подключение не удалось: ${err.message}`);
    console.error(`[SERVER] Сервер: ${dbLabel}. Таймаут подключения: ${PG_CONNECTION_TIMEOUT_MS} мс, idle: ${PG_IDLE_TIMEOUT_MS} мс`);
    process.exit(1);
  });

// Graceful shutdown — закрываем Pool при завершении процесса (bun --watch, SIGTERM, etc.)
function gracefulShutdown(signal) {
  pgClient.end().catch(() => {});
  if (server) server.close();
  process.exit(0);
}
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.on('beforeExit', () => pgClient.end().catch(() => {}));