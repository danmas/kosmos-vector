// DbService.js
const fs = require('fs');
const path = require('path');

/**
 * Сервис для работы с базой данных PostgreSQL
 */
class DbService {
  constructor(pgClient, config = {}) {
    this.pgClient = pgClient;
    this.docsDir = config.docsDir || path.join(process.cwd(), "docs");
  }

  /**
   * Инициализация схемы базы данных
   */
  async initializeSchema() {
    try {
      console.log("Инициализация схемы базы данных...");

      // Создание таблицы files
      await this.pgClient.query(`
        CREATE TABLE IF NOT EXISTS public.files (
          id SERIAL PRIMARY KEY,
          filename TEXT NOT NULL UNIQUE,
          context_code TEXT NOT NULL DEFAULT 'DEFAULT',
          file_hash TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          modified_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log("Таблица files создана или уже существует");

      // Создание таблицы ai_item
      await this.pgClient.query(`
        CREATE TABLE IF NOT EXISTS public.ai_item (
          id SERIAL PRIMARY KEY,
          full_name TEXT NOT NULL,
          context_code TEXT NOT NULL DEFAULT 'DEFAULT',
          file_id INTEGER REFERENCES public.files(id) ON DELETE SET NULL,
          type TEXT,
          s_name TEXT,
          h_name TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log("Таблица ai_item создана или уже существует");

      // Создание индексов для ai_item
      await this.pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_ai_item_full_name ON public.ai_item(full_name);
        CREATE INDEX IF NOT EXISTS idx_ai_item_context_code ON public.ai_item(context_code);
      `);
      console.log("Индексы для ai_item созданы или уже существуют");

      // Создание таблицы file_vectors
      await this.pgClient.query(`
        CREATE TABLE IF NOT EXISTS public.file_vectors (
          id SERIAL PRIMARY KEY,
          file_id INTEGER REFERENCES public.files(id) ON DELETE CASCADE,
          ai_item_id INTEGER REFERENCES public.ai_item(id) ON DELETE SET NULL,
          parent_chunk_id INTEGER REFERENCES public.file_vectors(id) ON DELETE CASCADE,
          chunk_content JSONB NOT NULL,
          embedding VECTOR,
          chunk_index INTEGER,
          type TEXT DEFAULT 'текст',
          level TEXT DEFAULT '0', 
          s_name TEXT,
          h_name TEXT,
          full_name TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log("Таблица file_vectors создана или уже существует");

      // Добавляем поля content и updated_at, если их нет
      await this.pgClient.query(`
        ALTER TABLE public.file_vectors
          ADD COLUMN IF NOT EXISTS content JSONB,
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE
      `);

      // Создание индексов для ускорения поиска
      await this.pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_file_vectors_file_id ON public.file_vectors(file_id);
        CREATE INDEX IF NOT EXISTS idx_file_vectors_parent_chunk_id ON public.file_vectors(parent_chunk_id);
        CREATE INDEX IF NOT EXISTS idx_file_vectors_ai_item_id ON public.file_vectors(ai_item_id);
      `);
      console.log("Индексы для file_vectors созданы или уже существуют");

      console.log("Инициализация схемы базы данных завершена");
      return true;
    } catch (error) {
      console.error("Ошибка при инициализации схемы базы данных:", error);
      throw error;
    }
  }

  /**
   * Проверка, требуется ли векторизация файла
   * @param {string} fileName - Имя файла
   * @param {string|null} contextCode - Код контекста для фильтрации (опционально)
   */
  async needsVectorization(fileName, contextCode = null) {
    try {
      // Получение информации о файле из базы данных
      let query = `SELECT id, modified_at FROM public.files WHERE filename = $1`;
      const params = [fileName];
      
      if (contextCode) {
        query += ' AND context_code = $2';
        params.push(contextCode);
      }
      
      const fileResult = await this.pgClient.query(query, params);

      // Если файл не найден в базе, требуется векторизация
      if (fileResult.rows.length === 0) {
        return { needsVectorization: true, fileId: null };
      }

      const fileId = fileResult.rows[0].id;
      const dbModifiedAt = new Date(fileResult.rows[0].modified_at);

      // Получение информации о файле из файловой системы
      const filePath = path.join(this.docsDir, fileName);
      if (!fs.existsSync(filePath)) {
        // Файл удален из файловой системы, но есть в базе
        return { needsVectorization: false, fileId };
      }

      const stats = fs.statSync(filePath);
      const fileModifiedAt = new Date(stats.mtime);

      // Сравнение времени модификации
      const needsVectorization = fileModifiedAt > dbModifiedAt;

      return { needsVectorization, fileId };
    } catch (error) {
      console.error(`Ошибка при проверке необходимости векторизации файла ${fileName}:`, error);
      throw error;
    }
  }

  /**
   * Сохранение информации о файле
   * @param {string} fileName - Имя файла
   * @param {string|null} fileContent - Содержимое файла
   * @param {string|null} filePath - Путь к файлу
   * @param {string|null} contextCode - Код контекста для сохранения (опционально)
   */
  async saveFileInfo(fileName, fileContent, filePath, contextCode = null) {
    try {
      // Получение информации о файле из файловой системы
      const absolutePath = filePath || path.join(this.docsDir, fileName);
      
      const baseFileName = path.basename(fileName);
      
      let modifiedAt = new Date();

      try {
        await fs.promises.access(absolutePath);
        const stats = await fs.promises.stat(absolutePath);
        modifiedAt = stats.mtime;
      } catch (e) {
        // file doesn't exist locally, use current time
      }

      const fileResult = await this.pgClient.query(
        `SELECT id FROM public.files WHERE filename = $1`,
        [baseFileName]
      );

      let fileId;
      let isNew = false;

      if (fileResult.rows.length === 0) {
        // INSERT - используем contextCode или 'DEFAULT'
        const finalContextCode = contextCode || 'DEFAULT';
        const insertResult = await this.pgClient.query(
          `INSERT INTO public.files (filename, file_url, modified_at, content, context_code)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [baseFileName, absolutePath, modifiedAt, fileContent, finalContextCode]
        );
        fileId = insertResult.rows[0].id;
        isNew = true;
      } else {
        fileId = fileResult.rows[0].id;
        // UPDATE - обновляем context_code если передан
        if (contextCode) {
          await this.pgClient.query(
            `UPDATE public.files
             SET file_url = $1, modified_at = $2, content = $3, context_code = $4
             WHERE id = $5`,
            [absolutePath, modifiedAt, fileContent, contextCode, fileId]
          );
        } else {
          await this.pgClient.query(
            `UPDATE public.files
             SET file_url = $1, modified_at = $2, content = $3
             WHERE id = $4`,
            [absolutePath, modifiedAt, fileContent, fileId]
          );
        }
      }

      return { id: fileId, isNew };
    } catch (error) {
      console.error(`Ошибка при сохранении информации о файле ${fileName}:`, error);
      throw error;
    }
  }


  /**
   * Сохранение чанка файла (с или без эмбеддинга)
   * @param {number} fileId
   * @param {object} chunkContent - JSON объект для сохранения в JSONB
   * @param {number[]|null} embedding - может быть null (без векторизации)
   * @param {object} metadata - { type, level, s_name, full_name, h_name }
   * @param {number|null} parentChunkId - опционально, для иерархии
   * @param {string|null} contextCode - Код контекста для использования при создании ai_item (опционально)
   * @returns {Promise<number>} chunkId
   */
  async saveChunkVector(fileId, chunkContent, embedding, metadata = {}, parentChunkId = null, contextCode = null) {
    try {
      let vectorString = null;
      if (embedding && Array.isArray(embedding) && embedding.length > 0) {
        vectorString = `[${embedding.join(',')}]`;
      }

      //console.log(`!!! chunkContent: ${JSON.stringify(chunkContent)}`);
      const { 
        type = 'текст', 
        level = '0-исходник', 
        s_name = null, 
        full_name = null, 
        h_name = null 
      } = metadata;

      // Проверка существующего чанка по file_id + full_name (или по chunk_content если full_name отсутствует)
      let vectorResult;
      if (full_name) {
        vectorResult = await this.pgClient.query(
          `SELECT id, ai_item_id FROM public.file_vectors
           WHERE file_id = $1 AND full_name = $2 AND level = $3`,
          [fileId, full_name, level]
        );
      } else {
        // Fallback: если full_name нет, проверяем по chunk_content
        // Используем приведение к тексту для сравнения JSONB
        vectorResult = await this.pgClient.query(
          `SELECT id, ai_item_id FROM public.file_vectors
           WHERE file_id = $1 AND chunk_content::text = $2::text AND (full_name IS NULL OR full_name = '') AND level = $3`,
          [fileId, JSON.stringify(chunkContent), level]
        );
      }

      let chunkId;

      if (vectorResult.rows.length === 0) {
        // INSERT
        // chunkContent передается как JSON объект, PostgreSQL автоматически конвертирует в JSONB
        const insertQuery = `
          INSERT INTO public.file_vectors 
            (file_id, chunk_content, embedding, chunk_index, type, level, s_name, full_name, h_name, parent_chunk_id)
          VALUES 
            ($1, (($2)::json->'text')::jsonb, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id
        `;
        const insertValues = [
          //fileId, JSON.stringify(chunkContent), vectorString, null, type, level, 
          fileId, chunkContent, vectorString, null, type, level, 
          s_name, full_name, h_name, parentChunkId
        ];
        const result = await this.pgClient.query(insertQuery, insertValues);
        chunkId = result.rows[0].id;
      } else {
        // UPDATE
        chunkId = vectorResult.rows[0].id;
        const updateQuery = `
          UPDATE public.file_vectors
          SET chunk_content = (($1)::json->'text')::jsonb,
              embedding = $2,
              type = $3,
              level = $4,
              s_name = $5,
              full_name = $6,
              h_name = $7,
              parent_chunk_id = $8
          WHERE id = $9
        `;
        await this.pgClient.query(updateQuery, [
          JSON.stringify(chunkContent), vectorString, type, level, 
          s_name, full_name, h_name, parentChunkId, chunkId
        ]);
      }

      // === Логика создания/связывания ai_item (только для уровня 0-исходник и при full_name) ===
      if (level === '0-исходник' && full_name) {
        console.log(`[DB] Обработка AI Item для чанка с full_name: "${full_name}"`);

        // Если contextCode не передан, получаем из файла
        let finalContextCode = contextCode;
        if (!finalContextCode) {
          const fileInfoResult = await this.pgClient.query(
            'SELECT context_code FROM public.files WHERE id = $1',
            [fileId]
          );
          finalContextCode = fileInfoResult.rows[0]?.context_code || 'DEFAULT';
        }

        // Ищем другие чанки с тем же full_name в этом файле
        const existingChunkQuery = await this.pgClient.query(
          `SELECT id, ai_item_id FROM public.file_vectors 
           WHERE file_id = $1 AND full_name = $2 AND level = '0-исходник' AND id != $3`,
          [fileId, full_name, chunkId]
        );

        let itemId;

        if (existingChunkQuery.rows.length > 0 && existingChunkQuery.rows[0].ai_item_id) {
          // Есть другой чанк с уже привязанным ai_item — используем его
          itemId = existingChunkQuery.rows[0].ai_item_id;
          console.log(`[DB] Используем существующий AI Item ID: ${itemId}`);
        } else {
          // Ищем глобально по full_name + context_code
          const existingItemQuery = await this.pgClient.query(
            'SELECT id FROM public.ai_item WHERE full_name = $1 AND context_code = $2',
            [full_name, finalContextCode]
          );

          if (existingItemQuery.rows.length > 0) {
            itemId = existingItemQuery.rows[0].id;
            console.log(`[DB] Обновляем существующий AI Item ID: ${itemId}`);
            await this.pgClient.query(
              'UPDATE public.ai_item SET updated_at = CURRENT_TIMESTAMP, type = $1, s_name = $2, h_name = $3, file_id = $4 WHERE id = $5',
              [type, s_name, h_name, fileId, itemId]
            );
          } else {
            console.log(`[DB] Создаём новый AI Item: "${full_name}" (${finalContextCode})`);
            const insertResult = await this.pgClient.query(
              'INSERT INTO public.ai_item (full_name, context_code, type, s_name, h_name, file_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
              [full_name, finalContextCode, type, s_name, h_name, fileId]
            );
            itemId = insertResult.rows[0].id;
          }
        }

        // Привязываем текущий чанк к ai_item
        await this.pgClient.query(
          'UPDATE public.file_vectors SET ai_item_id = $1 WHERE id = $2',
          [itemId, chunkId]
        );

        // Привязываем все остальные чанки с тем же full_name
        if (existingChunkQuery.rows.length > 0) {
          for (const row of existingChunkQuery.rows) {
            await this.pgClient.query(
              'UPDATE public.file_vectors SET ai_item_id = $1 WHERE id = $2',
              [itemId, row.id]
            );
          }
        }

        console.log(`[DB] Чанк ${chunkId} успешно связан с AI Item ${itemId}`);
      } else {
        console.log(`[DB] Пропущено создание AI Item: level="${level}", full_name="${full_name || 'отсутствует'}"`);
      }

      return chunkId;

    } catch (error) {
      const errorFullName = metadata?.full_name || 'отсутствует';
      console.error(`Ошибка при сохранении чанка (fileId: ${fileId}, full_name: ${errorFullName}):`, error);
      throw error;
    }
  }

  /**
   * Получение информации о файле
   * @param {string} fileName - Имя файла
   * @param {string|null} contextCode - Код контекста для фильтрации (опционально)
   */
  async getFileInfo(fileName, contextCode = null) {
    try {
      // Извлекаем только имя файла без пути
      const baseFileName = path.basename(fileName);
      
      // Получение информации о файле из базы данных
      let query = `SELECT f.id, f.context_code, f.modified_at, COUNT(fv.id) as chunks_count
         FROM public.files f
         LEFT JOIN public.file_vectors fv ON f.id = fv.file_id
         WHERE f.filename = $1`;
      const params = [baseFileName];
      
      if (contextCode) {
        query += ' AND f.context_code = $2';
        params.push(contextCode);
      }
      
      query += ' GROUP BY f.id, f.context_code, f.modified_at';
      
      const fileResult = await this.pgClient.query(query, params);

      if (fileResult.rows.length === 0) {
        return { exists: false };
      }

      const fileInfo = fileResult.rows[0];
      
      // Проверка, требуется ли обновление файла
      let needsUpdate = false;
      
      // Получение информации о файле из файловой системы
      const filePath = path.join(this.docsDir, baseFileName);
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        const fileModifiedAt = new Date(stats.mtime);
        const dbModifiedAt = new Date(fileInfo.modified_at);
        
        // Сравнение времени модификации
        needsUpdate = fileModifiedAt > dbModifiedAt;
      }

      return {
        exists: true,
        id: fileInfo.id,
        context_code: fileInfo.context_code,
        chunks_count: parseInt(fileInfo.chunks_count),
        needs_update: needsUpdate
      };
    } catch (error) {
      console.error(`Ошибка при получении информации о файле ${fileName}:`, error);
      throw error;
    }
  }

