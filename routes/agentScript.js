// routes/agentScript.js
// Роутер для управления agent scripts и Natural Query Engine
const express = require('express');
const { callLLM } = require('../packages/core/llmClient');
const { executeScript, validateScript } = require('../packages/core/scriptSandbox');
const { getScriptGenerationPrompt, getHumanizePrompt } = require('../packages/core/naturalQueryPrompts');

const router = express.Router();

// Загружаем конфигурацию
const getConfig = () => {
  const fs = require('fs');
  const path = require('path');
  const configPath = path.join(__dirname, '..', 'config.json');
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return {};
};

module.exports = (dbService, embeddings) => {
  // Middleware для валидации context-code
  const validateContextCode = (req, res, next) => {
    const contextCode = req.query['context-code'] || req.query.contextCode || req.body.contextCode;

    if (!contextCode) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: context-code'
      });
    }

    req.contextCode = contextCode;
    next();
  };

  // === CRUD маршруты для agent-scripts ===

  // GET /api/agent-scripts — список скриптов (с пагинацией)
  router.get('/agent-scripts', validateContextCode, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const rows = await dbService.pgClient.query(`
        SELECT id, question, usage_count, is_valid, last_result, created_at, updated_at
        FROM public.agent_script
        WHERE context_code = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `, [req.contextCode, limit, offset]);

      res.json({ success: true, scripts: rows.rows });
    } catch (error) {
      console.error('[API/AGENT-SCRIPTS] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/agent-scripts/:id — детальная информация о скрипте
  router.get('/agent-scripts/:id', validateContextCode, async (req, res) => {
    try {
      const { id } = req.params;

      const result = await dbService.pgClient.query(`
        SELECT id, question, script, usage_count, is_valid, last_result, created_at, updated_at
        FROM public.agent_script
        WHERE id = $1 AND context_code = $2
      `, [id, req.contextCode]);

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Script not found' });
      }

      // Логируем количество переводов строк при чтении из БД
      const scriptFromDB = result.rows[0];
      const newlineCountInDB = (scriptFromDB.script.match(/\n/g) || []).length;
      console.log(`[API/AGENT-SCRIPTS/:ID] Чтение скрипта #${id}: ${newlineCountInDB} переводов строк в БД, длина=${scriptFromDB.script.length}`);

      res.json({ success: true, script: scriptFromDB });
    } catch (error) {
      console.error('[API/AGENT-SCRIPTS/:ID] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // PUT /api/agent-scripts/:id — редактировать (script и/или is_valid)
  router.put('/agent-scripts/:id', validateContextCode, async (req, res) => {
    try {
      const { id } = req.params;
      const { script, is_valid } = req.body;

      if (script === undefined && is_valid === undefined) {
        return res.status(400).json({ 
          success: false, 
          error: 'Nothing to update. Provide "script" and/or "is_valid"' 
        });
      }

      const updates = [];
      const params = [id, req.contextCode];

      if (script !== undefined) {
        // Валидация скрипта перед сохранением
        const validation = validateScript(script);
        if (!validation.valid) {
          return res.status(400).json({
            success: false,
            error: `Invalid script: ${validation.error}`
          });
        }
        updates.push(`script = $${params.length + 1}`);
        params.push(script);
      }
      if (is_valid !== undefined) {
        updates.push(`is_valid = $${params.length + 1}`);
        params.push(is_valid);
      }

      const result = await dbService.pgClient.query(`
        UPDATE public.agent_script
        SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND context_code = $2
        RETURNING id, question, script, is_valid, last_result, updated_at
      `, params);

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Script not found' });
      }

      res.json({ success: true, script: result.rows[0] });
    } catch (error) {
      console.error('[API/AGENT-SCRIPTS/:ID/PUT] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // DELETE /api/agent-scripts/:id
  router.delete('/agent-scripts/:id', validateContextCode, async (req, res) => {
    try {
      const { id } = req.params;

      const result = await dbService.pgClient.query(`
        DELETE FROM public.agent_script
        WHERE id = $1 AND context_code = $2
        RETURNING id
      `, [id, req.contextCode]);

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Script not found' });
      }

      res.json({ success: true, message: 'Script deleted' });
    } catch (error) {
      console.error('[API/AGENT-SCRIPTS/:ID/DELETE] Ошибка:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/agent-scripts/:id/execute — выполнить существующий скрипт
  router.post('/agent-scripts/:id/execute', validateContextCode, async (req, res) => {
    try {
      const { id } = req.params;
      const contextCode = req.contextCode;
      const scriptId = parseInt(id, 10);

      if (isNaN(scriptId)) {
        return res.status(400).json({ success: false, error: 'Invalid script ID' });
      }

      // Получаем скрипт из БД
      const result = await dbService.pgClient.query(`
        SELECT id, question, script, is_valid
        FROM public.agent_script
        WHERE id = $1 AND context_code = $2
      `, [scriptId, contextCode]);

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Script not found' });
      }

      const scriptData = result.rows[0];
      const scriptCode = scriptData.script;
      const question = scriptData.question;
      // scriptId уже определён выше

      console.log(`[API/AGENT-SCRIPTS/:ID/EXECUTE] Выполнение скрипта #${scriptId}: "${question.substring(0, 50)}..."`);

      // Выполняем скрипт в sandbox
      let rawData = null;
      let executionError = null;

      try {
        rawData = await executeScript(scriptCode, contextCode, dbService);
        
        // Если скрипт вернул ошибку уточнения
        if (rawData && typeof rawData === 'object' && rawData.error === 'clarify') {
          return res.json({
            success: true,
            human: rawData.message || 'Требуется уточнение вопроса',
            raw: [],
            scriptId: scriptId,
            cached: false,
            clarify: true
          });
        }

        // Помечаем скрипт как валидный при успешном выполнении
        await dbService.pgClient.query(`
          UPDATE public.agent_script
          SET is_valid = true
          WHERE id = $1
        `, [scriptId]);
      } catch (error) {
        executionError = error;
        const errorMessage = error?.message || error?.toString() || 'Unknown error';
        console.error(`[API/AGENT-SCRIPTS/:ID/EXECUTE] Ошибка выполнения скрипта #${scriptId}:`, errorMessage);
        console.error(`[API/AGENT-SCRIPTS/:ID/EXECUTE] Stack trace:`, error?.stack || 'No stack trace');
        
        // Помечаем скрипт как невалидный
        await dbService.pgClient.query(`
          UPDATE public.agent_script
          SET is_valid = false
          WHERE id = $1
        `, [scriptId]);

        // Формируем человекочитаемое сообщение об ошибке
        let humanError = `Произошла ошибка при выполнении скрипта: ${errorMessage}`;
        
        if (errorMessage.includes('is not defined')) {
          const variableName = errorMessage.match(/(\w+)\s+is not defined/)?.[1] || 'переменная';
          humanError = `Ошибка в скрипте: переменная '${variableName}' не определена. Проверьте скрипт и убедитесь, что все переменные правильно объявлены.`;
        } else if (errorMessage.includes('Only SELECT') || errorMessage.includes('Only SELECT and WITH')) {
          humanError = `Ошибка безопасности: скрипт пытается выполнить запрос, который не разрешён. Разрешены только SELECT и WITH (CTE) запросы. Проверьте скрипт.`;
        } else if (errorMessage.includes('timeout')) {
          humanError = `Скрипт выполняется слишком долго (таймаут). Попробуйте упростить запрос или разбить его на части.`;
        }

        return res.status(500).json({
          success: false,
          error: `Script execution failed: ${errorMessage}`,
          human: humanError,
          scriptId: scriptId,
          script: scriptCode,
          cached: false
        });
      }

      // Превращаем rawData в человекочитаемый текст через LLM
      let humanText = '';
      try {
        const humanizePrompt = getHumanizePrompt(question, rawData);
        const humanizeMessages = [
          { role: 'system', content: 'Ты помощник для анализа кодовой базы. Превращай сырые данные в понятный текст на русском языке.' },
          { role: 'user', content: humanizePrompt }
        ];
        
        humanText = await callLLM(humanizeMessages);
      } catch (error) {
        console.error('[API/AGENT-SCRIPTS/:ID/EXECUTE] Ошибка humanize:', error);
        humanText = `Найдено ${Array.isArray(rawData) ? rawData.length : 1} результат(ов). См. raw данные.`;
      }

      // Сохраняем результат выполнения в БД
      let lastResult = null;
      if (!executionError && rawData !== null) {
        try {
          const resultToSave = {
            raw: rawData,
            human: humanText,
            executed_at: new Date().toISOString()
          };
          
          await dbService.pgClient.query(`
            UPDATE public.agent_script
            SET last_result = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
          `, [JSON.stringify(resultToSave), scriptId]);
          
          lastResult = resultToSave;
          console.log(`[API/AGENT-SCRIPTS/:ID/EXECUTE] Результат выполнения сохранён в last_result для скрипта #${scriptId}`);
        } catch (saveError) {
          console.error(`[API/AGENT-SCRIPTS/:ID/EXECUTE] Ошибка сохранения результата для скрипта #${scriptId}:`, saveError);
        }
      }

      // Инкрементируем счётчик использования
      await dbService.incrementUsage(scriptId);

      // Возвращаем результат
      res.json({
        success: true,
        human: humanText,
        raw: rawData,
        scriptId: scriptId,
        cached: false,
        last_result: lastResult
      });

    } catch (error) {
      console.error('[API/AGENT-SCRIPTS/:ID/EXECUTE] Ошибка:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error.message || 'Internal server error'
        });
      }
    }
  });

  // === POST /api/v1/natural-query — основной эндпоинт Natural Query Engine ===
  router.post('/v1/natural-query', async (req, res) => {
    try {
      // Проверяем, что body существует и это объект
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'Request body is required and must be a JSON object'
        });
      }

      const { question, contextCode } = req.body;

      if (!question || typeof question !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Field "question" is required and must be a string'
        });
      }

      if (!contextCode || typeof contextCode !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Field "contextCode" is required and must be a string'
        });
      }

      let scriptId = null;
      let scriptCode = null;
      let cached = false;

      // Шаг 1: Сначала проверяем точное совпадение вопроса
      const exactScript = await dbService.getAgentScriptByExactQuestion(contextCode, question);
      
      if (exactScript) {
        // Точное совпадение найдено — используем его без FTS и без LLM
        scriptId = exactScript.id;
        scriptCode = exactScript.script;
        cached = true;
        
        // Инкрементируем счётчик использования
        await dbService.incrementUsage(scriptId);
        console.log(`[NaturalQuery] Использован скрипт с точным совпадением #${scriptId}`);
      } else {
        // Шаг 1.2: Векторный поиск похожих вопросов
        const config = getConfig();
        const suggestLimit = config.NATURAL_QUERY_SUGGEST_LIMIT || 5;
        const similarityThreshold = config.NATURAL_QUERY_SIMILARITY_THRESHOLD || 0.8;
        const autoUseThreshold = config.NATURAL_QUERY_AUTO_USE_THRESHOLD || 0.95;

        try {
          const questionVector = await embeddings.embedQuery(question);
          const vectorResults = await dbService.searchSimilarQuestions(
            contextCode, 
            questionVector, 
            suggestLimit, 
            similarityThreshold
          );

          if (vectorResults.length > 0) {
            const bestMatch = vectorResults[0];
            
            // Если similarity >= 0.95, возвращаем suggestion с high_confidence
            if (bestMatch.similarity >= autoUseThreshold) {
              console.log(`[NaturalQuery] Найден высокоуверенный match (similarity=${bestMatch.similarity.toFixed(3)}) для скрипта #${bestMatch.id}`);
              
              return res.json({
                success: true,
                high_confidence: true,
                suggestions: [{
                  id: bestMatch.id,
                  question: bestMatch.question,
                  similarity: bestMatch.similarity,
                  usage_count: bestMatch.usage_count,
                  is_valid: bestMatch.is_valid,
                  last_result: bestMatch.last_result
                }]
              });
            } else {
              // Если similarity < 0.95, но >= threshold, возвращаем список suggestions
              console.log(`[NaturalQuery] Найдено ${vectorResults.length} похожих вопросов (лучший similarity=${bestMatch.similarity.toFixed(3)})`);
              
              return res.json({
                success: true,
                high_confidence: false,
                suggestions: vectorResults.map(r => ({
                  id: r.id,
                  question: r.question,
                  similarity: r.similarity,
                  usage_count: r.usage_count,
                  is_valid: r.is_valid,
                  last_result: r.last_result
                }))
              });
            }
          }
        } catch (vectorError) {
          // Если векторный поиск не удался, продолжаем с FTS
          console.error(`[NaturalQuery] Ошибка векторного поиска:`, vectorError);
        }

        // Шаг 1.3: Поиск похожего скрипта в кэше через FTS (fallback)
        const cachedScript = await dbService.fuzzySearchScripts(contextCode, question);
        
        if (cachedScript) {
          // Нашли похожий скрипт — используем его
          scriptId = cachedScript.id;
          scriptCode = cachedScript.script;
          cached = true;
          
          // Инкрементируем счётчик использования
          await dbService.incrementUsage(scriptId);
          console.log(`[NaturalQuery] Использован кэшированный скрипт #${scriptId} (rank: ${cachedScript.rank.toFixed(3)})`);
        } else {
          // Шаг 2: Генерируем новый скрипт через LLM
          console.log(`[NaturalQuery] Генерация нового скрипта для вопроса: "${question}"`);
          
          const prompt = getScriptGenerationPrompt(question);
          const messages = [
            { role: 'system', content: 'Ты генератор async JS-скриптов для анализа кодовой базы. Возвращай только код функции execute, без лишних комментариев и объяснений.' },
            { role: 'user', content: prompt }
          ];

          scriptCode = await callLLM(messages);
          
          // Логируем что пришло от LLM
          const initialNewlines = (scriptCode.match(/\n/g) || []).length;
          console.log(`[NaturalQuery] Ответ от LLM: длина=${scriptCode.length}, переводов строк=${initialNewlines}`);
          
          // Очищаем ответ от markdown code blocks, если есть
          // ВАЖНО: сохраняем переводы строк внутри скрипта!
          // Проверяем наличие markdown блоков
          const trimmedCheck = scriptCode.trim();
          const hasMarkdown = trimmedCheck.startsWith('```');
          console.log(`[NaturalQuery] Markdown блоков: ${hasMarkdown}`);
          
          if (hasMarkdown) {
            // Убираем markdown code blocks с начала и конца, но сохраняем переводы строк в коде
            scriptCode = scriptCode.replace(/^[\s]*```(?:javascript|js)?[\s]*\n?/, '').replace(/\n?[\s]*```[\s]*$/, '');
            // Убираем только пустые строки в самом начале и конце, но сохраняем структуру кода
            scriptCode = scriptCode.replace(/^\n+/, '').replace(/\n+$/, '');
            
            const afterMarkdownNewlines = (scriptCode.match(/\n/g) || []).length;
            console.log(`[NaturalQuery] После удаления markdown: переводов строк=${afterMarkdownNewlines}`);
          } else {
            // Убираем только ведущие/замыкающие пробелы и табы (но НЕ переводы строк \n)
            scriptCode = scriptCode.replace(/^[ \t\r]+/, '').replace(/[ \t\r]+$/, '');
          }

          // Валидация сгенерированного скрипта
          const validation = validateScript(scriptCode);
          if (!validation.valid) {
            console.error(`[NaturalQuery] Сгенерированный скрипт невалиден: ${validation.error}`);
            return res.status(500).json({
              success: false,
              error: `Generated script is invalid: ${validation.error}`,
              human: `Сгенерированный скрипт невалиден: ${validation.error}. Попробуйте переформулировать вопрос или обратитесь к администратору.`,
              script: scriptCode,
              scriptId: null,
              cached: false
            });
          }

          // Сохраняем скрипт в БД (is_valid = false, т.к. ещё не проверен на практике)
          // Логируем количество переводов строк перед сохранением
          const newlineCountBefore = (scriptCode.match(/\n/g) || []).length;
          console.log(`[NaturalQuery] Сохранение скрипта: ${newlineCountBefore} переводов строк в исходном коде`);
          
          const savedScript = await dbService.saveAgentScript(contextCode, question, scriptCode, false);
          scriptId = savedScript.id;
          
          // Проверяем, что вернулось из БД
          const newlineCountAfter = (savedScript.script.match(/\n/g) || []).length;
          console.log(`[NaturalQuery] Сохранён новый скрипт #${scriptId}: ${newlineCountAfter} переводов строк после сохранения`);
          
          if (newlineCountBefore !== newlineCountAfter) {
            console.warn(`[NaturalQuery] ⚠️  Потеря переводов строк: было ${newlineCountBefore}, стало ${newlineCountAfter}`);
          }

          // Векторизуем вопрос и сохраняем эмбеддинг
          try {
            const questionVector = await embeddings.embedQuery(question);
            await dbService.saveQuestionEmbedding(scriptId, questionVector);
            console.log(`[NaturalQuery] Эмбеддинг вопроса сохранён для скрипта #${scriptId}`);
          } catch (embedError) {
            // Не прерываем выполнение, если векторизация не удалась
            console.error(`[NaturalQuery] Ошибка векторизации вопроса для скрипта #${scriptId}:`, embedError);
          }
        }
      }

      // Шаг 3: Выполняем скрипт в sandbox
      let rawData = null;
      let executionError = null;

      try {
        rawData = await executeScript(scriptCode, contextCode, dbService);
        
        // Если скрипт вернул ошибку уточнения
        if (rawData && typeof rawData === 'object' && rawData.error === 'clarify') {
          return res.json({
            success: true,
            human: rawData.message || 'Требуется уточнение вопроса',
            raw: [],
            scriptId: scriptId,
            cached: cached,
            clarify: true
          });
        }

        // Если скрипт выполнился успешно и это новый скрипт — помечаем как валидный
        if (!cached && scriptId) {
          await dbService.pgClient.query(`
            UPDATE public.agent_script
            SET is_valid = true
            WHERE id = $1
          `, [scriptId]);
        }
      } catch (error) {
        executionError = error;
        const errorMessage = error?.message || error?.toString() || 'Unknown error';
        console.error(`[NaturalQuery] Ошибка выполнения скрипта #${scriptId}:`, errorMessage);
        console.error(`[NaturalQuery] Stack trace:`, error?.stack || 'No stack trace');
        console.error(`[NaturalQuery] Скрипт, который вызвал ошибку:`, scriptCode);
        
        // Помечаем скрипт как невалидный
        if (scriptId) {
          await dbService.pgClient.query(`
            UPDATE public.agent_script
            SET is_valid = false
            WHERE id = $1
          `, [scriptId]);
        }

        // Формируем человекочитаемое сообщение об ошибке
        let humanError = `Произошла ошибка при выполнении скрипта: ${errorMessage}`;
        
        // Специальная обработка различных типов ошибок
        if (errorMessage.includes('is not defined')) {
          const variableName = errorMessage.match(/(\w+)\s+is not defined/)?.[1] || 'переменная';
          humanError = `Ошибка в скрипте: переменная '${variableName}' не определена. Проверьте сгенерированный скрипт и убедитесь, что все переменные правильно объявлены.`;
        } else if (errorMessage.includes('Only SELECT') || errorMessage.includes('Only SELECT and WITH')) {
          humanError = `Ошибка безопасности: скрипт пытается выполнить запрос, который не разрешён. Разрешены только SELECT и WITH (CTE) запросы. Проверьте сгенерированный скрипт.`;
        } else if (errorMessage.includes('timeout')) {
          humanError = `Скрипт выполняется слишком долго (таймаут). Попробуйте упростить запрос или разбить его на части.`;
        }

        return res.status(500).json({
          success: false,
          error: `Script execution failed: ${errorMessage}`,
          human: humanError,
          scriptId: scriptId,
          script: scriptCode || null,
          cached: cached
        });
      }

      // Шаг 4: Превращаем rawData в человекочитаемый текст через LLM
      let humanText = '';
      try {
        const humanizePrompt = getHumanizePrompt(question, rawData);
        const humanizeMessages = [
          { role: 'system', content: 'Ты помощник для анализа кодовой базы. Превращай сырые данные в понятный текст на русском языке.' },
          { role: 'user', content: humanizePrompt }
        ];
        
        humanText = await callLLM(humanizeMessages);
      } catch (error) {
        console.error('[NaturalQuery] Ошибка humanize:', error);
        // Если humanize упал, используем fallback
        humanText = `Найдено ${Array.isArray(rawData) ? rawData.length : 1} результат(ов). См. raw данные.`;
      }

      // Шаг 5: Сохраняем результат выполнения в БД (если скрипт выполнился успешно)
      let lastResult = null;
      if (scriptId && !executionError && rawData !== null) {
        try {
          const resultToSave = {
            raw: rawData,
            human: humanText,
            executed_at: new Date().toISOString()
          };
          
          await dbService.pgClient.query(`
            UPDATE public.agent_script
            SET last_result = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
          `, [JSON.stringify(resultToSave), scriptId]);
          
          lastResult = resultToSave;
          console.log(`[NaturalQuery] Результат выполнения сохранён в last_result для скрипта #${scriptId}`);
        } catch (saveError) {
          // Не прерываем выполнение, если сохранение результата не удалось
          console.error(`[NaturalQuery] Ошибка сохранения результата для скрипта #${scriptId}:`, saveError);
        }
      } else if (scriptId && cached) {
        // Для кэшированных скриптов получаем last_result из БД, если есть
        try {
          const result = await dbService.pgClient.query(`
            SELECT last_result
            FROM public.agent_script
            WHERE id = $1
          `, [scriptId]);
          
          if (result.rows.length > 0 && result.rows[0].last_result) {
            lastResult = result.rows[0].last_result;
          }
        } catch (error) {
          // Игнорируем ошибку получения last_result
          console.error(`[NaturalQuery] Ошибка получения last_result для скрипта #${scriptId}:`, error);
        }
      }

      // Шаг 6: Возвращаем результат
      res.json({
        success: true,
        human: humanText,
        raw: rawData,
        scriptId: scriptId,
        cached: cached,
        last_result: lastResult
      });

    } catch (error) {
      console.error('[API/NATURAL-QUERY] Ошибка:', error);
      // Проверяем, что ответ ещё не был отправлен
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error.message || 'Internal server error'
        });
      } else {
        // Если ответ уже отправлен, логируем ошибку
        console.error('[API/NATURAL-QUERY] Критическая ошибка после отправки ответа:', error);
      }
    }
  });

  // POST /api/v1/natural-query/suggest — получить список похожих вопросов
  router.post('/v1/natural-query/suggest', async (req, res) => {
    try {
      // Проверяем, что body существует и это объект
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'Request body is required and must be a JSON object'
        });
      }

      const { question, contextCode } = req.body;

      if (!question || typeof question !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Field "question" is required and must be a string'
        });
      }

      if (!contextCode || typeof contextCode !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Field "contextCode" is required and must be a string'
        });
      }

      const config = getConfig();
      const suggestLimit = parseInt(req.query.limit) || config.NATURAL_QUERY_SUGGEST_LIMIT || 5;
      const similarityThreshold = parseFloat(req.query.threshold) || config.NATURAL_QUERY_SIMILARITY_THRESHOLD || 0.8;
      const autoUseThreshold = config.NATURAL_QUERY_AUTO_USE_THRESHOLD || 0.95;

      // Векторизуем вопрос пользователя
      const questionVector = await embeddings.embedQuery(question);
      
      // Ищем похожие вопросы
      const vectorResults = await dbService.searchSimilarQuestions(
        contextCode,
        questionVector,
        suggestLimit,
        similarityThreshold
      );

      if (vectorResults.length === 0) {
        return res.json({
          success: true,
          high_confidence: false,
          suggestions: []
        });
      }

      const bestMatch = vectorResults[0];
      const highConfidence = bestMatch.similarity >= autoUseThreshold;

      res.json({
        success: true,
        high_confidence: highConfidence,
        suggestions: vectorResults.map(r => ({
          id: r.id,
          question: r.question,
          similarity: r.similarity,
          usage_count: r.usage_count,
          is_valid: r.is_valid,
          last_result: r.last_result
        }))
      });

    } catch (error) {
      console.error('[API/NATURAL-QUERY/SUGGEST] Ошибка:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error.message || 'Internal server error'
        });
      }
    }
  });

  return router;
};

