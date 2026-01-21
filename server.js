require('dotenv').config();
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

// Обёртки для console.log/error/warn с поддержкой sessionId из контекста
console.log = (...args) => {
  const sessionId = logContext.getStore()?.sessionId || null;
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  addLog('INFO', message, sessionId);
};

console.error = (...args) => {
  const sessionId = logContext.getStore()?.sessionId || null;
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  addLog('ERROR', message, sessionId);
};

console.warn = (...args) => {
  const sessionId = logContext.getStore()?.sessionId || null;
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  addLog('WARN', message, sessionId);
};

// Добавляем стартовое сообщение
console.log('Server started — log buffer initialized');

const express = require('express');
const { Client } = require('pg');
const { DbService, EmbeddingsFactory, PostgresVectorStore } = require('./packages/core');
const { checkLLMAvailability, LLM_BASE_URL, LLM_MODEL, callLLM } = require('./packages/core/llmClient');
const aiRoutes = require('./routes/ai');
const filesRoutes = require('./routes/files');
const chatRoutes = require('./routes/chat');
const promptsRoutes = require('./routes/prompts');

const cors = require('cors');

const app = express();
const port = process.env.PORT || 3001;
app.use(cors()); // Разрешает всё (удобно для разработки)

// Добавляем middleware для раздачи статических файлов из папки 'public'
app.use(express.static('public'));

app.use(express.json()); // Для парсинга JSON в теле запроса

// Middleware для логирования HTTP запросов
app.use((req, res, next) => {
  // Пропускаем SSE endpoints и статику
  if (req.path === '/api/logs/stream' || req.path === '/server-info' || !req.path.startsWith('/api')) {
    return next();
  }
  
  const start = Date.now();
  const method = req.method;
  const url = req.originalUrl;
  
  // Логируем входящий запрос
  console.log(`[API] → ${method} ${url}`);
  
  // Перехватываем завершение ответа
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const statusIcon = status < 400 ? '✓' : '✗';
    console.log(`[API] ← ${method} ${url} ${statusIcon} ${status} (${duration}ms)`);
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

// Подключаем роуты для Natural Query Engine (agent scripts) ПЕРЕД apiRouter
// чтобы избежать конфликта с validateContextCode middleware
const agentScriptRoutes = require('./routes/agentScript');
app.use('/api', agentScriptRoutes(dbService, embeddings));

const apiRouter = require('./routes/api')(dbService, serverLogs);
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

const server = app.listen(port, async () => {
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
        model: LLM_MODEL(),
        messages: [
          { role: 'user', content: 'Какая ты модель? Ответь коротко.' }
        ],
        temperature: 0.3
      };
      
      const requestHeaders = {
        "Content-Type": "application/json"
      };
      
      if (process.env.LLM_API_KEY) {
        requestHeaders["Authorization"] = "Bearer [скрыто]";
      }
      
      console.error('📤 Отправленный запрос к LLM:');
      console.error(`   URL: ${LLM_BASE_URL()}/chat/completions`);
      console.error(`   Method: POST`);
      console.error(`   Headers:`, JSON.stringify(requestHeaders, null, 2));
      console.error(`   Body:`, JSON.stringify(requestBody, null, 2));
    }
  } else {
    console.warn('⚠️  LLM сервер (kosmos-model) недоступен!');
    console.warn('⚠️  Маршрут /api/chat может не работать корректно.');
    console.warn(`⚠️  Проверьте настройки LLM_BASE_URL (текущее: ${LLM_BASE_URL()})`);
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