  /**
   * Обновление контекстного кода для файла
   */
  async updateContextCode(fileId, contextCode) {
    try {
      await this.pgClient.query(
        `UPDATE public.files
         SET context_code = $1
         WHERE id = $2`,
        [contextCode, fileId]
      );
      
      console.log(`Контекстный код для файла с id ${fileId} обновлен на ${contextCode}`);
      return true;
    } catch (error) {
      console.error(`Ошибка при обновлении контекстного кода для файла с id ${fileId}:`, error);
      throw error;
    }
  }

  /**
   * Поиск похожих чанков по вектору запроса
   */
  async similaritySearch(queryEmbedding, limit = 5, contextCode = null, filters = {}) {
    try {
      // Форматируем вектор для PostgreSQL без кавычек
      const vectorString = `[${queryEmbedding.join(',')}]`;
      
      // Получаем фильтры
      const { chunkType, chunkLevel } = filters || {};
      
      // Создаем базовый запрос
      // Извлекаем поле text из JSONB, если оно есть, иначе весь JSONB как текст
      let query = `
        SELECT fv.id, 
               COALESCE(fv.chunk_content->>'text', fv.chunk_content::text) as content, 
               1 - (fv.embedding <=> $1) as similarity,
               f.filename,
               f.context_code,
               fv.type,
               fv.level
        FROM public.file_vectors fv
        JOIN public.files f ON fv.file_id = f.id
        WHERE 1=1
      `;
      
      // Массив значений для подготовленного запроса
      const params = [vectorString];
      let paramIndex = 2;
      
      // Добавляем фильтр по контекстному коду, если указан
      if (contextCode) {
        query += ` AND f.context_code = $${paramIndex++}`;
        params.push(contextCode);
      }
      
      // Добавляем фильтр по типу чанка, если указан
      if (chunkType) {
        query += ` AND fv.type = $${paramIndex++}`;
        params.push(chunkType);
      }
      
      // Добавляем фильтр по уровню чанка, если указан
      if (chunkLevel) {
        query += ` AND fv.level = $${paramIndex++}`;
        params.push(chunkLevel);
      }
      
      // Завершаем запрос сортировкой и ограничением
      query += `
        ORDER BY similarity DESC
        LIMIT $${paramIndex}
      `;
      params.push(limit);
      
      const result = await this.pgClient.query(query, params);
      
      // Преобразование результатов
      return result.rows.map(row => ({
        id: row.id,
        content: row.content,
        similarity: row.similarity,
        metadata: {
          source: row.filename,
          context_code: row.context_code,
          type: row.type,
          level: row.level
        }
      }));
    } catch (error) {
      console.error("Ошибка при поиске похожих чанков:", error);
      throw error;
    }
  }

