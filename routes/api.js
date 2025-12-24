// API для kosmos-UI (aiitem-rag-architect)
// routes/api.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const { Minimatch } = require('minimatch');

const pipelineStateManager = require('./pipelineState');
const pipelineHistoryManager = require('./pipelineHistory');
const kbConfigService = require('../packages/core/kbConfigService');

// Импортируем logSubscribers для SSE потока
const { logSubscribers } = require('../server');

const router = express.Router();

module.exports = (dbService, logBuffer) => {

  // === Маршруты логов (БЕЗ валидации context-code, логи глобальные) ===
  router.get('/logs', (req, res) => {
    try {
      if (!logBuffer || !Array.isArray(logBuffer)) {
        return res.status(500).json({
          success: false,
          error: 'Log buffer not available'
        });
      }

      let { lines = 50 } = req.query;
      lines = Math.min(Math.max(parseInt(lines) || 50, 1), 500);

      const logsToSend = logBuffer.slice(-lines);

      res.json({
        success: true,
        total: logBuffer.length,
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
      // Устанавливаем заголовки для SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // отключаем буферизацию в nginx

      // Добавляем клиента в подписчики
      logSubscribers.add(res);

      // Отправляем начальное сообщение
      res.write(`: connected to log stream\n\n`);

      // Обработка отключения клиента
      req.on('close', () => {
        logSubscribers.delete(res);
        res.end();
      });

      // Обработка ошибок
      req.on('error', (err) => {
        console.error('[API/LOGS/STREAM] Ошибка соединения:', err);
        logSubscribers.delete(res);
        res.end();
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
        return res.status(404).json({ success: false, error: 'AiItem not found' });
      }

      res.json(item);
    } catch (error) {
      console.error('[API/ITEM] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === 3.1. GET /api/items/:id/logic-graph - Получить анализ логики для AiItem ===
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

      // Устанавливаем статус "running"
      pipelineStateManager.updateStep(1, {
        status: 'running',
        progress: 0,
        itemsProcessed: 0,
        totalItems: 0,
        startedAt: new Date().toISOString(),
        error: null
      });

      // Сохраняем в историю
      pipelineHistoryManager.addHistoryEntry(contextCode, 1, pipelineStateManager.getStep(1));

      console.log(`[Pipeline] Запущен шаг 1 для контекста ${contextCode}`);

      // Запускаем шаг 1 асинхронно (не блокируем ответ)
      const { runStep1 } = require('./pipeline/step1Runner');

      runStep1(contextCode, dbService, pipelineStateManager, pipelineHistoryManager)
        .catch(error => {
          console.error(`[Pipeline] Ошибка выполнения шага 1:`, error);
          pipelineStateManager.updateStep(1, {
            status: 'failed',
            error: error.message,
            completedAt: new Date().toISOString()
          });
          // Сохраняем в историю
          pipelineHistoryManager.addHistoryEntry(contextCode, 1, pipelineStateManager.getStep(1));
        });

      // Возвращаем ответ сразу (fire-and-forget)
      res.json({
        success: true,
        message: 'Шаг 1 запущен в фоновом режиме',
        step: pipelineStateManager.getStep(1)
      });

    } catch (error) {
      console.error('[API/PIPELINE/STEP/1/RUN] Ошибка:', error);
      pipelineStateManager.updateStep(1, {
        status: 'failed',
        error: error.message,
        completedAt: new Date().toISOString()
      });
      // Сохраняем в историю
      pipelineHistoryManager.addHistoryEntry(contextCode, 1, pipelineStateManager.getStep(1));
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

      // Устанавливаем статус "running"
      pipelineStateManager.updateStep(2, {
        status: 'running',
        progress: 0,
        itemsProcessed: 0,
        totalItems: 0,
        startedAt: new Date().toISOString(),
        error: null
      });

      // Сохраняем в историю
      pipelineHistoryManager.addHistoryEntry(contextCode, 2, pipelineStateManager.getStep(2));

      console.log(`[Pipeline] Запущен шаг 2 для контекста ${contextCode}`);

      // Запускаем шаг 2 асинхронно (не блокируем ответ)
      const { runStep2 } = require('./pipeline/step2Runner');

      runStep2(contextCode, dbService, pipelineStateManager, pipelineHistoryManager)
        .catch(error => {
          console.error(`[Pipeline] Ошибка выполнения шага 2:`, error);
          pipelineStateManager.updateStep(2, {
            status: 'failed',
            error: error.message,
            completedAt: new Date().toISOString()
          });
          // Сохраняем в историю
          pipelineHistoryManager.addHistoryEntry(contextCode, 2, pipelineStateManager.getStep(2));
        });

      // Возвращаем ответ сразу (fire-and-forget)
      res.json({
        success: true,
        message: 'Шаг 2 запущен в фоновом режиме',
        step: pipelineStateManager.getStep(2)
      });

    } catch (error) {
      console.error('[API/PIPELINE/STEP/2/RUN] Ошибка:', error);
      pipelineStateManager.updateStep(2, {
        status: 'failed',
        error: error.message,
        completedAt: new Date().toISOString()
      });
      // Сохраняем в историю
      pipelineHistoryManager.addHistoryEntry(contextCode, 2, pipelineStateManager.getStep(2));
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

      // Запускаем шаг 1 асинхронно
      const { runStep1 } = require('./pipeline/step1Runner');
      
      pipelineStateManager.updateStep(1, {
        status: 'running',
        progress: 0,
        itemsProcessed: 0,
        totalItems: 0,
        startedAt: startTime,
        error: null
      });

      pipelineHistoryManager.addHistoryEntry(contextCode, 1, pipelineStateManager.getStep(1));

      // Запускаем шаг 1, после его завершения запустим шаг 2
      runStep1(contextCode, dbService, pipelineStateManager, pipelineHistoryManager)
        .then(() => {
          // После завершения шага 1 запускаем шаг 2
          const { runStep2 } = require('./pipeline/step2Runner');
          
          pipelineStateManager.updateStep(2, {
            status: 'running',
            progress: 0,
            itemsProcessed: 0,
            totalItems: 0,
            startedAt: new Date().toISOString(),
            error: null
          });

          pipelineHistoryManager.addHistoryEntry(contextCode, 2, pipelineStateManager.getStep(2));

          return runStep2(contextCode, dbService, pipelineStateManager, pipelineHistoryManager);
        })
        .catch(error => {
          console.error(`[Pipeline] Ошибка выполнения pipeline:`, error);
          // Обновляем статус шага, который упал
          const failedStep = pipelineStateManager.steps.find(s => s.status === 'running');
          if (failedStep) {
            pipelineStateManager.updateStep(failedStep.id, {
              status: 'failed',
              error: error.message,
              completedAt: new Date().toISOString()
            });
            pipelineHistoryManager.addHistoryEntry(contextCode, failedStep.id, pipelineStateManager.getStep(failedStep.id));
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

      // Подготовка фильтров
      const includeMatcher = new Minimatch(config.includeMask || '**/*', { dot: true });
      const ignoreMatchers = (config.ignorePatterns || '')
        .split(',')
        .map(p => p.trim())
        .filter(p => p)
        .map(p => new Minimatch(p, { dot: true }));

      function isIgnored(relativePath) {
        return ignoreMatchers.some(matcher => matcher.match(relativePath));
      }

      function isIncluded(relativePath) {
        return includeMatcher.match(relativePath);
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

  return router;

};