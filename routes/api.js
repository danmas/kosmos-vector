// API для kosmos-UI (aiitem-rag-architect)
// routes/api.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const { Minimatch } = require('minimatch');

const pipelineStateManager = require('./pipelineState');
const pipelineHistoryManager = require('./pipelineHistory');
const kbConfigService = require('../packages/core/kbConfigService');
const pipelineConfigService = require('../packages/core/pipelineConfigService');

// Импортируем serverLogs, logsSseConnections и функции для работы с сессиями
const { serverLogs, logsSseConnections, getLogsBySession, saveSessionLogs } = require('../server');

const router = express.Router();

module.exports = (dbService, logBuffer) => {

  // === Маршруты логов (БЕЗ валидации context-code, логи глобальные) ===
  router.get('/logs', (req, res) => {
    try {
      if (!serverLogs || !Array.isArray(serverLogs)) {
        return res.status(500).json({
          success: false,
          error: 'Log buffer not available'
        });
      }

      let { lines = 50 } = req.query;
      lines = Math.min(Math.max(parseInt(lines) || 50, 1), 500);

      // serverLogs хранится в обратном порядке (новые в начале),
      // берём первые N и разворачиваем для хронологического порядка
      const logsToSend = serverLogs.slice(0, lines).reverse();

      res.json({
        success: true,
        total: serverLogs.length,
        returned: logsToSend.length,
        logs: logsToSend
      });
    } catch (error) {
      console.error('[API/LOGS] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === SSE поток логов (БЕЗ валидации context-code) ===
  router.get('/logs/stream', (req, res) => {
    try {
      // SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
        'X-Accel-Buffering': 'no' // отключаем буферизацию в nginx
      });

      // Добавляем соединение в подписчики
      logsSseConnections.add(res);
      console.log('SSE client connected for logs');

      // Отправляем подтверждение подключения
      res.write(`data: ${JSON.stringify({
        type: 'connected',
        timestamp: Date.now()
      })}\n\n`);

      // Отправляем последние 100 логов (в хронологическом порядке)
      const recentLogs = serverLogs.slice(0, 100).reverse();
      recentLogs.forEach(log => {
        res.write(`data: ${JSON.stringify({
          type: 'log',
          log: log,
          timestamp: Date.now()
        })}\n\n`);
      });

      // Обработка отключения клиента
      req.on('close', () => {
        console.log('SSE client disconnected');
        logsSseConnections.delete(res);
      });

      // Обработка ошибок
      req.on('error', (err) => {
        console.error('[API/LOGS/STREAM] Ошибка соединения:', err);
        logsSseConnections.delete(res);
      });

    } catch (error) {
      console.error('[API/LOGS/STREAM] Ошибка:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    }
  });

  // === Маршрут для получения списка context codes (БЕЗ валидации context-code) ===
  router.get('/contexts', async (req, res) => {
    try {
      const contexts = await kbConfigService.getAllContextCodes();
      
      res.json({
        success: true,
        contexts: contexts
      });
    } catch (error) {
      console.error('[API/CONTEXTS] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get context codes list'
      });
    }
  });

  // Middleware для валидации обязательного параметра context-code
  const validateContextCode = (req, res, next) => {
    const contextCode = req.query['context-code'] || req.query.contextCode;

    if (!contextCode) {
      return res.status(400).json({
        success: false,
        error: 'Missing required query parameter: context-code'
      });
    }

    // Нормализуем параметр для использования в обработчиках
    req.contextCode = contextCode;
    next();
  };

  // Применяем middleware ко всем ОСТАЛЬНЫМ маршрутам
  router.use(validateContextCode);

  // === 1. Health check ===
  router.get('/health', async (req, res) => {
    try {
      // Простая проверка подключения к БД
      await dbService.pgClient.query('SELECT 1');
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '2.1.1' // Можно вынести в package.json
      });
    } catch (error) {
      console.error('[API/HEALTH] DB connection failed:', error);
      res.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: 'Database unavailable'
      });
    }
  });

  // === Статистика дашборда ===
  router.get('/stats', async (req, res) => {
    try {
      const stats = await dbService.getDashboardStats(req.contextCode);
      res.json(stats);
    } catch (error) {
      console.error('[API/STATS] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === DEPRECATED: старый эндпоинт дерева файлов ===
  router.get('/files', (req, res) => {
    res.status(410).json({
      success: false,
      error: 'Endpoint /api/files is deprecated. Use /api/project/tree instead.',
      deprecated: true,
      newEndpoint: '/api/project/tree'
    });
    // context-code валидирован через middleware, доступен как req.contextCode
  });

  // === 2. Все AiItems (агрегированные) ===
  router.get('/items', async (req, res) => {
    try {
      const items = await dbService.getAllFullAiItems(req.contextCode || null);
      res.json(items);
    } catch (error) {
      console.error('[API/ITEMS] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === 3. Конкретный AiItem по full_name (id в контракте) ===
  router.get('/items/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const decodedId = decodeURIComponent(id); // full_name может содержать точки, слеши и т.д.

      const item = await dbService.getFullAiItemByFullName(decodedId, req.contextCode || null);
      if (!item) {
        return res.status(404).json({ 
          success: false, 
          error: 'AiItem not found',
          message: `AiItem "${decodedId}" not found for context-code "${req.contextCode || 'null'}". Check if the item exists with a different context-code.`
        });
      }

      res.json(item);
    } catch (error) {
      console.error('[API/ITEM] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === 3.1. GET /api/items/:id/comment - Получить комментарий для AiItem ===
  router.get('/items/:id/comment', async (req, res) => {
    try {
      const { id } = req.params;
      const decodedId = decodeURIComponent(id);
      const contextCode = req.contextCode;

      const comment = await dbService.getAiComment(contextCode, decodedId);
      if (!comment) {
        return res.status(404).json({ 
          success: false, 
          error: `Comment not found for item: ${decodedId}` 
        });
      }

      res.json({
        success: true,
        itemId: decodedId,
        ...comment
      });
    } catch (error) {
      console.error('[API/COMMENT] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === 3.2. POST /api/items/:id/comment - Создать комментарий для AiItem ===
  router.post('/items/:id/comment', async (req, res) => {
    try {
      const { id } = req.params;
      const decodedId = decodeURIComponent(id);
      const contextCode = req.contextCode;
      const { comment } = req.body;

      if (!comment || typeof comment !== 'string') {
        return res.status(400).json({ 
          success: false, 
          error: 'Comment is required and must be a string' 
        });
      }

      const result = await dbService.createAiComment(contextCode, decodedId, comment);
      res.json({
        success: true,
        itemId: decodedId,
        ...result
      });
    } catch (error) {
      console.error('[API/COMMENT] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === 3.3. PUT /api/items/:id/comment - Обновить комментарий для AiItem ===
  router.put('/items/:id/comment', async (req, res) => {
    try {
      const { id } = req.params;
      const decodedId = decodeURIComponent(id);
      const contextCode = req.contextCode;
      const { comment } = req.body;

      if (!comment || typeof comment !== 'string') {
        return res.status(400).json({ 
          success: false, 
          error: 'Comment is required and must be a string' 
        });
      }

      const result = await dbService.updateAiComment(contextCode, decodedId, comment);
      if (!result) {
        return res.status(404).json({ 
          success: false, 
          error: `Comment not found for item: ${decodedId}` 
        });
      }

      res.json({
        success: true,
        itemId: decodedId,
        ...result
      });
    } catch (error) {
      console.error('[API/COMMENT] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === 3.4. DELETE /api/items/:id/comment - Удалить комментарий для AiItem ===
  router.delete('/items/:id/comment', async (req, res) => {
    try {
      const { id } = req.params;
      const decodedId = decodeURIComponent(id);
      const contextCode = req.contextCode;

      const deleted = await dbService.deleteAiComment(contextCode, decodedId);
      if (!deleted) {
        return res.status(404).json({ 
          success: false, 
          error: `Comment not found for item: ${decodedId}` 
        });
      }

      res.json({
        success: true,
        message: `Comment deleted successfully for item: ${decodedId}`
      });
    } catch (error) {
      console.error('[API/COMMENT] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === 3.5. GET /api/items/:id/logic-graph - Получить анализ логики для AiItem ===
  router.get('/items/:id/logic-graph', async (req, res) => {
    try {
      const { id } = req.params;
      const decodedId = decodeURIComponent(id);
      const contextCode = req.contextCode;

      // Проверяем существование AiItem
      const item = await dbService.getFullAiItemByFullName(decodedId, contextCode || null);
      if (!item) {
        return res.status(404).json({ 
          success: false, 
          error: `AiItem not found: ${decodedId}` 
        });
      }

      // Получаем logic-graph
      const logicGraph = await dbService.getLogicGraphByAiItem(decodedId, contextCode || null);
      
      if (!logicGraph) {
        return res.status(404).json({ 
          success: false, 
          error: `Logic analysis not found for item: ${decodedId}` 
        });
      }

      res.json({
        success: true,
        itemId: decodedId,
        logicGraph: {
          logic: logicGraph.logic,
          graph: logicGraph.graph
        },
        savedAt: logicGraph.savedAt,
        updatedAt: logicGraph.updatedAt
      });
    } catch (error) {
      console.error('[API/ITEMS/:ID/LOGIC-GRAPH] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === 3.2. POST /api/items/:id/logic-graph - Сохранить анализ логики для AiItem ===
  router.post('/items/:id/logic-graph', async (req, res) => {
    try {
      const { id } = req.params;
      const decodedId = decodeURIComponent(id);
      const contextCode = req.contextCode;
      const { logic, graph } = req.body;

      // Валидация
      if (!logic || !graph) {
        return res.status(400).json({ 
          success: false, 
          error: 'Both "logic" and "graph" fields are required' 
        });
      }

      // Проверяем существование AiItem
      const item = await dbService.getFullAiItemByFullName(decodedId, contextCode || null);
      if (!item) {
        return res.status(404).json({ 
          success: false, 
          error: `AiItem not found: ${decodedId}` 
        });
      }

      // Сохраняем logic-graph
      const result = await dbService.saveLogicGraph(decodedId, logic, graph, contextCode || null);

      res.json({
        success: true,
        itemId: decodedId,
        logicGraph: {
          logic,
          graph
        },
        savedAt: result.savedAt,
        updatedAt: result.updatedAt
      });
    } catch (error) {
      console.error('[API/ITEMS/:ID/LOGIC-GRAPH] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === 3.3. PUT /api/items/:id/logic-graph - Обновить анализ логики для AiItem ===
  router.put('/items/:id/logic-graph', async (req, res) => {
    try {
      const { id } = req.params;
      const decodedId = decodeURIComponent(id);
      const contextCode = req.contextCode;
      const { logic, graph } = req.body;

      // Валидация
      if (!logic || !graph) {
        return res.status(400).json({ 
          success: false, 
          error: 'Both "logic" and "graph" fields are required' 
        });
      }

      // Проверяем существование AiItem
      const item = await dbService.getFullAiItemByFullName(decodedId, contextCode || null);
      if (!item) {
        return res.status(404).json({ 
          success: false, 
          error: `AiItem not found: ${decodedId}` 
        });
      }

      // Проверяем существование logic-graph
      const existing = await dbService.getLogicGraphByAiItem(decodedId, contextCode || null);
      if (!existing) {
        return res.status(404).json({ 
          success: false, 
          error: `Logic analysis not found for item: ${decodedId}` 
        });
      }

      // Обновляем logic-graph
      const result = await dbService.saveLogicGraph(decodedId, logic, graph, contextCode || null);

      res.json({
        success: true,
        itemId: decodedId,
        logicGraph: {
          logic,
          graph
        },
        savedAt: result.savedAt,
        updatedAt: result.updatedAt
      });
    } catch (error) {
      console.error('[API/ITEMS/:ID/LOGIC-GRAPH] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === 3.4. DELETE /api/items/:id/logic-graph - Удалить анализ логики для AiItem ===
  router.delete('/items/:id/logic-graph', async (req, res) => {
    try {
      const { id } = req.params;
      const decodedId = decodeURIComponent(id);
      const contextCode = req.contextCode;

      // Проверяем существование AiItem
      const item = await dbService.getFullAiItemByFullName(decodedId, contextCode || null);
      if (!item) {
        return res.status(404).json({ 
          success: false, 
          error: `AiItem not found: ${decodedId}` 
        });
      }

      // Удаляем logic-graph
      const deleted = await dbService.deleteLogicGraph(decodedId, contextCode || null);
      
      if (!deleted) {
        return res.status(404).json({ 
          success: false, 
          error: `Logic analysis not found for item: ${decodedId}` 
        });
      }

      res.json({
        success: true,
        message: `Logic analysis deleted successfully for item: ${decodedId}`
      });
    } catch (error) {
      console.error('[API/ITEMS/:ID/LOGIC-GRAPH] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === 4. Список метаданных всех AiItems (новый контракт) ===
  router.get('/items-list', async (req, res) => {
    try {
      // Получаем список всех уникальных full_name из ai_item (с фильтром по контексту)
      let query = `
        SELECT DISTINCT 
          ai.full_name,
          ai.type,
          ai.context_code,
          f.filename,
          f.file_url
        FROM public.ai_item ai
        JOIN public.files f ON ai.file_id = f.id
        WHERE ai.context_code = $1
      `;
      const params = [req.contextCode];

      query += ` ORDER BY ai.full_name`;

      const result = await dbService.pgClient.query(query, params);

      // Формируем ответ строго по новому контракту
      const items = result.rows.map(row => {
        const language = dbService._getLanguageFromFilename(row.filename);

        return {
          id: row.full_name,                                      // строковый идентификатор по контракту
          type: row.type || 'unknown',
          language: language,
          filePath: row.file_url || path.join(process.cwd(), 'docs', row.filename)
        };
      });

      res.json(items);
    } catch (error) {
      console.error('[API/ITEMS/LIST] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === 5. Граф зависимостей всех AiItems (с типизированными связями — label) ===
  router.get('/graph', async (req, res) => {
    try {
      const aiItems = await dbService.getAllFullAiItems(req.contextCode || null);

      if (aiItems.length === 0) {
        return res.json({ nodes: [], links: [] });
      }

      const existingIds = new Set(aiItems.map(item => item.id));
      const linksSet = new Set(); // для удаления дубликатов: source→target→label

      const nodes = aiItems.map(item => ({
        id: item.id,
        type: item.type || 'unknown',
        language: item.language || 'unknown',
        filePath: item.filePath || '',
        l2_desc: item.l2_desc || ''
      }));

      // Маппинг типов зависимостей → человекочитаемый label
      const labelMap = {
        called_functions: 'calls',
        select_from: 'reads from',
        update_tables: 'updates',
        insert_tables: 'inserts into',
        dependencies: 'depends on',
        imports: 'imports'
      };

      for (const item of aiItems) {
        let rawDeps = item.l1_deps || [];

        // Обрабатываем каждый элемент из l1_deps
        for (const dep of rawDeps) {
          let parsedDeps = {};

          if (typeof dep === 'string') {
            try {
              parsedDeps = JSON.parse(dep); // основной случай для SQL
            } catch (e) {
              // если не JSON — это одиночная строка-зависимость (например, из JS)
              const targetId = dep.trim();
              if (targetId && existingIds.has(targetId)) {
                const linkKey = `${item.id}→${targetId}→depends on`;
                linksSet.add(linkKey);
              }
              continue;
            }
          } else if (Array.isArray(dep)) {
            // простой массив строк
            dep.forEach(targetId => {
              const normalized = targetId.trim();
              if (normalized && existingIds.has(normalized)) {
                linksSet.add(`${item.id}→${normalized}→depends on`);
              }
            });
            continue;
          } else if (typeof dep === 'object' && dep !== null) {
            parsedDeps = dep;
          } else {
            continue;
          }

          // Теперь parsedDeps — объект вида { called_functions: [...], select_from: [...], ... }
          Object.keys(parsedDeps).forEach(key => {
            const targets = parsedDeps[key];
            if (!Array.isArray(targets)) return;

            const label = labelMap[key] || key; // используем красивый label или оригинал

            targets.forEach(targetId => {
              const normalized = typeof targetId === 'string' ? targetId.trim() : '';
              if (normalized && existingIds.has(normalized)) {
                const linkKey = `${item.id}→${normalized}→${label}`;
                linksSet.add(linkKey);
              }
            });
          });
        }
      }

      // Формируем финальный массив links
      const links = Array.from(linksSet).map(key => {
        const parts = key.split('→');
        return {
          source: parts[0],
          target: parts[1],
          label: parts[2]
        };
      });

      res.json({ nodes, links });

    } catch (error) {
      console.error('[API/GRAPH] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === 6. Статус всех шагов pipeline ===
  router.get('/pipeline/steps/status', (req, res) => {
    try {
      // TODO: pipelineStateManager.getStepsStatus() может потребовать поддержку contextCode
      // для изоляции состояния pipeline по контекстам
      const steps = pipelineStateManager.getStepsStatus();

      res.json({
        success: true,
        steps: steps
      });
      // context-code валидирован через middleware, доступен как req.contextCode
    } catch (error) {
      console.error('[API/PIPELINE/STEPS/STATUS] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // === 7. Запуск шага 1 pipeline ===
  router.post('/pipeline/step/1/run', async (req, res) => {
    const contextCode = req.contextCode;

    try {
      // Проверка, не запущен ли уже шаг 1
      const stepStatus = pipelineStateManager.getStep(1);
      if (stepStatus.status === 'running') {
        return res.status(409).json({
          success: false,
          error: 'Шаг 1 уже выполняется. Дождитесь завершения или отмените выполнение.'
        });
      }

      // Генерируем уникальный sessionId
      const sessionId = `${contextCode}-1-${Date.now()}`;

      // Устанавливаем статус "running" с sessionId
      pipelineStateManager.updateStep(1, {
        status: 'running',
        progress: 0,
        itemsProcessed: 0,
        totalItems: 0,
        startedAt: new Date().toISOString(),
        error: null,
        sessionId: sessionId
      });

      // Сохраняем в историю
      pipelineHistoryManager.addHistoryEntry(contextCode, 1, pipelineStateManager.getStep(1));

      console.log(`[Pipeline] Запущен шаг 1 для контекста ${contextCode}, sessionId: ${sessionId}`);

      // Запускаем шаг 1 асинхронно (не блокируем ответ)
      const { runStep1 } = require('./pipeline/step1Runner');

      runStep1(contextCode, sessionId, dbService, pipelineStateManager, pipelineHistoryManager)
        .then(() => {
          // Шаг завершён успешно - сохраняем сессию
          const stepData = pipelineStateManager.getStep(1);
          if (stepData.status === 'completed' || stepData.status === 'failed') {
            saveSessionLogs(sessionId, contextCode, 1, stepData).catch(err => {
              console.error(`[Pipeline] Ошибка сохранения сессии ${sessionId}:`, err);
            });
          }
        })
        .catch(error => {
          console.error(`[Pipeline] Ошибка выполнения шага 1:`, error);
          const stepData = pipelineStateManager.updateStep(1, {
            status: 'failed',
            error: error.message,
            completedAt: new Date().toISOString()
          });
          // Сохраняем в историю
          pipelineHistoryManager.addHistoryEntry(contextCode, 1, stepData);
          // Сохраняем сессию даже при ошибке
          saveSessionLogs(sessionId, contextCode, 1, stepData).catch(err => {
            console.error(`[Pipeline] Ошибка сохранения сессии ${sessionId}:`, err);
          });
        });

      // Возвращаем ответ сразу (fire-and-forget)
      res.json({
        success: true,
        message: 'Шаг 1 запущен в фоновом режиме',
        step: pipelineStateManager.getStep(1)
      });

    } catch (error) {
      console.error('[API/PIPELINE/STEP/1/RUN] Ошибка:', error);
      const stepData = pipelineStateManager.updateStep(1, {
        status: 'failed',
        error: error.message,
        completedAt: new Date().toISOString()
      });
      // Сохраняем в историю
      pipelineHistoryManager.addHistoryEntry(contextCode, 1, stepData);
      // Пытаемся сохранить сессию, если sessionId был установлен
      const currentStep = pipelineStateManager.getStep(1);
      if (currentStep.sessionId) {
        saveSessionLogs(currentStep.sessionId, contextCode, 1, stepData).catch(err => {
          console.error(`[Pipeline] Ошибка сохранения сессии:`, err);
        });
      }
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // === 7.1 Запуск шага 2 pipeline ===
  router.post('/pipeline/step/2/run', async (req, res) => {
    const contextCode = req.contextCode;

    try {
      // Проверка, не запущен ли уже шаг 2
      const stepStatus = pipelineStateManager.getStep(2);
      if (stepStatus.status === 'running') {
        return res.status(409).json({
          success: false,
          error: 'Шаг 2 уже выполняется. Дождитесь завершения или отмените выполнение.'
        });
      }

      // Генерируем уникальный sessionId
      const sessionId = `${contextCode}-2-${Date.now()}`;

      // Устанавливаем статус "running" с sessionId
      pipelineStateManager.updateStep(2, {
        status: 'running',
        progress: 0,
        itemsProcessed: 0,
        totalItems: 0,
        startedAt: new Date().toISOString(),
        error: null,
        sessionId: sessionId
      });

      // Сохраняем в историю
      pipelineHistoryManager.addHistoryEntry(contextCode, 2, pipelineStateManager.getStep(2));

      console.log(`[Pipeline] Запущен шаг 2 для контекста ${contextCode}, sessionId: ${sessionId}`);

      // Запускаем шаг 2 асинхронно (не блокируем ответ)
      const { runStep2 } = require('./pipeline/step2Runner');

      runStep2(contextCode, sessionId, dbService, pipelineStateManager, pipelineHistoryManager)
        .then(() => {
          // Шаг завершён успешно - сохраняем сессию
          const stepData = pipelineStateManager.getStep(2);
          if (stepData.status === 'completed' || stepData.status === 'failed') {
            saveSessionLogs(sessionId, contextCode, 2, stepData).catch(err => {
              console.error(`[Pipeline] Ошибка сохранения сессии ${sessionId}:`, err);
            });
          }
        })
        .catch(error => {
          console.error(`[Pipeline] Ошибка выполнения шага 2:`, error);
          const stepData = pipelineStateManager.updateStep(2, {
            status: 'failed',
            error: error.message,
            completedAt: new Date().toISOString()
          });
          // Сохраняем в историю
          pipelineHistoryManager.addHistoryEntry(contextCode, 2, stepData);
          // Сохраняем сессию даже при ошибке
          saveSessionLogs(sessionId, contextCode, 2, stepData).catch(err => {
            console.error(`[Pipeline] Ошибка сохранения сессии ${sessionId}:`, err);
          });
        });

      // Возвращаем ответ сразу (fire-and-forget)
      res.json({
        success: true,
        message: 'Шаг 2 запущен в фоновом режиме',
        step: pipelineStateManager.getStep(2)
      });

    } catch (error) {
      console.error('[API/PIPELINE/STEP/2/RUN] Ошибка:', error);
      const stepData = pipelineStateManager.updateStep(2, {
        status: 'failed',
        error: error.message,
        completedAt: new Date().toISOString()
      });
      // Сохраняем в историю
      pipelineHistoryManager.addHistoryEntry(contextCode, 2, stepData);
      // Пытаемся сохранить сессию, если sessionId был установлен
      const currentStep = pipelineStateManager.getStep(2);
      if (currentStep.sessionId) {
        saveSessionLogs(currentStep.sessionId, contextCode, 2, stepData).catch(err => {
          console.error(`[Pipeline] Ошибка сохранения сессии:`, err);
        });
      }
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // === 7.5. Запуск полного pipeline (шаги 1 и 2) ===
  router.post('/pipeline/start', async (req, res) => {
    const contextCode = req.contextCode;
    const { forceRescan = false } = req.body || {};

    try {
      // Проверяем конфигурацию
      const config = await kbConfigService.getConfig(contextCode);
      if (!config) {
        return res.status(428).json({
          success: false,
          error: 'No configuration found. Set up project via /api/kb-config'
        });
      }
      
      // Проверяем, что есть либо fileSelection, либо includeMask
      const hasFileSelection = config.fileSelection && config.fileSelection.length > 0;
      const hasIncludeMask = config.includeMask && config.includeMask.trim() !== '';
      
      if (!hasFileSelection && !hasIncludeMask) {
        return res.status(428).json({
          success: false,
          error: 'No files configured. Set up project via /api/kb-config or /api/project/selection'
        });
      }

      // Генерируем ID pipeline (используем contextCode + timestamp)
      const pipelineId = `${contextCode}-${Date.now()}`;
      const startTime = new Date().toISOString();

      // Сбрасываем состояние шагов
      pipelineStateManager.reset();

      // Генерируем sessionId для шага 1
      const sessionId1 = `${contextCode}-1-${Date.now()}`;
      const sessionId2 = `${contextCode}-2-${Date.now() + 1}`; // Немного позже для уникальности

      // Запускаем шаг 1 асинхронно
      const { runStep1 } = require('./pipeline/step1Runner');
      
      pipelineStateManager.updateStep(1, {
        status: 'running',
        progress: 0,
        itemsProcessed: 0,
        totalItems: 0,
        startedAt: startTime,
        error: null,
        sessionId: sessionId1
      });

      pipelineHistoryManager.addHistoryEntry(contextCode, 1, pipelineStateManager.getStep(1));

      // Запускаем шаг 1, после его завершения запустим шаг 2
      runStep1(contextCode, sessionId1, dbService, pipelineStateManager, pipelineHistoryManager)
        .then(() => {
          // Сохраняем сессию шага 1
          const step1Data = pipelineStateManager.getStep(1);
          if (step1Data.status === 'completed' || step1Data.status === 'failed') {
            saveSessionLogs(sessionId1, contextCode, 1, step1Data).catch(err => {
              console.error(`[Pipeline] Ошибка сохранения сессии ${sessionId1}:`, err);
            });
          }

          // После завершения шага 1 запускаем шаг 2
          const { runStep2 } = require('./pipeline/step2Runner');
          
          pipelineStateManager.updateStep(2, {
            status: 'running',
            progress: 0,
            itemsProcessed: 0,
            totalItems: 0,
            startedAt: new Date().toISOString(),
            error: null,
            sessionId: sessionId2
          });

          pipelineHistoryManager.addHistoryEntry(contextCode, 2, pipelineStateManager.getStep(2));

          return runStep2(contextCode, sessionId2, dbService, pipelineStateManager, pipelineHistoryManager)
            .then(() => {
              // Сохраняем сессию шага 2
              const step2Data = pipelineStateManager.getStep(2);
              if (step2Data.status === 'completed' || step2Data.status === 'failed') {
                saveSessionLogs(sessionId2, contextCode, 2, step2Data).catch(err => {
                  console.error(`[Pipeline] Ошибка сохранения сессии ${sessionId2}:`, err);
                });
              }
            });
        })
        .catch(error => {
          console.error(`[Pipeline] Ошибка выполнения pipeline:`, error);
          // Обновляем статус шага, который упал
          const failedStep = pipelineStateManager.steps.find(s => s.status === 'running');
          if (failedStep) {
            const stepData = pipelineStateManager.updateStep(failedStep.id, {
              status: 'failed',
              error: error.message,
              completedAt: new Date().toISOString()
            });
            pipelineHistoryManager.addHistoryEntry(contextCode, failedStep.id, stepData);
            // Сохраняем сессию упавшего шага
            if (failedStep.sessionId) {
              saveSessionLogs(failedStep.sessionId, contextCode, failedStep.id, stepData).catch(err => {
                console.error(`[Pipeline] Ошибка сохранения сессии:`, err);
              });
            }
          }
        });

      res.json({
        success: true,
        pipeline: {
          id: pipelineId,
          status: 'running',
          startTime: startTime
        }
      });

    } catch (error) {
      console.error('[API/PIPELINE/START] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // === 7.6. Прогресс pipeline по ID ===
  router.get('/pipeline/:id/progress', (req, res) => {
    try {
      const contextCode = req.contextCode;
      const pipelineId = req.params.id;

      // Получаем статус всех шагов
      const steps = pipelineStateManager.getStepsStatus();
      
      // Вычисляем общий прогресс (среднее по всем шагам)
      // Completed шаги считаем как 100%, failed как 0%, остальные по их progress
      const totalProgress = steps.reduce((sum, step) => {
        if (step.status === 'completed') {
          return sum + 100;
        } else if (step.status === 'failed') {
          return sum + 0;
        } else {
          return sum + (step.progress || 0);
        }
      }, 0) / steps.length;
      
      // Определяем общий статус
      // Для pipeline/start достаточно, чтобы шаги 1 и 2 были completed
      let overallStatus = 'running';
      const step1 = steps.find(s => s.id === 1);
      const step2 = steps.find(s => s.id === 2);
      
      if (step1?.status === 'completed' && step2?.status === 'completed') {
        // Шаги 1 и 2 завершены - pipeline для теста считается завершённым
        overallStatus = 'completed';
      } else if (steps.every(s => s.status === 'completed')) {
        // Все шаги завершены
        overallStatus = 'completed';
      } else if (steps.some(s => s.status === 'failed')) {
        overallStatus = 'error';
      } else if (steps.every(s => s.status === 'pending')) {
        overallStatus = 'pending';
      }

      res.json({
        success: true,
        pipeline: {
          id: pipelineId,
          status: overallStatus,
          progress: Math.round(totalProgress)
        },
        steps: steps
      });
    } catch (error) {
      console.error('[API/PIPELINE/:ID/PROGRESS] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // === 8. История выполнения всех шагов pipeline ===
  router.get('/pipeline/steps/history', (req, res) => {
    try {
      const contextCode = req.contextCode;
      const limit = parseInt(req.query.limit) || 100;
      const stepId = req.query.stepId ? parseInt(req.query.stepId) : null;

      // Валидация limit
      const validLimit = Math.min(Math.max(1, limit), 1000);

      // Получаем историю
      const allHistory = pipelineHistoryManager.getAllStepsHistory(contextCode, validLimit, stepId);

      // Добавляем имена шагов из pipelineStateManager
      const result = allHistory.map(item => {
        const step = pipelineStateManager.steps.find(s => s.id === item.stepId);
        return {
          stepId: item.stepId,
          stepName: step ? step.name : `step_${item.stepId}`,
          history: item.history
        };
      });

      res.json({
        success: true,
        steps: result
      });
    } catch (error) {
      console.error('[API/PIPELINE/STEPS/HISTORY] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // === 9. История выполнения конкретного шага pipeline ===
  router.get('/pipeline/step/:id/history', (req, res) => {
    try {
      const contextCode = req.contextCode;
      const stepId = parseInt(req.params.id);
      const limit = parseInt(req.query.limit) || 100;

      // Валидация stepId
      if (![1, 2, 3, 4, 5, 6, 7].includes(stepId)) {
        return res.status(400).json({
          success: false,
          error: `Invalid step ID: ${stepId}. Must be 1-7`
        });
      }

      const step = pipelineStateManager.steps.find(s => s.id === stepId);
      if (!step) {
        return res.status(404).json({
          success: false,
          error: `Step with id ${stepId} not found`
        });
      }

      // Валидация limit
      const validLimit = Math.min(Math.max(1, limit), 1000);

      const history = pipelineHistoryManager.getStepHistory(contextCode, stepId, validLimit);

      res.json({
        success: true,
        stepId: stepId,
        stepName: step.name,
        history: history
      });
    } catch (error) {
      console.error('[API/PIPELINE/STEP/:ID/HISTORY] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // === Pipeline Context Definition and Configuration ===
  // GET /pipeline/context-definition — получить определения шагов для контекста
  router.get('/pipeline/context-definition', async (req, res) => {
    try {
      const contextCode = req.contextCode;
      const steps = await pipelineConfigService.getPipelineDefinitions(contextCode);
      
      res.json({
        steps: steps
      });
    } catch (error) {
      console.error('[API/PIPELINE/CONTEXT-DEFINITION] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve pipeline context definition'
      });
    }
  });

  // GET /pipeline/context-config — получить текущую конфигурацию шагов для контекста
  router.get('/pipeline/context-config', async (req, res) => {
    try {
      const contextCode = req.contextCode;
      const config = await pipelineConfigService.getPipelineConfig(contextCode);
      
      res.json(config);
    } catch (error) {
      console.error('[API/PIPELINE/CONTEXT-CONFIG/GET] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve pipeline context config'
      });
    }
  });

  // POST /pipeline/context-config — обновить конфигурацию шагов для контекста
  router.post('/pipeline/context-config', async (req, res) => {
    try {
      const contextCode = req.contextCode;
      
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'Request body must be a JSON object'
        });
      }

      const savedConfig = await pipelineConfigService.savePipelineConfig(contextCode, req.body);
      
      res.json(savedConfig);
    } catch (error) {
      console.error('[API/PIPELINE/CONTEXT-CONFIG/POST] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to save pipeline context config'
      });
    }
  });

  // === Knowledge Base Configuration ===
  // GET /kb-config — получить текущую конфигурацию базы знаний
  router.get('/kb-config', async (req, res) => {
    try {
      const config = await kbConfigService.getConfig(req.contextCode);

      res.json({
        success: true,
        config: config
      });
    } catch (error) {
      console.error('[API/KB-CONFIG/GET] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve knowledge base configuration'
      });
    }
  });

  // POST /kb-config — обновить конфигурацию базы знаний
  router.post('/kb-config', async (req, res) => {
    try {
      const updates = req.body;

      if (!updates || Object.keys(updates).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Request body is empty or not valid JSON'
        });
      }

      const newConfig = await kbConfigService.saveConfig(req.contextCode, updates);

      res.json({
        success: true,
        config: newConfig
      });
    } catch (error) {
      console.error('[API/KB-CONFIG/POST] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to update knowledge base configuration'
      });
    }
  });

  // === Project File Tree (новая модель v2.1.1) ===
  // GET /project/tree — возвращает МАССИВ детей корневой директории
  router.get('/project/tree', async (req, res) => {
    try {
      const config = await kbConfigService.getConfig(req.contextCode);
      const rootPath = config.rootPath;

      if (!rootPath || !fs.existsSync(rootPath)) {
        return res.status(400).json({
          success: false,
          error: `Root path does not exist: ${rootPath}`
        });
      }

      // Подготовка фильтров (используем общие функции для синхронизации с step1Runner)
      const { createMatchers, isIgnored: checkIgnored, isIncluded: checkIncluded } = require('../packages/core/fileMatchUtils');
      const { includeMatcher, ignoreMatchers } = createMatchers(config.includeMask, config.ignorePatterns);

      function isIgnored(relativePath) {
        return checkIgnored(relativePath, ignoreMatchers);
      }

      function isIncluded(relativePath) {
        return checkIncluded(relativePath, includeMatcher);
      }

      // Маппинг расширений → язык
      const extToLanguage = {
        '.py': 'python',
        '.js': 'javascript',
        '.ts': 'typescript',
        '.tsx': 'typescript',
        '.java': 'java',
        '.go': 'go',
        '.sql': 'sql',          // ← вернули!
        '.md': 'markdown',      // опционально, если хочешь
        '.yaml': 'yaml',
        '.json': 'json'
        // ... добавляй любые
      };

      function getLanguageFromPath(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return extToLanguage[ext] || null;
      }

      // Рекурсивная функция построения узла (возвращает null, если узел не проходит фильтры)
      async function buildNode(currentAbsPath, currentRelPath = './', depth = 0) {
        if (depth > 20) return null;

        let stats;
        try {
          stats = fs.statSync(currentAbsPath);
        } catch (err) {
          return {
            path: currentRelPath,
            name: path.basename(currentAbsPath),
            type: 'unknown',
            size: 0,
            selected: false,
            error: true,
            errorMessage: err.message,
            language: null,
            children: []
          };
        }

        if (stats.isDirectory()) {
          // Проверяем, игнорируется ли директория
          if (isIgnored(currentRelPath)) {
            return null; // полностью игнорируем директорию
          }

          let entries;
          try {
            entries = fs.readdirSync(currentAbsPath);
          } catch (err) {
            return {
              path: currentRelPath,
              name: path.basename(currentAbsPath),
              type: 'directory',
              size: 0,
              selected: false,
              error: true,
              errorMessage: err.message,
              children: [],
              language: null
            };
          }

          const children = [];
          for (const entry of entries) {
            const absChild = path.join(currentAbsPath, entry);
            const relChild = './' + path.relative(rootPath, absChild).replace(/\\/g, '/');
            const childNode = await buildNode(absChild, relChild, depth + 1);
            if (childNode) {
              children.push(childNode);
            }
          }

          // Сортировка: папки сверху, файлы снизу, по имени
          children.sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === 'directory' ? -1 : 1;
          });

          const hasSelectedChild = children.some(c => c.selected);

          return {
            path: currentRelPath,
            name: path.basename(currentAbsPath),
            type: 'directory',
            size: 0,
            selected: hasSelectedChild,
            children,
            language: null,
            error: false
          };
        } else if (stats.isFile()) {
          const relativePath = currentRelPath;
          if (isIgnored(relativePath)) {
            return null; // полностью игнорируем
          }

          const selected = isIncluded(relativePath);

          return {
            path: relativePath,
            name: path.basename(currentAbsPath),
            type: 'file',
            size: stats.size,
            selected,
            language: getLanguageFromPath(currentAbsPath),
            error: false
          };
        }

        return null;
      }

      // Читаем содержимое rootPath и строим массив детей
      let entries;
      try {
        entries = fs.readdirSync(rootPath);
      } catch (err) {
        return res.status(500).json({
          success: false,
          error: `Cannot read root directory: ${err.message}`
        });
      }

      const treeNodes = [];
      for (const entry of entries) {
        const absPath = path.join(rootPath, entry);
        const relPath = './' + entry; // корневые элементы начинаются с ./
        const node = await buildNode(absPath, relPath, 1); // depth=1, т.к. корень не включаем
        if (node) {
          treeNodes.push(node);
        }
      }

      // Финальная сортировка корневых узлов
      treeNodes.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'directory' ? -1 : 1;
      });

      res.json(treeNodes);

    } catch (error) {
      console.error('[API/PROJECT/TREE] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  });

  // === Project File Selection (точный выбор файлов через чекбоксы) ===
  // POST /project/selection — сохранить точный список выбранных файлов
  router.post('/project/selection', async (req, res) => {
    try {
      const { files } = req.body;

      if (!Array.isArray(files)) {
        return res.status(400).json({
          success: false,
          error: 'Request body must contain "files" as an array of strings (relative paths)'
        });
      }

      // Нормализуем пути (на всякий случай)
      const normalizedFiles = files
        .map(p => String(p).trim())
        .filter(p => p.startsWith('./') || p.startsWith('/'))
        .map(p => (p.startsWith('/') ? `.${p}` : p)) // гарантируем ./ в начале
        .filter(Boolean);

      // Обновляем только поле fileSelection в конфиге
      const currentConfig = await kbConfigService.getConfig(req.contextCode);

      const updatedConfig = await kbConfigService.saveConfig(req.contextCode, {
        fileSelection: normalizedFiles
        // rootPath можно обновить, если пришлёт, но по контракту не обязателен
      });

      console.log(`[API/PROJECT/SELECTION] Сохранён выбор файлов для ${req.contextCode}: ${normalizedFiles.length} файлов`);

      res.json({
        success: true,
        config: updatedConfig
      });
    } catch (error) {
      console.error('[API/PROJECT/SELECTION] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to save file selection'
      });
    }
  });

  // === Логи сессий выполнения шагов ===
  // GET /api/logs/sessions/{sessionId} - получить логи конкретной сессии
  router.get('/logs/sessions/:sessionId', (req, res) => {
    try {
      const { sessionId } = req.params;
      const SESSIONS_DIR = require('../server').SESSIONS_DIR;
      const sessionFilePath = path.join(SESSIONS_DIR, `${sessionId}.json`);

      if (!fs.existsSync(sessionFilePath)) {
        return res.status(404).json({
          success: false,
          error: `Session ${sessionId} not found`
        });
      }

      const sessionData = JSON.parse(fs.readFileSync(sessionFilePath, 'utf-8'));

      res.json({
        success: true,
        session: sessionData
      });
    } catch (error) {
      console.error('[API/LOGS/SESSIONS/:SESSIONID] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // GET /api/logs/sessions - список всех сессий с фильтрацией
  router.get('/logs/sessions', (req, res) => {
    try {
      const { contextCode, stepId, limit = 50 } = req.query;
      const SESSIONS_DIR = require('../server').SESSIONS_DIR;

      if (!fs.existsSync(SESSIONS_DIR)) {
        return res.json({
          success: true,
          sessions: []
        });
      }

      // Читаем все файлы сессий
      const sessionFiles = fs.readdirSync(SESSIONS_DIR)
        .filter(file => file.endsWith('.json'))
        .map(file => {
          try {
            const filePath = path.join(SESSIONS_DIR, file);
            const sessionData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return sessionData;
          } catch (err) {
            console.error(`[API/LOGS/SESSIONS] Ошибка чтения файла ${file}:`, err);
            return null;
          }
        })
        .filter(session => session !== null);

      // Фильтрация
      let filteredSessions = sessionFiles;
      if (contextCode) {
        filteredSessions = filteredSessions.filter(s => s.contextCode === contextCode);
      }
      if (stepId) {
        const stepIdNum = parseInt(stepId);
        filteredSessions = filteredSessions.filter(s => s.stepId === stepIdNum);
      }

      // Сортировка по времени завершения (новые сверху)
      filteredSessions.sort((a, b) => {
        const timeA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const timeB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return timeB - timeA;
      });

      // Ограничение количества
      const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 1000);
      const sessionsToReturn = filteredSessions.slice(0, limitNum).map(session => ({
        sessionId: session.sessionId,
        contextCode: session.contextCode,
        stepId: session.stepId,
        stepName: session.stepName,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        status: session.status,
        logCount: session.logs ? session.logs.length : 0
      }));

      res.json({
        success: true,
        total: filteredSessions.length,
        returned: sessionsToReturn.length,
        sessions: sessionsToReturn
      });
    } catch (error) {
      console.error('[API/LOGS/SESSIONS] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // === DELETE /api/vector-db - Очистить векторную базу данных для context-code ===
  router.delete('/vector-db', async (req, res) => {
    try {
      const contextCode = req.query['context-code'] || req.query.contextCode;
      
      if (!contextCode) {
        return res.status(400).json({
          success: false,
          error: 'context-code parameter is required',
          message: 'Please provide context-code as query parameter: ?context-code=TEST'
        });
      }

      console.log(`[API/VECTOR-DB] Запрос на очистку векторной БД для context-code: "${contextCode}"`);
      
      const result = await dbService.clearVectorDbByContextCode(contextCode);
      
      res.json({
        success: true,
        message: `Vector database cleared successfully for context-code: ${contextCode}`,
        ...result
      });
    } catch (error) {
      console.error('[API/VECTOR-DB] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;

};