  /**
   * Получение списка всех файлов
   * @param {string|null} contextCode - Код контекста для фильтрации (опционально)
   */
  async getAllFiles(contextCode = null) {
    try {
      let query = `
        SELECT f.id, f.filename, f.file_url, f.context_code, f.modified_at, f.created_at,
               (SELECT COUNT(*) FROM public.file_vectors WHERE file_id = f.id) as chunks_count
        FROM public.files f
      `;
      const params = [];
      
      if (contextCode) {
        query += ' WHERE f.context_code = $1';
        params.push(contextCode);
      }
      
      query += ' ORDER BY f.created_at DESC';
      
      const result = await this.pgClient.query(query, params);
      
      const filePromises = result.rows.map(async (row) => {
        const filePath = row.file_url || path.join(this.docsDir, row.filename);
        let fileExists = false;
        let needsUpdate = false;
        let stats = null;

        try {
            await fs.promises.access(filePath);
            fileExists = true;
            stats = await fs.promises.stat(filePath);
            const fileModifiedAt = new Date(stats.mtime);
            const dbModifiedAt = new Date(row.modified_at);
            needsUpdate = fileModifiedAt > dbModifiedAt;
        } catch (e) {
            // File does not exist
        }

        return {
          id: row.id,
          name: row.filename,
          context_code: row.context_code,
          chunks_count: parseInt(row.chunks_count),
          chunksCount: parseInt(row.chunks_count), // Добавляем camelCase для совместимости с интерфейсом
          modified: row.modified_at,
          created: row.created_at,
          vectorized: parseInt(row.chunks_count) > 0,
          exists: fileExists,
          needsUpdate: needsUpdate,
          size: stats ? stats.size : 0,
          type: fileExists ? path.extname(row.filename).toLowerCase().substring(1) : 'неизвестно'
        };
      });

      return Promise.all(filePromises);
    } catch (error) {
      console.error("Ошибка при получении списка файлов:", error);
      throw error;
    }
  }

  /**
   * Получение списка всех контекстных кодов
   */
  async getContextCodes() {
    try {
      const query = await this.pgClient.query(
        'SELECT DISTINCT context_code FROM public.files WHERE context_code IS NOT NULL ORDER BY context_code'
      );
      
      // Создаем уникальный массив контекстов, убираем дубликаты
      const contexts = new Set(['DEFAULT']);
      query.rows.forEach(row => {
        if (row.context_code) {
          contexts.add(row.context_code);
        }
      });
      
      return Array.from(contexts);
    } catch (error) {
      console.error('Ошибка при получении кодов контекстов:', error);
      throw error;
    }
  }

  /**
   * Удаление файла из базы данных
   */
  async deleteFile(fileId) {
    try {
      // Удаление файла (каскадно удалит и все связанные векторы)
      await this.pgClient.query(
        `DELETE FROM public.files WHERE id = $1`,
        [fileId]
      );
      
      console.log(`Файл с id ${fileId} удален из базы данных`);
      return true;
    } catch (error) {
      console.error(`Ошибка при удалении файла с id ${fileId}:`, error);
      throw error;
    }
  }

  /**
   * Получение чанков файла
   * @param {string} fileName - Имя файла
   * @param {string|null} contextCode - Код контекста для фильтрации (опционально)
   */
  async getFileChunks(fileName, contextCode = null) {
    try {
      // Получение информации о файле
      let fileQuery = `SELECT id FROM public.files WHERE filename = $1`;
      const fileParams = [fileName];
      
      if (contextCode) {
        fileQuery += ' AND context_code = $2';
        fileParams.push(contextCode);
      }
      
      const fileResult = await this.pgClient.query(fileQuery, fileParams);
      
      if (fileResult.rows.length === 0) {
        return { exists: false, chunks: [] };
      }
      
      const fileId = fileResult.rows[0].id;
      
      // Получение чанков файла вместе с type, level и ai_item_id
      // Извлекаем поле text из JSONB, если оно есть, иначе весь JSONB как текст
      const chunksResult = await this.pgClient.query(
        `SELECT id, 
                COALESCE(chunk_content->>'text', chunk_content::text) as chunk_content, 
                chunk_index as index, type, level, s_name, h_name, full_name, ai_item_id
         FROM public.file_vectors
         WHERE file_id = $1
         ORDER BY chunk_index`,
        [fileId]
      );
      
      return {
        exists: true,
        chunks: chunksResult.rows.map(row => ({
          id: row.id,
          content: row.chunk_content,
          index: row.index,
          type: row.type || 'текст',
          level: row.level || '0-исходник',
          s_name: row.s_name || '',
          h_name: row.h_name || '',
          full_name: row.full_name || '',
          ai_item_id: row.ai_item_id
        }))
      };
    } catch (error) {
      console.error(`Ошибка при получении чанков файла ${fileName}:`, error);
      throw error;
    }
  }

  /**
   * Удаление векторов файла без удаления самого файла
   * @param {string} fileId - ID файла
   * @returns {Promise<boolean>} Результат операции
   */
  async deleteFileVectors(fileId) {
    try {
      // Получаем ID ai_item, связанных с чанками уровня 0 этого файла
      const aiItemsQuery = await this.pgClient.query(`
        SELECT DISTINCT ai_item_id 
        FROM public.file_vectors 
        WHERE file_id = $1 AND level = '0-исходник' AND ai_item_id IS NOT NULL
      `, [fileId]);
      
      const aiItemIds = aiItemsQuery.rows.map(row => row.ai_item_id);
      
      // Удаление всех векторов, связанных с файлом
      const result = await this.pgClient.query(
        "DELETE FROM public.file_vectors WHERE file_id = $1 RETURNING id",
        [fileId]
      );

      // Очистка неиспользуемых ai_item
      if (aiItemIds.length > 0) {
        // Для каждого ai_item проверяем, есть ли на него ссылки из других чанков
        for (const itemId of aiItemIds) {
          const referencesQuery = await this.pgClient.query(`
            SELECT COUNT(*) as ref_count
            FROM public.file_vectors
            WHERE ai_item_id = $1 AND level = '0-исходник'
          `, [itemId]);
          
          const refCount = parseInt(referencesQuery.rows[0].ref_count);
          
          // Если нет других ссылок, удаляем ai_item
          if (refCount === 0) {
            await this.pgClient.query(
              "DELETE FROM public.ai_item WHERE id = $1",
              [itemId]
            );
            console.log(`Удален неиспользуемый ai_item с ID ${itemId}`);
          }
        }
      }

      // Обновление времени модификации файла, чтобы он был распознан как нуждающийся в обновлении
      await this.pgClient.query(
        "UPDATE public.files SET modified_at = CURRENT_TIMESTAMP WHERE id = $1",
        [fileId]
      );

      return result.rows;
    } catch (error) {
      console.error(`Ошибка при удалении векторов файла ${fileId}:`, error);
      throw error;
    }
  }

  /**
   * Удаление связанных ai_items для файла
   * @param {string} fileId - ID файла
   * @returns {Promise<Array>} Удаленные ai_items
   */
  async deleteFileAiItems(fileId) {
    try {
      // Получаем ID ai_item, связанные с чанками файла
      const aiItemsQuery = await this.pgClient.query(`
        SELECT DISTINCT ai_item_id 
        FROM public.file_vectors 
        WHERE file_id = $1 AND ai_item_id IS NOT NULL
      `, [fileId]);
      
      const aiItemIds = aiItemsQuery.rows.map(row => row.ai_item_id).filter(id => id);
      
      if (aiItemIds.length === 0) {
        return [];
      }
      
      // Удаляем связанные ai_items
      const result = await this.pgClient.query(`
        DELETE FROM public.ai_item
        WHERE id = ANY($1::int[])
        RETURNING id, full_name
      `, [aiItemIds]);
      
      console.log(`Удалено ${result.rows.length} ai_items для файла с ID ${fileId}`);
      
      return result.rows;
    } catch (error) {
      console.error(`Ошибка при удалении связанных ai_items для файла ${fileId}:`, error);
      throw error;
    }
  }

