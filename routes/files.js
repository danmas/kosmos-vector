const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const TextSplitters = require('../packages/core/textSplitters');

// Создаем router, который можно будет экспортировать
const router = express.Router();

// Эта функция будет передавать инстансы сервисов в каждый запрос
module.exports = (dbService, embeddings) => {

  // 1. Регистрация файла (даже без содержимого)
  router.post('/register-file', async (req, res) => {
    try {
      const { filename, contextCode = 'DEFAULT', content = null, filePath = null } = req.body;

      if (!filename) {
        return res.status(400).json({ error: 'filename is required' });
      }

      const { id: fileId, isNew } = await dbService.saveFileInfo(filename, content, filePath, contextCode);

      res.json({
        success: true,
        fileId,
        filename,
        isNew,
        contextCode
      });
    } catch (error) {
      console.error('[REGISTER-FILE] Ошибка:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 2. Создание/обновление ai_item (клиент сам решает, что это за сущность)
  router.post('/create-or-update-ai-item', async (req, res) => {
    try {
      const {
        full_name,
        contextCode = 'DEFAULT',
        type = 'unknown',
        sName = null,
        hName = null,
        fileId = null  // опционально, если известен
      } = req.body;

      if (!full_name) {
        return res.status(400).json({ error: 'full_name is required' });
      }

      const aiItem = await dbService.createAiItem({
        full_name,
        contextCode,
        type,
        sName,
        hName,
        fileId
      });

      res.json({
        success: true,
        aiItem
      });
    } catch (error) {
      console.error('[CREATE-AI-ITEM] Ошибка:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 3. Сохранение чанка любого уровня (с опциональной привязкой к ai_item)
  router.post('/save-chunk', async (req, res) => {
    try {
      const {
        fileId,               // обязателен
        content,              // текст чанка
        chunkIndex,           // порядок в файле
        level = '0-исходник', // любой уровень
        type = 'text',
        sName = null,
        full_name = null,
        hName = null,
        aiItemId = null,      // если клиент уже знает/создал ai_item
        parentChunkId = null  // для иерархии
      } = req.body;

      if (!fileId || content === undefined) {
        return res.status(400).json({ error: 'fileId and content are required' });
      }

      const metadata = { type, level, s_name: sName, full_name: full_name, h_name: hName };
      const { contextCode = null } = req.body;

      // embedding = null — векторизация не нужна
      // Формируем chunkContent: если content - объект с comment, сохраняем его структуру
      // Иначе оборачиваем в { text: content }
      let chunkContent;
      if (content && typeof content === 'object' && !Array.isArray(content)) {
        // Если content уже объект, проверяем наличие comment на верхнем уровне
        if (content.comment !== undefined) {
          // content уже содержит comment на верхнем уровне - используем как есть
          chunkContent = content;
          console.log(`[SAVE-CHUNK] 📝 Обнаружен comment для full_name="${full_name}": ${content.comment.substring(0, 100)}${content.comment.length > 100 ? '...' : ''}`);
        } else {
          // content - объект без comment, оборачиваем в text
          chunkContent = { text: content };
        }
      } else {
        // content - строка или другой тип, оборачиваем в text
        chunkContent = { text: content };
      }

      const chunkId = await dbService.saveChunkVector(
        fileId,
        chunkContent,
        null,               // без эмбеддинга
        metadata,
        parentChunkId,
        contextCode
      );
      
      if (level === '0-исходник' && full_name && chunkContent.comment) {
        console.log(`[SAVE-CHUNK] ✅ Комментарий будет сохранен в ai_comment для: "${full_name}" (context: "${contextCode}")`);
      }

      // Если это уровень 0 и есть full_name — ai_item создастся автоматически в saveChunkVector
      // Если клиент хочет привязать к существующему ai_item — передаёт aiItemId
      if (aiItemId) {
        await dbService.pgClient.query(
          'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
          [aiItemId, chunkId]
        );
      }

      res.json({
        success: true,
        chunkId,
        level,
        aiItemCreated: level === '0-исходник' && full_name ? true : false
      });
    } catch (error) {
      console.error('[SAVE-CHUNK] Ошибка:', error);
      res.status(500).json({ error: error.message });
    }
  });


// === роуты очистки DB ===

  // Полная логическая очистка
  router.post('/clear-database', async (req, res) => {
    try {
      const { confirm } = req.body;
      if (!confirm || confirm !== true) {
        return res.status(400).json({ 
          error: 'Confirmation required', 
          message: 'To clear the database, send { "confirm": true } in the request body.' 
        });
      }
      console.log('[CLEAR-DB] Запуск полной очистки базы данных (clearAllTables)...');
      await dbService.clearAllTables();  // ← dbService доступен здесь
      res.json({ 
        success: true, 
        message: 'Database has been completely cleared.',
        method: 'clearAllTables'
      });
    } catch (error) {
      console.error('[CLEAR-DB] Ошибка при очистке:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Жёсткая очистка
  router.post('/truncate-database', async (req, res) => {
    try {
      const { confirm } = req.body;
      if (!confirm || confirm !== true) {
        return res.status(400).json({ 
          error: 'Confirmation required', 
          message: 'To truncate the database, send { "confirm": true } in the request body.' 
        });
      }
      console.log('[TRUNCATE-DB] Запуск жёсткой очистки базы данных (truncateAllTables)...');
      await dbService.truncateAllTables();  // ← dbService доступен здесь
      res.json({ 
        success: true, 
        message: 'Database has been truncated.',
        method: 'truncateAllTables'
      });
    } catch (error) {
      console.error('[TRUNCATE-DB] Ошибка при TRUNCATE:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Очистка осиротевших AI Items
  router.post('/cleanup-orphaned-ai-items', async (req, res) => {
    try {
      const { confirm } = req.body;
      if (!confirm || confirm !== true) {
        return res.status(400).json({ error: 'Confirmation required' });
      }
      console.log('[CLEANUP] Запуск очистки осиротевших AI Item...');
      const { contextCode = null } = req.body;
      const deletedItems = await dbService.cleanupOrphanedAiItems(contextCode);
      res.json({ 
        success: true, 
        message: `Cleanup completed. Removed ${deletedItems.length} orphaned AI items.`,
        deletedItems
      });
    } catch (error) {
      console.error('[CLEANUP] Ошибка:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // === КОНЕЦ роутов очистки DB ===

    // --- Роуты для документов и файлов ---

    // Получение списка всех файлов (и alias /documents)
    router.get(['/files', '/documents'], async (req, res) => {
        try {
            const contextCode = req.query.contextCode || req.query['context-code'] || null;
            const files = await dbService.getAllFiles(contextCode);
            res.json(files);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Получение информации о файле
    router.get('/file-info/:filename', async (req, res) => {
        try {
            const { filename } = req.params;
            const fileInfo = await dbService.getFileByFilename(decodeURIComponent(filename));
            if (!fileInfo) {
                return res.status(404).json({ error: 'File not found' });
            }
            res.json({ file: fileInfo });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Получение содержимого файла
    router.get('/file-content/:filename', async (req, res) => {
        try {
            const { filename } = req.params;
            if (!filename) {
                return res.status(400).json({ error: 'filename is required' });
            }

            const decodedFilename = decodeURIComponent(filename);
            const normalizedInput = path
                .normalize(decodedFilename)
                .replace(/^(\.\.[/\\])+/, '');
            const baseFilename = path.basename(normalizedInput) || normalizedInput;

            // Получаем информацию о файле из базы данных
            const fileInfo = await dbService.getFileByFilename(baseFilename);
            if (!fileInfo) {
                return res.status(404).json({ error: 'File not found in database' });
            }
            
            // Пробуем читать файл напрямую из базы (если content сохранен)
            if (fileInfo.content) {
                return res.json({ content: fileInfo.content });
            }
            
            const docsDirSetting = process.env.DOCS_DIR || 'docs';
            const docsDir = path.isAbsolute(docsDirSetting)
                ? docsDirSetting
                : path.join(process.cwd(), docsDirSetting);

            const candidatePaths = [];

            if (fileInfo.file_url) {
                candidatePaths.push(fileInfo.file_url);
            }

            if (path.isAbsolute(normalizedInput)) {
                candidatePaths.push(normalizedInput);
            } else {
                const docsPrefixRegex = new RegExp(`^docs[\\\\/]`, 'i');
                if (docsPrefixRegex.test(normalizedInput)) {
                    const relativeToDocs = normalizedInput.replace(docsPrefixRegex, '');
                    if (relativeToDocs) {
                        candidatePaths.push(path.join(docsDir, relativeToDocs));
                    }
                } else if (normalizedInput && normalizedInput !== baseFilename) {
                    candidatePaths.push(path.join(docsDir, normalizedInput));
                }

            }

            candidatePaths.push(path.join(docsDir, baseFilename));

            const uniquePaths = [...new Set(candidatePaths)];
            let content = null;

            for (const candidatePath of uniquePaths) {
                if (!candidatePath) continue;
                try {
                    content = await fs.readFile(candidatePath, 'utf-8');
                    break;
                } catch (fileError) {
                    if (fileError.code !== 'ENOENT') {
                        throw fileError;
                    }
                }
            }

            if (content === null) {
                console.warn(`[FILES] File not found on filesystem. Tried paths: ${uniquePaths.join(', ')}`);
                return res.status(404).json({ error: 'File not found on filesystem' });
            }

            res.json({ content });
        } catch (error) {
            console.error('Error reading file content:', error);
            res.status(500).json({ error: error.message });
        }
    });
    
    // Получение содержимого файла напрямую из базы данных (без проверки файловой системы)
    router.get('/db-file-content/:filename', async (req, res) => {
        try {
            const { filename } = req.params;
            const decodedFilename = decodeURIComponent(filename);
            
            console.log(`[DB-CONTENT] Запрос содержимого файла ${decodedFilename} из БД`);
            
            // Получаем информацию о файле из базы данных
            const fileInfo = await dbService.getFileByFilename(decodedFilename);
            if (!fileInfo) {
                console.log(`[DB-CONTENT] Файл ${decodedFilename} не найден в БД`);
                return res.status(404).json({ error: 'File not found in database' });
            }
            
            // Если в БД нет содержимого, пробуем получить его из чанков
            if (!fileInfo.content) {
                console.log(`[DB-CONTENT] Содержимое файла ${decodedFilename} не найдено в БД, пробуем получить из чанков`);
                
                // Получаем чанки файла
                const contextCode = req.query.contextCode || req.query['context-code'] || null;
                const result = await dbService.getFileChunks(decodedFilename, contextCode);
                if (!result.exists || !result.chunks || result.chunks.length === 0) {
                    console.log(`[DB-CONTENT] Чанки для файла ${decodedFilename} не найдены`);
                    return res.status(404).json({ error: 'File content not found in database and no chunks available' });
                }
                
                // Собираем содержимое из чанков
                let content = `/* Содержимое файла ${decodedFilename} восстановлено из чанков */\n\n`;
                result.chunks.forEach((chunk, index) => {
                    content += `/* Чанк ${index + 1}: ${chunk.full_name || chunk.s_name || 'Без имени'} */\n`;
                    content += chunk.chunk_content + "\n\n";
                });
                
                console.log(`[DB-CONTENT] Содержимое файла ${decodedFilename} восстановлено из ${result.chunks.length} чанков`);
                return res.json({ content });
            }
            
            // Возвращаем содержимое из БД
            console.log(`[DB-CONTENT] Содержимое файла ${decodedFilename} успешно получено из БД`);
            return res.json({ content: fileInfo.content });
            
        } catch (error) {
            console.error(`[DB-CONTENT] Ошибка при получении содержимого файла из БД:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    // Получение всех кодов контекста
    router.get('/context-codes', async (req, res) => {
        try {
            const codes = await dbService.getContextCodes();
            res.json(codes);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Для совместимости с документацией
    router.get('/get-context-codes', async (req, res) => {
        try {
            const contexts = await dbService.getContextCodes();
            res.json({ contexts });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Обновление кода контекста для файла
    router.post('/update-context/:filename', async (req, res) => {
        try {
            const { filename } = req.params;
            const { contextCode } = req.body;

            if (!contextCode) {
                return res.status(400).json({ error: 'contextCode is required' });
            }

            const fileInfo = await dbService.getFileInfo(decodeURIComponent(filename), contextCode);
            if (!fileInfo.exists) {
                return res.status(404).json({ error: 'File not found' });
            }

            await dbService.updateContextCode(fileInfo.id, contextCode);
            res.json({ success: true, message: `Context code for ${filename} updated to ${contextCode}` });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Удаление файла
    router.delete('/file/:filename', async (req, res) => {
        try {
            const { filename } = req.params;
            const contextCode = req.query.contextCode || req.query['context-code'] || null;
            const fileInfo = await dbService.getFileInfo(decodeURIComponent(filename), contextCode);
            if (!fileInfo.exists) {
                return res.status(404).json({ error: 'File not found' });
            }
            await dbService.deleteFile(fileInfo.id);
            res.json({ success: true, message: `File ${filename} deleted successfully.` });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Альтернативный метод удаления файла через POST
    router.post('/delete-file', async (req, res) => {
        try {
            const { filename, deleteFromDisk } = req.body;
            if (!filename) {
                return res.status(400).json({ error: 'filename is required' });
            }

            const contextCode = req.body.contextCode || req.query.contextCode || req.query['context-code'] || null;
            const fileInfo = await dbService.getFileInfo(filename, contextCode);
            if (!fileInfo.exists) {
                return res.status(404).json({ error: 'File not found' });
            }

            // Удаляем файл из базы данных
            const fileId = fileInfo.id;
            const deletedAiItems = await dbService.deleteFileAiItems(fileId);
            const deletedChunks = await dbService.deleteFileVectors(fileId);
            await dbService.deleteFile(fileId);

            // Если требуется, удаляем файл с диска
            let fileDeletedFromDisk = false;
            if (deleteFromDisk) {
                try {
                    const docsDir = process.env.DOCS_DIR || 'docs';
                    const filePath = path.join(docsDir, filename);
                    await fs.unlink(filePath);
                    fileDeletedFromDisk = true;
                } catch (diskError) {
                    console.error(`Error deleting file from disk: ${diskError.message}`);
                }
            }

            res.json({
                success: true,
                message: `File ${filename} deleted successfully.`,
                deletedAiItemsCount: deletedAiItems.length,
                deletedChunksCount: deletedChunks.length,
                fileId,
                fileDeletedFromDisk
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // --- Роуты для чанков ---

    // Получение чанков файла
    router.get('/file-chunks/:filename', async (req, res) => {
        try {
            const { filename } = req.params;
            const contextCode = req.query.contextCode || req.query['context-code'] || null;
            const result = await dbService.getFileChunks(decodeURIComponent(filename), contextCode);
            if (!result.exists) {
                return res.status(404).json({ error: 'File not found' });
            }
            res.json({ success: true, filename, chunks: result.chunks });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    // Получение чанка по ID
    router.get('/chunk/:chunkId', async (req, res) => {
        try {
            const { chunkId } = req.params;
            console.log(`[CHUNK] Запрос чанка по ID: ${chunkId}`);
            
            // Получаем чанк из БД
            const chunk = await dbService.getChunkById(chunkId);
            if (!chunk) {
                console.log(`[CHUNK] Чанк с ID ${chunkId} не найден`);
                return res.status(404).json({ error: 'Chunk not found' });
            }
            
            console.log(`[CHUNK] Чанк с ID ${chunkId} успешно найден`);
            res.json({ success: true, chunk });
        } catch (error) {
            console.error(`[CHUNK] Ошибка при получении чанка:`, error);
            res.status(500).json({ error: error.message });
        }
    });
    
    // Получение чанка по индексу
    router.get('/chunk-by-index/:index', async (req, res) => {
        try {
            const { index } = req.params;
            console.log(`[CHUNK] Запрос чанка по индексу: ${index}`);
            
            // Проверяем, что индекс является числом
            const chunkIndex = parseInt(index);
            if (isNaN(chunkIndex)) {
                return res.status(400).json({ error: 'Invalid chunk index' });
            }
            
            // Получаем чанк из БД по индексу
            // Извлекаем поле text из JSONB, если оно есть, иначе весь JSONB как текст
            const result = await dbService.pgClient.query(`
                SELECT fv.id, fv.file_id, 
                       COALESCE(fv.chunk_content->>'text', fv.chunk_content::text) as chunk_content, 
                       fv.chunk_index, fv.type, fv.level, 
                       fv.s_name, fv.full_name, fv.h_name, fv.created_at, fv.ai_item_id,
                       f.filename, f.context_code
                FROM public.chunk_vector fv
                JOIN public.files f ON fv.file_id = f.id
                WHERE fv.chunk_index = $1
                LIMIT 1
            `, [chunkIndex]);
            
            if (result.rows.length === 0) {
                console.log(`[CHUNK] Чанк с индексом ${chunkIndex} не найден`);
                return res.status(404).json({ error: 'Chunk not found' });
            }
            
            const chunk = result.rows[0];
            console.log(`[CHUNK] Чанк с индексом ${chunkIndex} успешно найден, ID: ${chunk.id}`);
            res.json({ success: true, chunk });
        } catch (error) {
            console.error(`[CHUNK] Ошибка при получении чанка по индексу:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    // Обновление метаданных чанка (type, level)
    router.post('/update-chunk/:chunkId', async (req, res) => {
        try {
            const { chunkId } = req.params;
            const { type, level } = req.body;
            const result = await dbService.updateChunkMetadata(chunkId, { type, level });
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Обновление имен чанка (s_name, full_name, h_name)
    router.post('/update-chunk-names/:chunkId', async (req, res) => {
        try {
            const { chunkId } = req.params;
            const { s_name, full_name, h_name } = req.body;
            const result = await dbService.updateChunkNames(chunkId, { s_name, full_name, h_name });
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Векторизация конкретного чанка по ID
    router.post('/vectorize-chunk/:chunkId', async (req, res) => {
        try {
            const { chunkId } = req.params;
            const { force = false } = req.body; // force=true перезапишет существующий embedding
            
            // 1. Получаем чанк и извлекаем текст из chunk_content (JSONB)
            const chunkResult = await dbService.pgClient.query(
                `SELECT id, 
                       COALESCE(chunk_content->>'text', chunk_content::text) as text_content,
                       embedding 
                FROM public.chunk_vector WHERE id = $1`,
                [chunkId]
            );
            
            if (chunkResult.rows.length === 0) {
                return res.status(404).json({ error: `Чанк #${chunkId} не найден` });
            }
            
            const chunk = chunkResult.rows[0];
            
            // 2. Проверяем, нужна ли векторизация
            if (chunk.embedding && !force) {
                return res.json({ 
                    success: true, 
                    skipped: true, 
                    message: `Чанк #${chunkId} уже имеет embedding. Используйте force=true для перезаписи` 
                });
            }
            
            // 3. Проверяем наличие текста
            if (!chunk.text_content || chunk.text_content.trim() === '') {
                return res.status(400).json({ error: `Чанк #${chunkId} имеет пустой контент` });
            }
            
            const text = chunk.text_content;
            
            // 4. Создаем embedding
            const [embedding] = await embeddings.embedDocuments([text]);
            const vectorString = `[${embedding.join(',')}]`;
            
            // 5. Обновляем запись
            await dbService.pgClient.query(
                `UPDATE public.chunk_vector SET embedding = $1 WHERE id = $2`,
                [vectorString, chunkId]
            );
            
            console.log(`[VECTORIZE-CHUNK] Чанк #${chunkId} векторизован`);
            
            res.json({ 
                success: true, 
                chunkId: parseInt(chunkId),
                vectorDimension: embedding.length,
                textLength: text.length
            });
            
        } catch (error) {
            console.error(`[VECTORIZE-CHUNK] Ошибка:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    // Сохранение чанка уровня 1 или 2
    router.post('/save-level-chunk-db', async (req, res) => {
        try {
            const { filename, parentChunkId, content, level, type, aiItemId } = req.body;
            
            if (!filename || !parentChunkId || !content || !level || !type) {
                return res.status(400).json({ error: 'Required fields missing' });
            }

            // Получаем информацию о файле
            const fileInfo = await dbService.getFileByFilename(filename);
            if (!fileInfo) {
                return res.status(404).json({ error: 'File not found' });
            }

            // Создаем embedding для контента
            const [embedding] = await embeddings.embedDocuments([content]);

            // Сохраняем чанк
            // Обертываем content в JSON объект для JSONB
            const chunkId = await dbService.saveChildChunk(
                fileInfo.id,
                parentChunkId,
                { text: content },
                embedding,
                level,
                type,
                {},
                aiItemId
            );

            res.json({ success: true, message: 'Chunk saved successfully', chunkId });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Сохранение чанка в файл
    router.post('/api/v1/save-chunk-file', async (req, res) => {
        try {
            const { content, type, sName, level } = req.body;
            if (!content) {
                return res.status(400).json({ error: 'Content is required' });
            }

            // Формируем имя файла на основе метаданных
            const filename = `${sName || 'chunk'}_${type || 'unknown'}_${level || 'L0'}.txt`;
            const outputDir = process.env.OUTPUT_DOCS_DIR || 'output';
            
            // Создаем директорию, если не существует
            try {
                await fs.mkdir(outputDir, { recursive: true });
            } catch (err) {
                if (err.code !== 'EEXIST') throw err;
            }
            
            const filePath = path.join(outputDir, filename);
            await fs.writeFile(filePath, content, 'utf-8');
            
            res.json({ success: true, filePath });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // --- Роуты для векторизации ---

    // Векторизация файла (поддерживает и /vectorize и /vectorize/:filename)
    router.post(['/vectorize', '/vectorize/:filename'], async (req, res) => {
        try {
            // Получаем filename из URL параметра или из body
            const urlFileName = req.params.filename ? decodeURIComponent(req.params.filename) : null;
            const { fileName: bodyFileName, filePath: bodyFilePath, contextCode, params = {}, vectorizationParams } = req.body;
            
            // Используем vectorizationParams, если они предоставлены, иначе params
            const finalParams = vectorizationParams || params;
            
            const fileName = urlFileName || bodyFileName;
            
            if (!fileName && !bodyFilePath) {
                return res.status(400).json({ error: 'fileName or filePath is required' });
            }

            // Сначала пробуем найти файл в базе данных, чтобы получить реальный путь
            let filePath = bodyFilePath;
            
            if (!filePath) {
                // Получаем информацию о файле из базы данных
                const fileInfo = await dbService.getFileByFilename(fileName);
                
                if (fileInfo && fileInfo.id) {
                    // Используем file_url из базы или конструируем путь
                    const contextCode = req.body.contextCode || req.query.contextCode || req.query['context-code'] || null;
                    const dbFileInfo = await dbService.getFileById(fileInfo.id, contextCode);
                    if (dbFileInfo && dbFileInfo.file_url) {
                        filePath = dbFileInfo.file_url;
                    }
                }
                
                // Если не нашли в базе, ищем в стандартной папке docs
                if (!filePath) {
                    filePath = path.join(process.env.DOCS_DIR || 'docs', fileName);
                }
            }
            
            // Проверка существования файла
            try {
                await fs.access(filePath);
            } catch {
                return res.status(404).json({ error: `File not found at ${filePath}. Make sure the file exists and the path is correct.` });
            }
            
            const finalFileName = fileName || path.basename(filePath);

            const fileContent = await fs.readFile(filePath, 'utf-8');
            const fileExtension = path.extname(finalFileName).toLowerCase();

            let chunks;
            console.log(`[VECTORIZE] Начинаем разбиение файла ${finalFileName} (${fileExtension})`);
            
            if (fileExtension === '.js') {
                console.log(`[VECTORIZE] Разбиваем JavaScript файл...`);
                chunks = TextSplitters.splitJavaScriptByObjects(fileContent, finalParams);
                console.log(`[VECTORIZE] JavaScript разбит на ${chunks.length} чанков`);
                
                // Выводим метаданные каждого чанка
                chunks.forEach((chunk, index) => {
                    console.log(`[VECTORIZE] Чанк ${index}: type=${chunk.metadata.type}, full_name=${chunk.metadata.full_name}, s_name=${chunk.metadata.s_name}`);
                });
            } else if (fileExtension === '.sql') {
                console.log(`[VECTORIZE] Разбиваем SQL файл...`);
                chunks = TextSplitters.splitSqlByObjects(fileContent, finalParams);
                console.log(`[VECTORIZE] SQL разбит на ${chunks.length} чанков`);
            } else if (fileExtension === '.md') {
                console.log(`[VECTORIZE] Разбиваем Markdown файл...`);
                chunks = TextSplitters.splitMarkdownBySections(fileContent, finalParams);
                console.log(`[VECTORIZE] Markdown разбит на ${chunks.length} чанков`);
                
                // Выводим метаданные каждого чанка
                chunks.forEach((chunk, index) => {
                    console.log(`[VECTORIZE] MD Чанк ${index}: type=${chunk.metadata.type}, full_name=${chunk.metadata.full_name}, h_name=${chunk.metadata.h_name}`);
                });
            } else {
                console.log(`[VECTORIZE] Неизвестное расширение, создаем один чанк`);
                chunks = [{ content: fileContent, metadata: { type: 'text', level: '0-исходник' } }];
            }

            const { id: fileId, isNew } = await dbService.saveFileInfo(finalFileName, fileContent, null, contextCode);
            
            // Удаляем существующие векторы перед добавлением новых
            console.log(`[VECTORIZE] Удаляем существующие векторы для файла с ID ${fileId}...`);
            await dbService.deleteFileVectors(fileId);

            console.log(`[VECTORIZE] Сохраняем ${chunks.length} чанков в базу данных...`);
            
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                console.log(`[VECTORIZE] Обрабатываем чанк ${i}: ${chunk.metadata.type}, full_name=${chunk.metadata.full_name}`);
                
                const [embedding] = await embeddings.embedDocuments([chunk.content]);
                console.log(`[VECTORIZE] Создан embedding для чанка ${i}`);
                
                // Обертываем content в JSON объект для JSONB
                const chunkId = await dbService.saveChunkVector(fileId, { text: chunk.content }, embedding, chunk.metadata, null, contextCode);
                console.log(`[VECTORIZE] Чанк ${i} сохранен с ID: ${chunkId}`);
            }
            
            console.log(`[VECTORIZE] Все чанки сохранены для файла ${finalFileName}`);

            res.json({ 
                success: true, 
                isNew, 
                chunks_count: chunks.length, 
                contextUpdated: !!contextCode,
                unchanged: false,
                vectorizationParams: finalParams
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: error.message });
        }
    });

    // Специализированные эндпоинты для векторизации разных типов файлов
    router.post('/vectorize-sql/:filename', async (req, res) => {
        try {
            const { filename } = req.params;
            const { contextCode = 'DEFAULT', defaultSchema = 'public' } = req.body;
            
            // Перенаправляем на общий эндпоинт с правильными параметрами
            req.params = {}; // Сбрасываем параметры
            req.body = {
                fileName: filename,
                contextCode,
                params: { defaultSchema }
            };
            
            // Вызываем обработчик общего эндпоинта
            await router.handle(req, res, '/vectorize');
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/vectorize-js/:filename', async (req, res) => {
        try {
            const { 
                contextCode = 'DEFAULT', 
                chunkSize = 10000, 
                chunkOverlap = 0, 
                forceRevectorization = false,
                includeComments = true, 
                parseImports = true 
            } = req.body;
            
            const { filename } = req.params;
            
            // Перенаправляем на общий эндпоинт с правильными параметрами
            req.params = {}; // Сбрасываем параметры
            req.body = {
                fileName: filename,
                contextCode,
                params: { 
                    chunkSize, 
                    chunkOverlap, 
                    forceRevectorization,
                    includeComments, 
                    parseImports 
                }
            };
            
            // Вызываем обработчик общего эндпоинта
            await router.handle(req, res, '/vectorize');
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/vectorize-md/:filename', async (req, res) => {
        try {
            const { 
                contextCode = 'DEFAULT', 
                chunkSize = 200, 
                chunkOverlap = 50, 
                forceRevectorization = false 
            } = req.body;
            
            const { filename } = req.params;
            
            // Перенаправляем на общий эндпоинт с правильными параметрами
            req.params = {}; // Сбрасываем параметры
            req.body = {
                fileName: filename,
                contextCode,
                params: { 
                    chunkSize, 
                    chunkOverlap, 
                    forceRevectorization 
                }
            };
            
            // Вызываем обработчик общего эндпоинта
            await router.handle(req, res, '/vectorize');
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/vectorize-java/:filename', async (req, res) => {
        try {
            const { 
                contextCode = 'DEFAULT', 
                chunkSize = 200, 
                chunkOverlap = 50, 
                forceRevectorization = false 
            } = req.body;
            
            const { filename } = req.params;
            
            // Перенаправляем на общий эндпоинт с правильными параметрами
            req.params = {}; // Сбрасываем параметры
            req.body = {
                fileName: filename,
                contextCode,
                params: { 
                    chunkSize, 
                    chunkOverlap, 
                    forceRevectorization 
                }
            };
            
            // Вызываем обработчик общего эндпоинта
            await router.handle(req, res, '/vectorize');
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Новый эндпоинт для сканирования и векторизации
    router.post('/scan-and-vectorize', async (req, res) => {
        try {
            const { folderPath } = req.body;
            if (!folderPath) {
                return res.status(400).json({ error: 'folderPath is required' });
            }

            const vectorized_files = [];
            const errors = [];
            let total_files = 0;

            // Рекурсивная функция для обхода директорий
            async function scanDirectory(dir) {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        await scanDirectory(fullPath);
                    } else if (entry.isFile()) {
                        total_files++;
                        const fileExtension = path.extname(entry.name).toLowerCase();
                        const supportedExtensions = ['.js', '.sql', '.md', '.txt']; // Можно вынести в конфиг
                        
                        if (supportedExtensions.includes(fileExtension)) {
                            try {
                                // Логика, аналогичная /vectorize
                                const fileContent = await fs.readFile(fullPath, 'utf-8');
                                
                                let chunks;
                                if (fileExtension === '.js') {
                                    chunks = TextSplitters.splitJavaScriptByObjects(fileContent);
                                } else if (fileExtension === '.sql') {
                                    chunks = TextSplitters.splitSqlByObjects(fileContent);
                                } else if (fileExtension === '.md') {
                                    chunks = TextSplitters.splitMarkdownBySections(fileContent);
                                } else {
                                    chunks = [{ content: fileContent, metadata: { type: 'text', level: '0-исходник' } }];
                                }

                                const contextCode = req.body.contextCode || req.query.contextCode || req.query['context-code'] || null;
                                const { id: fileId } = await dbService.saveFileInfo(entry.name, fileContent, fullPath, contextCode);
                                
                                // Удаляем существующие векторы перед добавлением новых
                                await dbService.deleteFileVectors(fileId);

                                for (let i = 0; i < chunks.length; i++) {
                                    const chunk = chunks[i];
                                    const [embedding] = await embeddings.embedDocuments([chunk.content]);
                                    // Обертываем content в JSON объект для JSONB
                                    await dbService.saveChunkVector(fileId, { text: chunk.content }, embedding, chunk.metadata, null, contextCode);
                                }
                                
                                vectorized_files.push({ file: entry.name, chunks_count: chunks.length });

                            } catch (e) {
                                errors.push({ file: entry.name, error: e.message });
                            }
                        }
                    }
                }
            }

            await scanDirectory(folderPath);

            res.json({ 
                success: true, 
                message: `Scan complete. Found ${total_files} files.`,
                total_files,
                vectorized_files,
                errors
            });

        } catch (error) {
            console.error('Error during scan-and-vectorize:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Сканирование директории
    router.post('/scan-folder', async (req, res) => {
        try {
            const dirPath = req.body.path || process.env.DOCS_DIR || 'docs';
            const files = await fs.readdir(dirPath);
            const supportedExtensions = ['.txt', '.sql', '.js', '.jsx', '.ts', '.tsx', '.java', '.md', '.markdown'];
            let addedCount = 0;

            for (const file of files) {
                const filePath = path.join(dirPath, file);
                const stat = await fs.stat(filePath);
                if (stat.isFile() && supportedExtensions.includes(path.extname(file).toLowerCase())) {
                    const contextCode = req.body.contextCode || req.query.contextCode || req.query['context-code'] || null;
                    const { needsVectorization } = await dbService.needsVectorization(file, contextCode);
                    if (needsVectorization) {
                        const fileContent = await fs.readFile(filePath, 'utf-8');
                        await dbService.saveFileInfo(file, fileContent, null, contextCode);
                        addedCount++;
                    }
                }
            }
            res.json({ success: true, path: dirPath, files, filesCount: files.length, addedCount });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Получение пути к документам
    router.get('/docs-path', async (req, res) => {
        try {
            const docsPath = process.env.DOCS_DIR || path.join(process.cwd(), 'docs');
            res.json({ path: docsPath, success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Возвращаем router
    return router;

};