  /**
   * Получение чанка по ID
   * @param {number} chunkId - ID чанка
   * @returns {Promise<Object|null>} - Объект чанка или null, если не найден
   */
  async getChunkById(chunkId) {
    try {
      console.log(`[DB] Запрос чанка по ID: ${chunkId}`);
      
      // Проверяем структуру таблицы file_vectors, чтобы понять тип поля id
      const tableInfoQuery = await this.pgClient.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'file_vectors' AND column_name = 'id'
      `);
      
      // Проверяем тип поля id
      const idColumnType = tableInfoQuery.rows.length > 0 ? tableInfoQuery.rows[0].data_type : 'unknown';
      console.log(`[DB] Тип поля id в таблице file_vectors: ${idColumnType}`);
      
      // Формируем запрос в зависимости от типа поля
      let query;
      let params;
      
      if (idColumnType === 'uuid') {
        // Если id - это UUID, проверяем формат и обрабатываем соответственно
        console.log(`[DB] Поле id имеет тип UUID, проверяем формат: ${chunkId}`);
        
        // Проверяем, является ли chunkId валидным UUID
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(chunkId);
        
        if (!isUUID) {
          // Если это не UUID, ищем по числовому индексу в другом поле
          console.log(`[DB] ${chunkId} не является UUID, ищем по chunk_index`);
          query = `
            SELECT fv.id, fv.file_id, 
                   COALESCE(fv.chunk_content->>'text', fv.chunk_content::text) as chunk_content, 
                   fv.chunk_index, fv.type, fv.level, 
                   fv.s_name, fv.full_name, fv.h_name, fv.created_at, fv.ai_item_id,
                   f.filename, f.context_code
            FROM public.file_vectors fv
            JOIN public.files f ON fv.file_id = f.id
            WHERE fv.chunk_index = $1
            LIMIT 1
          `;
          params = [parseInt(chunkId)];
        } else {
          // Если это UUID, используем его напрямую
          query = `
            SELECT fv.id, fv.file_id, 
                   COALESCE(fv.chunk_content->>'text', fv.chunk_content::text) as chunk_content, 
                   fv.chunk_index, fv.type, fv.level, 
                   fv.s_name, fv.full_name, fv.h_name, fv.created_at, fv.ai_item_id,
                   f.filename, f.context_code
            FROM public.file_vectors fv
            JOIN public.files f ON fv.file_id = f.id
            WHERE fv.id = $1
          `;
          params = [chunkId];
        }
      } else {
        // Для других типов (например, integer)
        query = `
          SELECT fv.id, fv.file_id, 
                 COALESCE(fv.chunk_content->>'text', fv.chunk_content::text) as chunk_content, 
                 fv.chunk_index, fv.type, fv.level, 
                 fv.s_name, fv.full_name, fv.h_name, fv.created_at, fv.ai_item_id,
                 f.filename, f.context_code
          FROM public.file_vectors fv
          JOIN public.files f ON fv.file_id = f.id
          WHERE fv.id = $1
        `;
        params = [chunkId];
      }
      
      // Выполняем запрос
      const result = await this.pgClient.query(query, params);
      
      if (result.rows.length === 0) {
        console.log(`[DB] Чанк с ID/индексом ${chunkId} не найден`);
        return null;
      }
      
      console.log(`[DB] Чанк с ID/индексом ${chunkId} успешно найден`);
      return result.rows[0];
    } catch (error) {
      console.error(`[DB] Ошибка при получении чанка по ID ${chunkId}:`, error);
      throw error;
    }
  }

  /**
   * Обновляет метаданные чанка (type и level)
   * @param {string} chunkId - ID чанка
   * @param {Object} metadata - Новые метаданные
   * @returns {Promise<Object>} Результат операции
   */
  async updateChunkMetadata(chunkId, metadata) {
    try {
      const { type, level } = metadata;
      
      // Формируем части запроса
      const updateParts = [];
      const values = [chunkId];
      let paramIndex = 2;
      
      if (type !== undefined) {
        updateParts.push(`type = $${paramIndex++}`);
        values.push(type);
      }
      
      if (level !== undefined) {
        updateParts.push(`level = $${paramIndex++}`);
        values.push(level);
      }
      
      // Если нет обновляемых полей, возвращаем успех
      if (updateParts.length === 0) {
        return { success: true, message: 'Нет полей для обновления' };
      }
      
      const query = `
        UPDATE public.file_vectors
        SET ${updateParts.join(', ')}
        WHERE id = $1
        RETURNING id, chunk_index, type, level
      `;
      
      const result = await this.pgClient.query(query, values);
      
      return {
        success: true,
        updatedChunk: result.rows[0]
      };
    } catch (error) {
      console.error('Ошибка при обновлении метаданных чанка:', error);
      throw error;
    }
  }

  /**
   * Получение чанка по его ID
   * @param {string} chunkId - ID чанка
   * @returns {Promise<Object|null>} Информация о чанке или null, если чанк не найден
   */
  // Этот метод дублирует getChunkById выше и вызывает ошибку
  // Оставляем для совместимости, но делаем правильную реализацию
  async getChunkByIdLegacy(chunkId) {
    try {
      console.log(`[DB] Запрос чанка по ID (legacy): ${chunkId}`);
      return await this.getChunkById(chunkId);
    } catch (error) {
      console.error(`Ошибка при получении информации о чанке с ID ${chunkId} (legacy):`, error);
      throw error;
    }
  }

  /**
   * Удаление дочерних чанков определенного уровня для родительского чанка
   * @param {string} parentChunkId - ID родительского чанка
   * @param {string} level - Уровень чанков для удаления
   * @returns {Promise<boolean>} Результат операции
   */
  async deleteChildChunks(parentChunkId, level) {
    try {
      await this.pgClient.query(
        `DELETE FROM public.file_vectors 
         WHERE parent_chunk_id = $1 AND level = $2`,
        [parentChunkId, level]
      );
      
      console.log(`Чанки уровня ${level} для родительского чанка ${parentChunkId} удалены`);
      return true;
    } catch (error) {
      console.error(`Ошибка при удалении чанков уровня ${level} для родительского чанка ${parentChunkId}:`, error);
      throw error;
    }
  }

  /**
   * Сохранение дочернего чанка
   * @param {string} fileId - ID файла
   * @param {string} parentChunkId - ID родительского чанка
   * @param {object} content - JSON объект для сохранения в JSONB
   * @param {Array} embedding - Вектор эмбеддинга
   * @param {string} level - Уровень чанка
   * @param {string} type - Тип чанка
   * @param {Object} names - Объект с именами (s_name, full_name, h_name)
   * @param {string} aiItemId - ID элемента AI Item для связывания (опционально)
   * @returns {Promise<Object>} Информация о созданном чанке
   */
  async saveChildChunk(fileId, parentChunkId, content, embedding, level, type, names = {}, aiItemId = null) {
    try {
      // Форматируем вектор для PostgreSQL
      const vectorString = `[${embedding.join(',')}]`;
      
      // Извлекаем имена
      const { s_name = null, full_name = null, h_name = null } = names;
      
      // Получаем максимальный индекс для файла и уровня
      const indexResult = await this.pgClient.query(
        `SELECT MAX(chunk_index) as max_index 
         FROM public.file_vectors 
         WHERE file_id = $1 AND level = $2`,
        [fileId, level]
      );
      
      // Определяем новый индекс
      const chunkIndex = indexResult.rows[0].max_index !== null 
        ? parseInt(indexResult.rows[0].max_index) + 1 
        : 0;
      
      // Создаем новый чанк
      // content передается как JSON объект, конвертируем в JSONB
      const result = await this.pgClient.query(
        `INSERT INTO public.file_vectors (
          file_id, chunk_content, embedding, chunk_index, type, level, parent_chunk_id, s_name, full_name, h_name
        ) VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, chunk_index as index, type, level`,
        [fileId, JSON.stringify(content), vectorString, chunkIndex, type, level, parentChunkId, s_name, full_name, h_name]
      );
      
      const chunkId = result.rows[0].id;
      
      // Если предоставлен aiItemId, связываем чанк с этим AI Item
      if (aiItemId) {
        console.log(`Связываем чанк ${chunkId} с AI Item ${aiItemId}`);
        await this.pgClient.query(
          'UPDATE public.file_vectors SET ai_item_id = $1 WHERE id = $2',
          [aiItemId, chunkId]
        );
      }
      // Если это чанк уровня 0 и у него есть full_name, создаем или связываем с ai_item
      else if (level === '0-исходник' && full_name) {
        // Получаем контекстный код файла
        const fileInfoResult = await this.pgClient.query(
          'SELECT context_code FROM public.files WHERE id = $1',
          [fileId]
        );
        
        const contextCode = fileInfoResult.rows[0]?.context_code || 'DEFAULT';
        
        // Проверяем, есть ли уже чанки с таким же full_name в этом файле
        const existingChunkQuery = await this.pgClient.query(
          'SELECT id, ai_item_id FROM public.file_vectors WHERE file_id = $1 AND full_name = $2 AND level = $3',
          [fileId, full_name, level]
        );
        
        // Если есть другие чанки с таким же full_name, используем существующий ai_item_id
        if (existingChunkQuery.rows.length > 0 && existingChunkQuery.rows[0].ai_item_id) {
          const existingItemId = existingChunkQuery.rows[0].ai_item_id;
          
          // Связываем текущий чанк с существующим AI Item
          await this.pgClient.query(
            'UPDATE public.file_vectors SET ai_item_id = $1 WHERE id = $2',
            [existingItemId, chunkId]
          );
          return chunkId;
        }
        
        // Проверка наличия ai_item с таким full_name и context_code
        const existingItemQuery = await this.pgClient.query(
          'SELECT id FROM public.ai_item WHERE full_name = $1 AND context_code = $2',
          [full_name, contextCode]
        );
        
        let itemId;
        
        if (existingItemQuery.rows.length > 0) {
          // Используем существующий и обновляем дату и новые поля
          itemId = existingItemQuery.rows[0].id;
          await this.pgClient.query(
            'UPDATE public.ai_item SET updated_at = CURRENT_TIMESTAMP, type = $1, s_name = $2, h_name = $3, file_id = $4 WHERE id = $5',
            [type, s_name, h_name, fileId, itemId]
          );
        } else {
          // Создаем новый ai_item с новыми полями
          const insertResult = await this.pgClient.query(
            'INSERT INTO public.ai_item (full_name, context_code, type, s_name, h_name, file_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [full_name, contextCode, type, s_name, h_name, fileId]
          );
          itemId = insertResult.rows[0].id;
        }
        
        // Связываем чанк с ai_item
        await this.pgClient.query(
          'UPDATE public.file_vectors SET ai_item_id = $1 WHERE id = $2',
          [itemId, chunkId]
        );
        
        // Если есть другие чанки с таким же full_name, связываем их с этим же AI Item
        if (existingChunkQuery.rows.length > 0) {
          for (const row of existingChunkQuery.rows) {
            if (row.id !== chunkId) { // Пропускаем текущий чанк
              await this.pgClient.query(
                'UPDATE public.file_vectors SET ai_item_id = $1 WHERE id = $2',
                [itemId, row.id]
              );
            }
          }
        }
      }
      
      console.log(`Создан новый чанк уровня ${level} с id ${chunkId} для родительского чанка ${parentChunkId}`);
      
      return result.rows[0];
    } catch (error) {
      console.error(`Ошибка при сохранении дочернего чанка:`, error);
      throw error;
    }
  }

  /**
   * Обновление имен чанка
   * @param {string} chunkId - ID чанка
   * @param {Object} names - Объект с именами (s_name, full_name, h_name)
   * @returns {Promise<Object>} Результат операции
   */
  async updateChunkNames(chunkId, names) {
    try {
      const { s_name = null, full_name = null, h_name = null } = names;
      
      // Обновляем имена чанка
      await this.pgClient.query(
        `UPDATE public.file_vectors
         SET s_name = $1, full_name = $2, h_name = $3
         WHERE id = $4`,
        [s_name, full_name, h_name, chunkId]
      );
      
      return { success: true, chunkId };
    } catch (error) {
      console.error(`Ошибка при обновлении имен чанка ${chunkId}:`, error);
      throw error;
    }
  }

  /**
   * Получение списка всех ai_item
   * @param {string} contextCode - Код контекста для фильтрации (опционально)
   * @returns {Promise<Array>} Список ai_item
   */
  async getAllAiItems(contextCode = null) {
    try {
      console.log(`[DB] Поиск AI Items с contextCode: "${contextCode}"`);
      
      let query = 'SELECT * FROM public.ai_item';
      const params = [];
      
      if (contextCode) {
        query += ' WHERE context_code = $1';
        params.push(contextCode);
      }
      
      query += ' ORDER BY full_name';
      
      console.log(`[DB] Выполняем запрос: ${query} с параметрами:`, params);
      
      const result = await this.pgClient.query(query, params);
      
      console.log(`[DB] Найдено ${result.rows.length} AI Items`);
      result.rows.forEach((item, index) => {
        console.log(`[DB] AI Item ${index}: id=${item.id}, full_name="${item.full_name}", context_code="${item.context_code}"`);
      });
      
      return result.rows;
    } catch (error) {
      console.error('Ошибка при получении списка ai_item:', error);
      throw error;
    }
  }

  /**
   * Получает AI Item по ID
   * @param {string} itemId - ID элемента AI Item
   * @returns {Promise<Object|null>} Информация об элементе или null, если не найден
   */
  async getAiItemById(itemId) {
    try {
      const result = await this.pgClient.query(
        'SELECT * FROM public.ai_item WHERE id = $1',
        [itemId]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return result.rows[0];
    } catch (error) {
      console.error(`Ошибка при получении ai_item с ID ${itemId}:`, error);
      throw error;
    }
  }

  /**
   * Получает чанки, связанные с AI Item
   * @param {string} itemId - ID элемента AI Item
   * @param {string} level - Уровень чанков (необязательно)
   * @returns {Promise<Array>} Список чанков
   */
  async getAiItemChunks(itemId, level = null) {
    try {
      let query = `
        SELECT fv.id, fv.file_id, 
               COALESCE(fv.chunk_content->>'text', fv.chunk_content::text) as chunk_content, 
               fv.type, fv.level, 
               fv.s_name, fv.full_name, fv.h_name, fv.created_at,
               f.filename, f.context_code
        FROM public.file_vectors fv
        JOIN public.files f ON fv.file_id = f.id
        WHERE fv.ai_item_id = $1
      `;
      
      const params = [itemId];
      
      if (level) {
        query += ' AND fv.level = $2';
        params.push(level);
      }
      
      query += ' ORDER BY fv.level, fv.created_at';
      
      const result = await this.pgClient.query(query, params);
      return result.rows;
    } catch (error) {
      console.error(`Ошибка при получении чанков для ai_item с ID ${itemId}:`, error);
      throw error;
    }
  }

  /**
   * Обновление контекста для ai_item
   * @param {number} itemId - ID элемента
   * @param {string} newContextCode - Новый код контекста
   * @returns {Promise<Object>} Обновленный элемент
   */
  async updateAiItemContext(itemId, newContextCode) {
    try {
      // Обновляем контекстный код
      await this.pgClient.query(
        'UPDATE public.ai_item SET context_code = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newContextCode, itemId]
      );
      
      // Получаем обновленный элемент
      const result = await this.pgClient.query(
        'SELECT * FROM public.ai_item WHERE id = $1',
        [itemId]
      );
      
      if (result.rows.length === 0) {
        throw new Error(`ai_item с ID ${itemId} не найден`);
      }
      
      return result.rows[0];
    } catch (error) {
      console.error(`Ошибка при обновлении контекста ai_item с ID ${itemId}:`, error);
      throw error;
    }
  }

  /**
   * Очистка неиспользуемых ai_item
   * @param {string|null} contextCode - Код контекста для фильтрации (опционально)
   * @returns {Promise<Array>} Список удаленных элементов
   */
  async cleanupOrphanedAiItems(contextCode = null) {
    try {
      let query;
      const params = [];
      
      if (contextCode) {
        // Находим и удаляем ai_item, на которые нет ссылок из чанков уровня 0 с фильтрацией по context_code
        query = `
          DELETE FROM public.ai_item
          WHERE context_code = $1
            AND id NOT IN (
              SELECT DISTINCT fv.ai_item_id 
              FROM public.file_vectors fv
              JOIN public.files f ON fv.file_id = f.id
              WHERE fv.ai_item_id IS NOT NULL 
                AND fv.level = '0-исходник'
                AND f.context_code = $1
            )
          RETURNING id, full_name, context_code
        `;
        params.push(contextCode);
      } else {
        // Находим и удаляем ai_item, на которые нет ссылок из чанков уровня 0
        query = `
          DELETE FROM public.ai_item
          WHERE id NOT IN (
            SELECT DISTINCT ai_item_id 
            FROM public.file_vectors 
            WHERE ai_item_id IS NOT NULL AND level = '0-исходник'
          )
          RETURNING id, full_name, context_code
        `;
      }
      
      const result = await this.pgClient.query(query, params);
      
      if (result.rows.length > 0) {
        console.log(`Удалено ${result.rows.length} неиспользуемых ai_item`);
      }
      
      return result.rows;
    } catch (error) {
      console.error('Ошибка при удалении неиспользуемых ai_item:', error);
      throw error;
    }
  }

  /**
   * Получение информации о файле по ID
   * @param {number} fileId - Идентификатор файла
   * @param {string|null} contextCode - Код контекста для фильтрации (опционально)
   * @returns {Promise<Object|null>} - Информация о файле или null, если файл не найден
   */
  async getFileById(fileId, contextCode = null) {
    try {
      let queryText = 'SELECT * FROM public.files WHERE id = $1';
      const params = [fileId];
      
      if (contextCode) {
        queryText += ' AND context_code = $2';
        params.push(contextCode);
      }
      
      const query = await this.pgClient.query(queryText, params);
      
      return query.rows.length > 0 ? query.rows[0] : null;
    } catch (error) {
      console.error(`Ошибка при получении информации о файле с ID ${fileId}:`, error);
      throw error;
    }
  }

  /**
   * Создание AI Item и связывание его с чанком
   * @param {Object} params - Параметры для создания AI Item
   * @param {string} params.full_name - Полное имя AI Item
   * @param {string} params.contextCode - Код контекста
   * @param {string} params.chunkId - ID чанка для связывания
   * @param {string} [params.type] - Тип AI Item
   * @param {string} [params.sName] - Короткое имя AI Item
   * @param {number} [params.fileId] - ID файла
   * @returns {Promise<Object>} - Созданный AI Item
   */
  async createAiItem(params) {
    const { full_name, contextCode, chunkId, type, sName, fileId } = params;
    
    try {
      // Проверяем, существует ли AI Item с таким именем и контекстом
      const existingItemQuery = await this.pgClient.query(
        'SELECT id FROM public.ai_item WHERE full_name = $1 AND context_code = $2',
        [full_name, contextCode]
      );
      
      let itemId;
      
      if (existingItemQuery.rows.length > 0) {
        // Если существует, обновляем
        itemId = existingItemQuery.rows[0].id;
        await this.pgClient.query(
          'UPDATE public.ai_item SET updated_at = CURRENT_TIMESTAMP, type = $1, s_name = $2, file_id = $3 WHERE id = $4',
          [type, sName, fileId, itemId]
        );
      } else {
        // Иначе создаем новый
        const insertResult = await this.pgClient.query(
          'INSERT INTO public.ai_item (full_name, context_code, type, s_name, file_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [full_name, contextCode, type, sName, fileId]
        );
        itemId = insertResult.rows[0].id;
      }
      
      // Связываем чанк с AI Item
      if (chunkId) {
        await this.pgClient.query(
          'UPDATE public.file_vectors SET ai_item_id = $1 WHERE id = $2',
          [itemId, chunkId]
        );
      }
      
      // Получаем полную информацию о созданном/обновленном AI Item
      const itemQuery = await this.pgClient.query(
        'SELECT * FROM public.ai_item WHERE id = $1',
        [itemId]
      );
      
      return itemQuery.rows[0];
    } catch (error) {
      console.error('Ошибка при создании AI Item:', error);
      throw error;
    }
  }

  /**
   * Адаптер для совместимости с основным проектом
   * Преобразует UUID в числовой ID и наоборот
   */
  async getCompatibleFileId(fileId) {
    try {
      // Проверяем, является ли fileId UUID или числом
      const isUuid = typeof fileId === 'string' && 
                    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId);
      
      if (isUuid) {
        // Если UUID, ищем соответствующий числовой ID
        const result = await this.pgClient.query(
          'SELECT id FROM public.files WHERE file_hash = $1',
          [fileId]
        );
        
        if (result.rows.length === 0) {
          return null;
        }
        
        return result.rows[0].id;
      } else {
        // Если числовой ID, возвращаем как есть
        return fileId;
      }
    } catch (error) {
      console.error(`Ошибка при получении совместимого ID файла:`, error);
      return fileId; // В случае ошибки возвращаем исходный ID
    }
  }

  /**
   * Обновление схемы для обеспечения совместимости с основным проектом
   */
  async updateSchemaForCompatibility() {
    try {
      // Проверяем наличие колонки file_hash
      const columnCheck = await this.pgClient.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'files' AND column_name = 'file_hash'
      `);
      
      // Если колонки нет, добавляем её
      if (columnCheck.rows.length === 0) {
        await this.pgClient.query(`
          ALTER TABLE public.files 
          ADD COLUMN IF NOT EXISTS file_hash TEXT,
          ADD COLUMN IF NOT EXISTS file_url TEXT,
          ADD COLUMN IF NOT EXISTS content TEXT
        `);
        
        console.log("Схема обновлена для обеспечения совместимости");
      }
      
      return true;
    } catch (error) {
      console.error("Ошибка при обновлении схемы для совместимости:", error);
      throw error;
    }
  }

  /**
   * Получение информации о файле по его имени
   * @param {string} filename - Имя файла
   * @returns {Promise<Object|null>}
   */
  async getFileByFilename(filename) {
    try {
      const result = await this.pgClient.query(`
        SELECT f.id, f.filename, f.file_url, f.context_code, f.modified_at, f.created_at, f.content,
               (SELECT COUNT(*) FROM public.file_vectors WHERE file_id = f.id) as chunks_count
        FROM public.files f
        WHERE f.filename = $1
      `, [filename]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const filePath = row.file_url || path.join(this.docsDir, row.filename);
      let fileExists = false;
      let needsUpdate = false;
      let stats = null;

      try {
          await fs.promises.access(filePath);
          fileExists = true;
          stats = await fs.promises.stat(filePath);
          const fileModifiedAt = new Date(stats.mtime);
          const dbModifiedAt = new Date(row.modified_at);
          needsUpdate = fileModifiedAt > dbModifiedAt;
      } catch (e) {
          // File does not exist
      }

      return {
        id: row.id,
        filename: row.filename,
        name: row.filename, // Alias for compatibility
        context_code: row.context_code,
        chunks_count: parseInt(row.chunks_count),
        chunksCount: parseInt(row.chunks_count), // Добавляем camelCase для совместимости с интерфейсом
        modified: row.modified_at,
        created: row.created_at,
        vectorized: parseInt(row.chunks_count) > 0,
        exists: fileExists,
        needsUpdate: needsUpdate,
        size: stats ? stats.size : 0,
        type: fileExists ? path.extname(row.filename).toLowerCase().substring(1) : 'неизвестно',
        file_url: row.file_url
      };
    } catch (error) {
      console.error(`Ошибка при получении файла по имени ${filename}:`, error);
      throw error;
    }
  }

  /**
   * Полная очистка всех таблиц базы данных
   * Удаляет все записи из file_vectors, ai_item и files
   * @returns {Promise<boolean>} Результат операции
   */
  async clearAllTables() {
    try {
      console.log("Начало полной очистки всех таблиц базы данных...");

      // Вариант 1: Простое удаление с использованием каскадных связей
      // Поскольку в file_vectors есть ON DELETE CASCADE для files,
      // достаточно удалить все файлы — векторы удалятся автоматически.
      // ai_item не имеют каскадного удаления, поэтому удаляем отдельно.

      // Удаляем все ai_item (на них нет жёстких ссылок с каскадом)
      await this.pgClient.query(`DELETE FROM public.ai_item`);
      console.log("Таблица ai_item очищена");

      // Удаляем все файлы — автоматически удалятся все связанные векторы благодаря ON DELETE CASCADE
      await this.pgClient.query(`DELETE FROM public.files`);
      console.log("Таблица files очищена (векторы удалены каскадно)");

      // Дополнительно: сбрасываем последовательности автоинкремента (опционально, но рекомендуется)
      await this.pgClient.query(`
        ALTER SEQUENCE public.files_id_seq RESTART WITH 1;
        ALTER SEQUENCE public.ai_item_id_seq RESTART WITH 1;
        ALTER SEQUENCE public.file_vectors_id_seq RESTART WITH 1;
      `);
      console.log("Последовательности ID сброшены");

      console.log("Полная очистка базы данных успешно завершена");
      return true;

    } catch (error) {
      console.error("Ошибка при полной очистке таблиц базы данных:", error);
      throw error;
    }
  }

    /**
   * Жёсткая полная очистка всех таблиц (с отключением проверок FK)
   * Использовать с осторожностью!
   */
  async truncateAllTables() {
    try {
      console.log("Жёсткая очистка всех таблиц (TRUNCATE)...");

      await this.pgClient.query(`
        TRUNCATE TABLE public.file_vectors, public.ai_item, public.files
        RESTART IDENTITY
        CASCADE;
      `);

      console.log("Все таблицы успешно очищены с помощью TRUNCATE");
      return true;
    } catch (error) {
      console.error("Ошибка при жёсткой очистке таблиц:", error);
      throw error;
    }
  }


  // API для kosmos-UI (aiitem-rag-architect)

  /**
   * Определение языка по расширению файла
   */
  _getLanguageFromFilename(filename) {
    const ext = path.extname(filename).toLowerCase();
    const map = {
      '.js': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.py': 'python',
      '.java': 'java',
      '.go': 'go',
      '.sql': 'sql', // или добавить 'sql'
      '.md': 'markdown'
    };
    return map[ext] || 'unknown';
  }

  /**
   * Получение полного агрегированного AiItem по full_name
   */
  async getFullAiItemByFullName(full_name, contextCode = null) {
    try {
      let query = `
        SELECT 
          ai.id AS ai_id,
          ai.full_name,
          ai.type,
          ai.s_name,
          ai.h_name,
          ai.context_code,
          ai.file_id,
          f.filename,
          f.file_url
        FROM public.ai_item ai
        JOIN public.files f ON ai.file_id = f.id
        WHERE ai.full_name = $1
      `;
      const params = [full_name];

      if (contextCode) {
        query += ` AND ai.context_code = $2`;
        params.push(contextCode);
      }

      const aiResult = await this.pgClient.query(query, params);
      if (aiResult.rows.length === 0) {
        return null;
      }

      const row = aiResult.rows[0];

      // Получаем чанки разных уровней
      // Извлекаем поле text из JSONB, если оно есть, иначе весь JSONB как текст
      const chunksResult = await this.pgClient.query(`
        SELECT COALESCE(chunk_content->>'text', chunk_content::text) as chunk_content, level, type
        FROM public.file_vectors
        WHERE ai_item_id = $1
        ORDER BY chunk_index
      `, [row.ai_id]);

      let l0_code = '';
      let l1_deps = [];
      let l2_desc = '';

      chunksResult.rows.forEach(chunk => {
        if (chunk.level.startsWith('0-')) {
          // chunk_content уже извлечен как текст (поле text из JSONB или весь JSONB как текст)
          l0_code = chunk.chunk_content;
        } else if (chunk.level.startsWith('1-')) {
          // Предполагаем, что L1 — это JSON-массив зависимостей или текст
          try {
            // Пытаемся распарсить как JSON (если это был JSONB объект без поля text)
            const parsed = JSON.parse(chunk.chunk_content);
            l1_deps = Array.isArray(parsed) ? parsed : (typeof parsed === 'string' ? [parsed] : [JSON.stringify(parsed)]);
          } catch {
            // Если не JSON, пытаемся разбить по строкам
            l1_deps = chunk.chunk_content.split('\n').filter(line => line.trim());
          }
        } else if (chunk.level.startsWith('2-')) {
          l2_desc = chunk.chunk_content;
        }
      });

      const language = this._getLanguageFromFilename(row.filename);

      return {
        id: row.full_name,                    // строковый ID по контракту
        type: row.type || 'unknown',
        language,
        l0_code,
        l1_deps: Array.isArray(l1_deps) ? l1_deps : [],
        l2_desc,
        filePath: row.file_url || path.join(this.docsDir || 'docs', row.filename)
      };
    } catch (error) {
      console.error(`[DB] Ошибка getFullAiItemByFullName("${full_name}"):`, error);
      throw error;
    }
  }

  /**
   * Получение всех полных AiItems (оптимизированная версия — 1 запрос вместо N+1)
   */
  async getAllFullAiItems(contextCode = null) {
    try {
      let query = `
        SELECT 
          ai.id AS ai_id,
          ai.full_name,
          ai.type,
          ai.s_name,
          ai.h_name,
          ai.context_code,
          ai.file_id,
          f.filename,
          f.file_url,
          COALESCE(
            json_agg(
              json_build_object(
                'chunk_content', COALESCE(fv.chunk_content->>'text', fv.chunk_content::text),
                'level', fv.level,
                'type', fv.type
              ) ORDER BY fv.chunk_index
            ) FILTER (WHERE fv.id IS NOT NULL),
            '[]'::json
          ) AS chunks
        FROM public.ai_item ai
        JOIN public.files f ON ai.file_id = f.id
        LEFT JOIN public.file_vectors fv ON fv.ai_item_id = ai.id
      `;
      const params = [];

      if (contextCode) {
        query += ` WHERE ai.context_code = $1`;
        params.push(contextCode);
      }

      query += ` GROUP BY ai.id, f.id`;

      const result = await this.pgClient.query(query, params);

      const items = result.rows.map(row => {
        let l0_code = '';
        let l1_deps = [];
        let l2_desc = '';

        // Обрабатываем агрегированные чанки
        const chunks = row.chunks || [];
        for (const chunk of chunks) {
          if (!chunk.level) continue;
          
          if (chunk.level.startsWith('0-')) {
            l0_code = chunk.chunk_content || '';
          } else if (chunk.level.startsWith('1-')) {
            try {
              const parsed = JSON.parse(chunk.chunk_content);
              l1_deps = Array.isArray(parsed) ? parsed : (typeof parsed === 'string' ? [parsed] : [JSON.stringify(parsed)]);
            } catch {
              l1_deps = (chunk.chunk_content || '').split('\n').filter(line => line.trim());
            }
          } else if (chunk.level.startsWith('2-')) {
            l2_desc = chunk.chunk_content || '';
          }
        }

        const language = this._getLanguageFromFilename(row.filename);

        return {
          id: row.full_name,
          type: row.type || 'unknown',
          language,
          l0_code,
          l1_deps: Array.isArray(l1_deps) ? l1_deps : [],
          l2_desc,
          filePath: row.file_url || path.join(this.docsDir || 'docs', row.filename)
        };
      });

      return items;
    } catch (error) {
      console.error('[DB] Ошибка getAllFullAiItems:', error);
      throw error;
    }
  }

  /**
   * Получение общей статистики для дашборда
   * @param {string|null} contextCode - Код контекста для фильтрации (опционально)
   */
  async getDashboardStats(contextCode = null) {
    try {
      const params = [];
      let contextFilter = '';
      
      if (contextCode) {
        contextFilter = 'WHERE context_code = $1';
        params.push(contextCode);
      }

      // 1. Общее количество AiItems
      const totalItemsQuery = contextCode 
        ? 'SELECT COUNT(*) AS count FROM public.ai_item WHERE context_code = $1'
        : 'SELECT COUNT(*) AS count FROM public.ai_item';
      const totalItemsRes = await this.pgClient.query(totalItemsQuery, params);
      const totalItems = parseInt(totalItemsRes.rows[0].count);

      // 2. Количество чанков уровня 1 (зависимости)
      const depsQuery = contextCode
        ? `SELECT COUNT(*) AS count 
           FROM public.file_vectors fv
           JOIN public.files f ON fv.file_id = f.id
           WHERE fv.level LIKE '1-%' AND f.context_code = $1`
        : `SELECT COUNT(*) AS count 
           FROM public.file_vectors 
           WHERE level LIKE '1-%'`;
      const depsRes = await this.pgClient.query(depsQuery, params);
      const totalDeps = parseInt(depsRes.rows[0].count);

      // 3. Статистика по типам AiItem
      const typeStatsQuery = contextCode
        ? `SELECT type, COUNT(*) AS count 
           FROM public.ai_item 
           WHERE type IS NOT NULL AND type != '' AND context_code = $1
           GROUP BY type
           ORDER BY count DESC`
        : `SELECT type, COUNT(*) AS count 
           FROM public.ai_item 
           WHERE type IS NOT NULL AND type != ''
           GROUP BY type
           ORDER BY count DESC`;
      const typeStatsRes = await this.pgClient.query(typeStatsQuery, params);

      const typeStats = typeStatsRes.rows.map(row => ({
        name: row.type || 'unknown',
        count: parseInt(row.count)
      }));

      // 4. Статистика по языкам (по расширению файлов)
      const langStatsQuery = contextCode
        ? `SELECT 
           LOWER(SUBSTRING(f.filename FROM '\.([^\.]+)$')) AS ext,
           COUNT(*) AS count
           FROM public.files f
           JOIN public.ai_item ai ON f.id = ai.file_id
           WHERE f.context_code = $1
           GROUP BY ext
           ORDER BY count DESC`
        : `SELECT 
           LOWER(SUBSTRING(filename FROM '\.([^\.]+)$')) AS ext,
           COUNT(*) AS count
           FROM public.files f
           JOIN public.ai_item ai ON f.id = ai.file_id
           GROUP BY ext
           ORDER BY count DESC`;
      const langStatsRes = await this.pgClient.query(langStatsQuery, params);

      const langMap = {
        js: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        py: 'python',
        java: 'java',
        go: 'go',
        sql: 'sql',
        md: 'markdown'
      };

      const languageStats = langStatsRes.rows.map(row => ({
        name: langMap[row.ext] || row.ext || 'unknown',
        value: parseInt(row.count)
      }));

      // 5. Размер векторного индекса (чанков с embedding)
      const vectorSizeQuery = contextCode
        ? `SELECT COUNT(*) AS count 
           FROM public.file_vectors fv
           JOIN public.files f ON fv.file_id = f.id
           WHERE fv.embedding IS NOT NULL AND f.context_code = $1`
        : `SELECT COUNT(*) AS count 
           FROM public.file_vectors 
           WHERE embedding IS NOT NULL`;
      const vectorSizeRes = await this.pgClient.query(vectorSizeQuery, params);
      const vectorIndexSize = `${vectorSizeRes.rows[0].count} vectors`;

      // 6. Дата последней модификации (по чанкам)
      const lastScanQuery = contextCode
        ? `SELECT MAX(fv.created_at) AS last 
           FROM public.file_vectors fv
           JOIN public.files f ON fv.file_id = f.id
           WHERE f.context_code = $1`
        : `SELECT MAX(created_at) AS last 
           FROM public.file_vectors`;
      const lastScanRes = await this.pgClient.query(lastScanQuery, params);
      const lastScan = lastScanRes.rows[0].last || new Date().toISOString();

      // 7. Средняя плотность зависимостей
      const averageDependencyDensity = totalItems > 0 
        ? (totalDeps / totalItems).toFixed(2)
        : '0';

      return {
        totalItems,
        totalDeps,
        averageDependencyDensity,
        typeStats,
        languageStats,
        vectorIndexSize,
        lastScan
      };

    } catch (error) {
      console.error('[DB] Ошибка getDashboardStats:', error);
      throw error;
    }
  }

  /**
   * Получение анализа логики (logic-graph) для AiItem
   * @param {string} fullName - full_name AiItem
   * @param {string} contextCode - Контекстный код
   * @returns {Promise<Object|null>} { logic, graph, savedAt, updatedAt } или null
   */
  async getLogicGraphByAiItem(fullName, contextCode = null) {
    try {
      let query = `
        SELECT 
          fv.id,
          fv.chunk_content,
          fv.content,
          fv.created_at,
          fv.updated_at
        FROM public.file_vectors fv
        JOIN public.ai_item ai ON fv.ai_item_id = ai.id
        WHERE ai.full_name = $1 AND fv.level = '2-logic'
      `;
      const params = [fullName];

      if (contextCode) {
        query += ` AND ai.context_code = $2`;
        params.push(contextCode);
      }

      query += ` LIMIT 1`;

      const result = await this.pgClient.query(query, params);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      
      // Извлекаем logic из chunk_content
      let logic = null;
      if (row.chunk_content) {
        if (typeof row.chunk_content === 'object' && row.chunk_content.logic) {
          logic = row.chunk_content.logic;
        } else if (typeof row.chunk_content === 'string') {
          try {
            const parsed = JSON.parse(row.chunk_content);
            logic = parsed.logic || null;
          } catch {
            logic = row.chunk_content;
          }
        }
      }

      // Извлекаем graph из content
      let graph = null;
      if (row.content) {
        if (typeof row.content === 'object') {
          graph = row.content.graph || row.content;
        } else if (typeof row.content === 'string') {
          try {
            const parsed = JSON.parse(row.content);
            graph = parsed.graph || parsed;
          } catch {
            // Если не JSON, возвращаем как есть
            graph = row.content;
          }
        }
      }

      return {
        logic,
        graph,
        savedAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
      };
    } catch (error) {
      console.error(`[DB] Ошибка getLogicGraphByAiItem("${fullName}"):`, error);
      throw error;
    }
  }

  /**
   * Сохранение анализа логики (logic-graph) для AiItem
   * @param {string} fullName - full_name AiItem
   * @param {string} logic - Текстовое описание логики
   * @param {object} graph - Граф потока управления
   * @param {string} contextCode - Контекстный код
   * @returns {Promise<Object>} { success, savedAt, updatedAt }
   */
  async saveLogicGraph(fullName, logic, graph, contextCode = null) {
    try {
      // Находим ai_item
      const aiItemQuery = contextCode
        ? `SELECT id, file_id FROM public.ai_item WHERE full_name = $1 AND context_code = $2`
        : `SELECT id, file_id FROM public.ai_item WHERE full_name = $1`;
      
      const aiItemParams = contextCode ? [fullName, contextCode] : [fullName];
      const aiItemResult = await this.pgClient.query(aiItemQuery, aiItemParams);

      if (aiItemResult.rows.length === 0) {
        throw new Error(`AiItem not found: ${fullName}`);
      }

      const aiItemId = aiItemResult.rows[0].id;
      const fileId = aiItemResult.rows[0].file_id;

      // Проверяем, существует ли уже чанк с level='2-logic'
      const existingQuery = `
        SELECT id, created_at FROM public.file_vectors
        WHERE ai_item_id = $1 AND level = '2-logic'
        LIMIT 1
      `;
      const existingResult = await this.pgClient.query(existingQuery, [aiItemId]);

      const chunkContent = { logic };
      const content = { graph };

      let savedAt, updatedAt;

      if (existingResult.rows.length > 0) {
        // UPDATE
        const chunkId = existingResult.rows[0].id;
        savedAt = existingResult.rows[0].created_at ? new Date(existingResult.rows[0].created_at).toISOString() : null;
        updatedAt = new Date().toISOString();

        await this.pgClient.query(
          `UPDATE public.file_vectors
           SET chunk_content = $1::jsonb,
               content = $2::jsonb,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [JSON.stringify(chunkContent), JSON.stringify(content), chunkId]
        );
      } else {
        // INSERT
        savedAt = new Date().toISOString();
        updatedAt = null;

        await this.pgClient.query(
          `INSERT INTO public.file_vectors
           (file_id, ai_item_id, chunk_content, content, level, full_name, type)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, '2-logic', $5, 'logic-graph')`,
          [fileId, aiItemId, JSON.stringify(chunkContent), JSON.stringify(content), fullName]
        );
      }

      return { success: true, savedAt, updatedAt };
    } catch (error) {
      console.error(`[DB] Ошибка saveLogicGraph("${fullName}"):`, error);
      throw error;
    }
  }

  /**
   * Удаление анализа логики (logic-graph) для AiItem
   * @param {string} fullName - full_name AiItem
   * @param {string} contextCode - Контекстный код
   * @returns {Promise<boolean>} true если удалено, false если не найдено
   */
  async deleteLogicGraph(fullName, contextCode = null) {
    try {
      let query = `
        DELETE FROM public.file_vectors
        WHERE ai_item_id IN (
          SELECT ai.id FROM public.ai_item ai
          WHERE ai.full_name = $1
        ) AND level = '2-logic'
      `;
      const params = [fullName];

      if (contextCode) {
        query = `
          DELETE FROM public.file_vectors
          WHERE ai_item_id IN (
            SELECT ai.id FROM public.ai_item ai
            WHERE ai.full_name = $1 AND ai.context_code = $2
          ) AND level = '2-logic'
        `;
        params.push(contextCode);
      }

      const result = await this.pgClient.query(query, params);
      return result.rowCount > 0;
    } catch (error) {
      console.error(`[DB] Ошибка deleteLogicGraph("${fullName}"):`, error);
      throw error;
    }
  }

}

module.exports = DbService; 