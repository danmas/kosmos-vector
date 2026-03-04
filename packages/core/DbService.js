// DbService.js
const fs = require('fs');
const path = require('path');

// Import db-core components for delegation
const { 
  Database, 
  FilesRepository, 
  VectorRepository, 
  AiItemsRepository,
  Migrator 
} = require('@kosmos-vector/db-core');

/**
 * Сервис для работы с базой данных PostgreSQL
 * 
 * Этот класс теперь делегирует SQL-операции репозиториям из @kosmos-vector/db-core,
 * сохраняя бизнес-логику (работу с файловой системой) внутри себя.
 * 
 * @example
 * // Старый способ (обратная совместимость):
 * const dbService = new DbService(pgClient);
 * 
 * // Новый способ с инъекцией зависимостей:
 * const db = new Database(process.env.DATABASE_URL);
 * await db.connect();
 * const dbService = new DbService(pgClient, {
 *   database: db,
 *   filesRepository: new FilesRepository(db),
 *   vectorRepository: new VectorRepository(db),
 *   aiItemsRepository: new AiItemsRepository(db)
 * });
 */
class DbService {
  /**
   * @param {import('pg').Client} pgClient - PostgreSQL клиент (для обратной совместимости)
   * @param {Object} config - Конфигурация
   * @param {string} [config.docsDir] - Директория документов
   * @param {Database} [config.database] - Экземпляр Database из db-core
   * @param {FilesRepository} [config.filesRepository] - Репозиторий файлов
   * @param {VectorRepository} [config.vectorRepository] - Репозиторий векторов
   * @param {AiItemsRepository} [config.aiItemsRepository] - Репозиторий AI Items
   */
  constructor(pgClient, config = {}) {
    this.pgClient = pgClient;
    this.docsDir = config.docsDir || path.join(process.cwd(), "docs");

    // Инициализация db-core компонентов
    // Если передан Database, используем его; иначе создаём адаптер над pgClient
    if (config.database) {
      this._db = config.database;
    } else {
      // Создаём адаптер для совместимости с существующим pgClient
      this._db = this._createDatabaseAdapter(pgClient);
    }

    // Инициализация репозиториев (с возможностью инъекции)
    this._filesRepo = config.filesRepository || new FilesRepository(this._db);
    this._vectorRepo = config.vectorRepository || new VectorRepository(this._db);
    this._aiItemsRepo = config.aiItemsRepository || new AiItemsRepository(this._db);
  }

  /**
   * Создание адаптера Database над существующим pgClient
   * Для обратной совместимости с кодом, который передаёт pgClient напрямую
   * @private
   */
  _createDatabaseAdapter(pgClient) {
    return {
      query: (sql, params) => pgClient.query(sql, params),
      queryRaw: (sql, params) => pgClient.query(sql, params),
      queryOne: async (sql, params) => {
        const result = await pgClient.query(sql, params);
        return result.rows.length > 0 ? result.rows[0] : null;
      },
      queryAll: async (sql, params) => {
        const result = await pgClient.query(sql, params);
        return result.rows;
      },
      beginTransaction: async () => { await pgClient.query('BEGIN'); },
      commit: async () => { await pgClient.query('COMMIT'); },
      rollback: async () => { await pgClient.query('ROLLBACK'); },
      connected: true,
      getClient: () => pgClient
    };
  }

  /**
   * Получение репозитория файлов
   * @returns {FilesRepository}
   */
  get filesRepository() {
    return this._filesRepo;
  }

  /**
   * Получение репозитория векторов
   * @returns {VectorRepository}
   */
  get vectorRepository() {
    return this._vectorRepo;
  }

  /**
   * Получение репозитория AI Items
   * @returns {AiItemsRepository}
   */
  get aiItemsRepository() {
    return this._aiItemsRepo;
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

      // Переименование таблицы file_vectors в chunk_vector, если она существует
      try {
        const oldTableExists = await this.pgClient.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'file_vectors'
          )
        `);
        
        const newTableExists = await this.pgClient.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'chunk_vector'
          )
        `);
        
        if (oldTableExists.rows[0].exists && !newTableExists.rows[0].exists) {
          console.log("Найдена таблица file_vectors, переименовываем в chunk_vector...");
          
          // Переименовываем индексы
          await this.pgClient.query(`
            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_file_vectors_file_id') THEN
                ALTER INDEX idx_file_vectors_file_id RENAME TO idx_chunk_vector_file_id;
              END IF;
              IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_file_vectors_parent_chunk_id') THEN
                ALTER INDEX idx_file_vectors_parent_chunk_id RENAME TO idx_chunk_vector_parent_chunk_id;
              END IF;
              IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_file_vectors_ai_item_id') THEN
                ALTER INDEX idx_file_vectors_ai_item_id RENAME TO idx_chunk_vector_ai_item_id;
              END IF;
            END $$;
          `);
          
          // Переименовываем последовательность
          await this.pgClient.query(`
            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'file_vectors_id_seq') THEN
                ALTER SEQUENCE public.file_vectors_id_seq RENAME TO chunk_vector_id_seq;
              END IF;
            END $$;
          `);
          
          // Переименовываем таблицу
          await this.pgClient.query(`
            ALTER TABLE public.file_vectors RENAME TO chunk_vector;
          `);
          
          console.log("Таблица file_vectors успешно переименована в chunk_vector");
        } else if (oldTableExists.rows[0].exists && newTableExists.rows[0].exists) {
          console.warn("Обнаружены обе таблицы (file_vectors и chunk_vector). Рекомендуется вручную удалить старую таблицу file_vectors.");
        }
        
        // Проверяем и обновляем представления (views), которые могут ссылаться на file_vectors
        try {
          const views = await this.pgClient.query(`
            SELECT viewname, definition 
            FROM pg_views 
            WHERE schemaname = 'public' 
            AND definition LIKE '%file_vectors%'
          `);
          
          if (views.rows.length > 0) {
            console.warn(`Найдено ${views.rows.length} представлений, которые могут ссылаться на file_vectors. Требуется ручное обновление.`);
            views.rows.forEach(view => {
              console.warn(`  - ${view.viewname}`);
            });
          }
        } catch (viewError) {
          // Игнорируем ошибки при проверке представлений
        }
        
        // Проверяем и обновляем функции, которые могут ссылаться на file_vectors
        try {
          const functions = await this.pgClient.query(`
            SELECT routine_name, routine_definition 
            FROM information_schema.routines 
            WHERE routine_schema = 'public' 
            AND routine_definition LIKE '%file_vectors%'
          `);
          
          if (functions.rows.length > 0) {
            console.warn(`Найдено ${functions.rows.length} функций, которые могут ссылаться на file_vectors. Требуется ручное обновление.`);
            functions.rows.forEach(func => {
              console.warn(`  - ${func.routine_name}`);
            });
          }
        } catch (funcError) {
          // Игнорируем ошибки при проверке функций
        }
        
      } catch (renameError) {
        console.warn("Ошибка при переименовании таблицы file_vectors (возможно, уже переименована):", renameError.message);
      }

      // Создание таблицы chunk_vector
      await this.pgClient.query(`
        CREATE TABLE IF NOT EXISTS public.chunk_vector (
          id SERIAL PRIMARY KEY,
          file_id INTEGER REFERENCES public.files(id) ON DELETE CASCADE,
          ai_item_id INTEGER REFERENCES public.ai_item(id) ON DELETE SET NULL,
          parent_chunk_id INTEGER REFERENCES public.chunk_vector(id) ON DELETE CASCADE,
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
      console.log("Таблица chunk_vector создана или уже существует");

      // Добавляем поля content и updated_at, если их нет
      await this.pgClient.query(`
        ALTER TABLE public.chunk_vector
          ADD COLUMN IF NOT EXISTS content JSONB,
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE
      `);

      // Создание индексов для ускорения поиска
      await this.pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_chunk_vector_file_id ON public.chunk_vector(file_id);
        CREATE INDEX IF NOT EXISTS idx_chunk_vector_parent_chunk_id ON public.chunk_vector(parent_chunk_id);
        CREATE INDEX IF NOT EXISTS idx_chunk_vector_ai_item_id ON public.chunk_vector(ai_item_id);
      `);
      console.log("Индексы для chunk_vector созданы или уже существуют");

      // Создание таблицы ai_comment
      await this.pgClient.query(`
        CREATE TABLE IF NOT EXISTS public.ai_comment (
          id SERIAL PRIMARY KEY,
          context_code TEXT NOT NULL,
          full_name TEXT NOT NULL,
          comment TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(context_code, full_name)
        )
      `);
      console.log("Таблица ai_comment создана или уже существует");

      // Создание индекса для ai_comment
      await this.pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_ai_comment_context_full_name 
        ON public.ai_comment(context_code, full_name)
      `);
      console.log("Индексы для ai_comment созданы или уже существуют");

      // === Инкрементальное обновление: миграция новых колонок ===
      // files: file_hash уже в CREATE TABLE, но для существующих БД:
      await this.pgClient.query(`
        ALTER TABLE public.files ADD COLUMN IF NOT EXISTS file_hash TEXT
      `);
      // Убираем старый UNIQUE(filename) и добавляем UNIQUE(filename, context_code)
      await this.pgClient.query(`
        ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_filename_key
      `);
      await this.pgClient.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'files_filename_context_code_unique'
          ) THEN
            ALTER TABLE public.files ADD CONSTRAINT files_filename_context_code_unique UNIQUE (filename, context_code);
          END IF;
        END $$;
      `);

      // ai_item: content_hash и needs_rebuild
      await this.pgClient.query(`
        ALTER TABLE public.ai_item ADD COLUMN IF NOT EXISTS content_hash TEXT;
        ALTER TABLE public.ai_item ADD COLUMN IF NOT EXISTS needs_rebuild BOOLEAN DEFAULT false;
      `);
      await this.pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_ai_item_needs_rebuild ON public.ai_item (context_code, needs_rebuild) WHERE needs_rebuild = true
      `);
      console.log("Миграция инкрементального обновления выполнена");

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
   * @param {string|null} fileHash - SHA-256 хеш содержимого файла (опционально)
   */
  async saveFileInfo(fileName, fileContent, filePath, contextCode = null, fileHash = null) {
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

      // Поиск по filename + context_code
      const finalContextCode = contextCode || 'DEFAULT';
      const fileResult = await this.pgClient.query(
        `SELECT id FROM public.files WHERE filename = $1 AND context_code = $2`,
        [baseFileName, finalContextCode]
      );

      let fileId;
      let isNew = false;

      if (fileResult.rows.length === 0) {
        // INSERT
        const insertResult = await this.pgClient.query(
          `INSERT INTO public.files (filename, file_url, modified_at, content, context_code, file_hash)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [baseFileName, absolutePath, modifiedAt, fileContent, finalContextCode, fileHash]
        );
        fileId = insertResult.rows[0].id;
        isNew = true;
      } else {
        fileId = fileResult.rows[0].id;
        // UPDATE
        await this.pgClient.query(
          `UPDATE public.files
           SET file_url = $1, modified_at = $2, content = $3, context_code = $4, file_hash = $5
           WHERE id = $6`,
          [absolutePath, modifiedAt, fileContent, finalContextCode, fileHash, fileId]
        );
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
          `SELECT id, ai_item_id FROM public.chunk_vector
           WHERE file_id = $1 AND full_name = $2 AND level = $3`,
          [fileId, full_name, level]
        );
      } else {
        // Fallback: если full_name нет, проверяем по chunk_content
        // Используем приведение к тексту для сравнения JSONB
        vectorResult = await this.pgClient.query(
          `SELECT id, ai_item_id FROM public.chunk_vector
           WHERE file_id = $1 AND chunk_content::text = $2::text AND (full_name IS NULL OR full_name = '') AND level = $3`,
          [fileId, JSON.stringify(chunkContent), level]
        );
      }

      let chunkId;

      if (vectorResult.rows.length === 0) {
        // INSERT
        // chunkContent передается как JSON объект, PostgreSQL автоматически конвертирует в JSONB
        const insertQuery = `
          INSERT INTO public.chunk_vector 
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
          UPDATE public.chunk_vector
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

        // Извлечение comment из chunk_content при INSERT или UPDATE L0
        // Сохраняем комментарий, если его еще нет в ai_comment
        if (level === '0-исходник' && full_name && chunkContent && typeof chunkContent === 'object') {
          const comment = chunkContent.comment;
          if (comment && typeof comment === 'string' && comment.trim()) {
            try {
              const trimmedComment = comment.trim();
              const isInsert = vectorResult.rows.length === 0;
              console.log(`[DB] 🔍 Обнаружен comment для ${isInsert ? 'INSERT' : 'UPDATE'} L0: "${full_name}" (context: "${finalContextCode}")`);
              
              // Проверяем, существует ли уже комментарий
              const existingComment = await this.getAiComment(finalContextCode, full_name);
              
              if (!existingComment) {
                // Комментария нет - создаем
                await this.createAiCommentIfNotExists(finalContextCode, full_name, trimmedComment);
                console.log(`[DB] ✅ ai_comment создан для ai_item: "${full_name}" (context: "${finalContextCode}")`);
                console.log(`[DB]    Комментарий: ${trimmedComment.substring(0, 100)}${trimmedComment.length > 100 ? '...' : ''}`);
              } else {
                console.log(`[DB] ℹ️  ai_comment уже существует для "${full_name}" - не перезаписываем (накопление комментариев)`);
              }
            } catch (commentError) {
              console.warn(`[DB] ⚠️  Ошибка при сохранении ai_comment для "${full_name}":`, commentError.message);
              // Не прерываем выполнение, если ошибка сохранения комментария
            }
          } else {
            console.log(`[DB] ℹ️  Комментарий отсутствует или пуст для ai_item: "${full_name}" (chunkContent.comment=${comment ? typeof comment : 'undefined'})`);
          }
        }

        // Ищем другие чанки с тем же full_name в этом файле
        const existingChunkQuery = await this.pgClient.query(
          `SELECT id, ai_item_id FROM public.chunk_vector 
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
              'UPDATE public.ai_item SET updated_at = CURRENT_TIMESTAMP, s_name = $1, h_name = $2, file_id = $3 WHERE id = $4',
              [s_name, h_name, fileId, itemId]
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
          'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
          [itemId, chunkId]
        );

        // Привязываем все остальные чанки с тем же full_name
        if (existingChunkQuery.rows.length > 0) {
          for (const row of existingChunkQuery.rows) {
            await this.pgClient.query(
              'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
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
         LEFT JOIN public.chunk_vector fv ON f.id = fv.file_id
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
   * @delegate FilesRepository.updateContextCode
   */
  async updateContextCode(fileId, contextCode) {
    try {
      const result = await this._filesRepo.updateContextCode(fileId, contextCode);
      console.log(`Контекстный код для файла с id ${fileId} обновлен на ${contextCode}`);
      return result;
    } catch (error) {
      console.error(`Ошибка при обновлении контекстного кода для файла с id ${fileId}:`, error);
      throw error;
    }
  }

  /**
   * Поиск похожих чанков по вектору запроса
   * @delegate VectorRepository.similaritySearch
   */
  async similaritySearch(queryEmbedding, limit = 5, contextCode = null, filters = {}) {
    try {
      const { chunkType, chunkLevel, typeCodes, tagCodes } = filters || {};
      
      return await this._vectorRepo.similaritySearch(queryEmbedding, {
        limit,
        contextCode,
        chunkType,
        chunkLevel,
        typeCodes,
        tagCodes
      });
    } catch (error) {
      console.error("Ошибка при поиске похожих чанков:", error.message);
      console.error("Ошибка Stack:", error.stack);
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
               (SELECT COUNT(*) FROM public.chunk_vector WHERE file_id = f.id) as chunks_count
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
   * @delegate FilesRepository.getContextCodes
   */
  async getContextCodes() {
    try {
      return await this._filesRepo.getContextCodes();
    } catch (error) {
      console.error('Ошибка при получении кодов контекстов:', error);
      throw error;
    }
  }

  /**
   * Удаление файла из базы данных
   * @delegate FilesRepository.delete
   */
  async deleteFile(fileId) {
    try {
      const result = await this._filesRepo.delete(fileId);
      console.log(`Файл с id ${fileId} удален из базы данных`);
      return result;
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
         FROM public.chunk_vector
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
        FROM public.chunk_vector 
        WHERE file_id = $1 AND level = '0-исходник' AND ai_item_id IS NOT NULL
      `, [fileId]);
      
      const aiItemIds = aiItemsQuery.rows.map(row => row.ai_item_id);
      
      // Удаление всех векторов, связанных с файлом
      const result = await this.pgClient.query(
        "DELETE FROM public.chunk_vector WHERE file_id = $1 RETURNING id",
        [fileId]
      );

      // Очистка неиспользуемых ai_item
      if (aiItemIds.length > 0) {
        // Для каждого ai_item проверяем, есть ли на него ссылки из других чанков
        for (const itemId of aiItemIds) {
          const referencesQuery = await this.pgClient.query(`
            SELECT COUNT(*) as ref_count
            FROM public.chunk_vector
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
        FROM public.chunk_vector 
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
      
      // Проверяем структуру таблицы chunk_vector, чтобы понять тип поля id
      const tableInfoQuery = await this.pgClient.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'chunk_vector' AND column_name = 'id'
      `);
      
      // Проверяем тип поля id
      const idColumnType = tableInfoQuery.rows.length > 0 ? tableInfoQuery.rows[0].data_type : 'unknown';
      console.log(`[DB] Тип поля id в таблице chunk_vector: ${idColumnType}`);
      
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
            FROM public.chunk_vector fv
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
            FROM public.chunk_vector fv
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
          FROM public.chunk_vector fv
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
        UPDATE public.chunk_vector
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
        `DELETE FROM public.chunk_vector 
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
         FROM public.chunk_vector 
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
        `INSERT INTO public.chunk_vector (
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
          'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
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
          'SELECT id, ai_item_id FROM public.chunk_vector WHERE file_id = $1 AND full_name = $2 AND level = $3',
          [fileId, full_name, level]
        );
        
        // Если есть другие чанки с таким же full_name, используем существующий ai_item_id
        if (existingChunkQuery.rows.length > 0 && existingChunkQuery.rows[0].ai_item_id) {
          const existingItemId = existingChunkQuery.rows[0].ai_item_id;
          
          // Связываем текущий чанк с существующим AI Item
          await this.pgClient.query(
            'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
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
          'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
          [itemId, chunkId]
        );
        
        // Если есть другие чанки с таким же full_name, связываем их с этим же AI Item
        if (existingChunkQuery.rows.length > 0) {
          for (const row of existingChunkQuery.rows) {
            if (row.id !== chunkId) { // Пропускаем текущий чанк
              await this.pgClient.query(
                'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
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
        `UPDATE public.chunk_vector
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
      const items = await this._aiItemsRepo.getAll(contextCode);
      console.log(`[DB] Найдено ${items.length} AI Items`);
      return items;
    } catch (error) {
      console.error('Ошибка при получении списка ai_item:', error);
      throw error;
    }
  }

  /**
   * Получает AI Item по ID
   * @delegate AiItemsRepository.getById
   * @param {string} itemId - ID элемента AI Item
   * @returns {Promise<Object|null>} Информация об элементе или null, если не найден
   */
  async getAiItemById(itemId) {
    try {
      return await this._aiItemsRepo.getById(itemId);
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
               f.filename, f.context_code,
               (fv.embedding IS NOT NULL) AS has_embedding
        FROM public.chunk_vector fv
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
   * Обновление embedding чанка по ID
   * @param {number} chunkId - ID чанка в chunk_vector
   * @param {number[]} embedding - Массив чисел (вектор)
   * @returns {Promise<void>}
   */
  async updateChunkEmbedding(chunkId, embedding) {
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('embedding must be a non-empty array of numbers');
    }
    const vectorString = `[${embedding.join(',')}]`;
    await this.pgClient.query(
      'UPDATE public.chunk_vector SET embedding = $1 WHERE id = $2',
      [vectorString, chunkId]
    );
  }

  /**
   * Получение id записей ai_item по списку full_name и context_code
   * @delegate AiItemsRepository.getByFullNames
   * @param {string[]} fullNames - Список full_name
   * @param {string} contextCode - Код контекста
   * @returns {Promise<Array<{id: number, full_name: string}>>} Список { id, full_name } для найденных записей
   */
  async getAiItemIdsByFullNames(fullNames, contextCode) {
    return this._aiItemsRepo.getByFullNames(fullNames, contextCode);
  }

  /**
   * Обновление контекста для ai_item
   * @delegate AiItemsRepository.updateContextCode
   * @param {number} itemId - ID элемента
   * @param {string} newContextCode - Новый код контекста
   * @returns {Promise<Object>} Обновленный элемент
   */
  async updateAiItemContext(itemId, newContextCode) {
    try {
      const result = await this._aiItemsRepo.updateContextCode(itemId, newContextCode);
      if (!result) {
        throw new Error(`ai_item с ID ${itemId} не найден`);
      }
      return result;
    } catch (error) {
      console.error(`Ошибка при обновлении контекста ai_item с ID ${itemId}:`, error);
      throw error;
    }
  }

  /**
   * Очистка неиспользуемых ai_item
   * @delegate AiItemsRepository.cleanupOrphaned
   * @param {string|null} contextCode - Код контекста для фильтрации (опционально)
   * @returns {Promise<Array>} Список удаленных элементов
   */
  async cleanupOrphanedAiItems(contextCode = null) {
    try {
      const deleted = await this._aiItemsRepo.cleanupOrphaned(contextCode);
      if (deleted.length > 0) {
        console.log(`Удалено ${deleted.length} неиспользуемых ai_item`);
      }
      return deleted;
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
    const { full_name, contextCode, chunkId, type, sName, fileId, contentHash } = params;
    
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
          'UPDATE public.ai_item SET updated_at = CURRENT_TIMESTAMP, type = $1, s_name = $2, file_id = $3, content_hash = $4 WHERE id = $5',
          [type, sName, fileId, contentHash || null, itemId]
        );
      } else {
        // Иначе создаем новый
        const insertResult = await this.pgClient.query(
          'INSERT INTO public.ai_item (full_name, context_code, type, s_name, file_id, content_hash) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [full_name, contextCode, type, sName, fileId, contentHash || null]
        );
        itemId = insertResult.rows[0].id;
      }
      
      // Связываем чанк с AI Item
      if (chunkId) {
        await this.pgClient.query(
          'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
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
               (SELECT COUNT(*) FROM public.chunk_vector WHERE file_id = f.id) as chunks_count
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
   * Удаляет все записи из chunk_vector, ai_item и files
   * @returns {Promise<boolean>} Результат операции
   */
  async clearAllTables() {
    try {
      console.log("Начало полной очистки всех таблиц базы данных...");

      // Вариант 1: Простое удаление с использованием каскадных связей
      // Поскольку в chunk_vector есть ON DELETE CASCADE для files,
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
        ALTER SEQUENCE public.chunk_vector_id_seq RESTART WITH 1;
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
        TRUNCATE TABLE public.chunk_vector, public.ai_item, public.files
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

  /**
   * Очистка векторной базы данных для конкретного context-code
   * Удаляет все векторы, ai_item и файлы для указанного контекста
   * @param {string} contextCode - Код контекста для очистки
   * @returns {Promise<Object>} Статистика удаленных записей
   */
  async clearVectorDbByContextCode(contextCode) {
    try {
      if (!contextCode) {
        throw new Error('contextCode is required');
      }

      console.log(`[DB] Начало очистки векторной БД для context-code: "${contextCode}"`);

      // 1. Получаем ID файлов для этого context-code
      const filesResult = await this.pgClient.query(
        'SELECT id FROM public.files WHERE context_code = $1',
        [contextCode]
      );
      const fileIds = filesResult.rows.map(row => row.id);
      const filesCount = fileIds.length;

      // 2. Удаляем ai_item для этого context-code
      const aiItemsResult = await this.pgClient.query(
        'DELETE FROM public.ai_item WHERE context_code = $1 RETURNING id',
        [contextCode]
      );
      const aiItemsCount = aiItemsResult.rows.length;

      // 3. Удаляем ai_comment для этого context-code
      const aiCommentsResult = await this.pgClient.query(
        'DELETE FROM public.ai_comment WHERE context_code = $1 RETURNING id',
        [contextCode]
      );
      const aiCommentsCount = aiCommentsResult.rows.length;

      // 4. Удаляем чанки для файлов этого context-code
      // Используем JOIN для универсальности (работает с UUID и INTEGER)
      let chunksCount = 0;
      if (fileIds.length > 0) {
        // Используем подзапрос с JOIN для удаления чанков, связанных с файлами нужного context-code
        // Это работает независимо от типа file_id (UUID или INTEGER)
        const chunksResult = await this.pgClient.query(
          `DELETE FROM public.chunk_vector 
           WHERE file_id IN (
             SELECT id FROM public.files WHERE context_code = $1
           ) 
           RETURNING id`,
          [contextCode]
        );
        chunksCount = chunksResult.rows.length;
      }

      // 5. Удаляем файлы для этого context-code (каскадно удалятся связанные чанки, но мы уже удалили их выше)
      await this.pgClient.query(
        'DELETE FROM public.files WHERE context_code = $1',
        [contextCode]
      );

      console.log(`[DB] ✅ Очистка завершена для context-code "${contextCode}":`);
      console.log(`[DB]    - Файлов: ${filesCount}`);
      console.log(`[DB]    - Чанков: ${chunksCount}`);
      console.log(`[DB]    - AI Items: ${aiItemsCount}`);
      console.log(`[DB]    - AI Comments: ${aiCommentsCount}`);

      return {
        success: true,
        contextCode,
        deletedFiles: filesCount,
        deletedChunks: chunksCount,
        deletedAiItems: aiItemsCount,
        deletedAiComments: aiCommentsCount
      };
    } catch (error) {
      console.error(`[DB] ❌ Ошибка при очистке векторной БД для context-code "${contextCode}":`, error);
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
      const effectiveContextCode = contextCode || row.context_code;

      // Получаем чанки разных уровней
      // Извлекаем поле text из JSONB, если оно есть, иначе весь JSONB как текст
      const chunksResult = await this.pgClient.query(`
        SELECT COALESCE(chunk_content->>'text', chunk_content::text) as chunk_content, level, type, embedding
        FROM public.chunk_vector
        WHERE ai_item_id = $1
        ORDER BY chunk_index
      `, [row.ai_id]);

      let l0_code = '';
      let l2_desc = '';
      let hasEmbedding = false;

      chunksResult.rows.forEach(chunk => {
        if (chunk.level.startsWith('0-')) {
          // chunk_content уже извлечен как текст (поле text из JSONB или весь JSONB как текст)
          l0_code = chunk.chunk_content;
        } else if (chunk.level.startsWith('2-')) {
          l2_desc = chunk.chunk_content;
        }
        // Проверяем наличие embedding хотя бы у одного чанка
        if (chunk.embedding) {
          hasEmbedding = true;
        }
      });

      // Получаем L1 связи из таблицы link с типами
      // l1_out: source = текущий item, target существует в ai_item, с типом связи
      const l1OutResult = await this.pgClient.query(`
        SELECT DISTINCT l.target, lt.code as type
        FROM public.link l
        JOIN public.link_type lt ON lt.id = l.link_type_id
        JOIN public.ai_item ai ON ai.full_name = l.target AND ai.context_code = l.context_code
        WHERE l.source = $1 AND l.context_code = $2
      `, [full_name, effectiveContextCode]);

      // l1_in: target = текущий item, source существует в ai_item, с типом связи
      const l1InResult = await this.pgClient.query(`
        SELECT DISTINCT l.source, lt.code as type
        FROM public.link l
        JOIN public.link_type lt ON lt.id = l.link_type_id
        JOIN public.ai_item ai ON ai.full_name = l.source AND ai.context_code = l.context_code
        WHERE l.target = $1 AND l.context_code = $2
      `, [full_name, effectiveContextCode]);

      const language = this._getLanguageFromFilename(row.filename);

      return {
        id: row.full_name,                    // строковый ID по контракту
        type: row.type || 'unknown',
        language,
        l0_code,
        l1_out: l1OutResult.rows.map(r => ({ target: r.target, type: r.type })),
        l1_in: l1InResult.rows.map(r => ({ source: r.source, type: r.type })),
        l2_desc,
        filePath: row.file_url || path.join(this.docsDir || 'docs', row.filename),
        isVectorized: hasEmbedding           // флаг наличия embedding
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
        LEFT JOIN public.chunk_vector fv ON fv.ai_item_id = ai.id
      `;
      const params = [];

      if (contextCode) {
        query += ` WHERE ai.context_code = $1`;
        params.push(contextCode);
      }

      query += ` GROUP BY ai.id, f.id`;

      const result = await this.pgClient.query(query, params);

      // Получаем все связи одним batch-запросом с типами
      let linksQuery = `
        SELECT 
          l.source,
          l.target,
          lt.code as link_type,
          CASE WHEN ai_src.id IS NOT NULL THEN true ELSE false END as source_exists,
          CASE WHEN ai_tgt.id IS NOT NULL THEN true ELSE false END as target_exists
        FROM public.link l
        JOIN public.link_type lt ON lt.id = l.link_type_id
        LEFT JOIN public.ai_item ai_src ON ai_src.full_name = l.source AND ai_src.context_code = l.context_code
        LEFT JOIN public.ai_item ai_tgt ON ai_tgt.full_name = l.target AND ai_tgt.context_code = l.context_code
        WHERE 1=1
      `;
      const linksParams = [];
      
      if (contextCode) {
        linksQuery += ` AND l.context_code = $1`;
        linksParams.push(contextCode);
      }

      const linksResult = await this.pgClient.query(linksQuery, linksParams);

      // Построить Map: full_name → {l1_in: [], l1_out: []}
      const linksMap = new Map();
      for (const link of linksResult.rows) {
        if (link.source_exists && link.target_exists) {
          // l1_out для source
          if (!linksMap.has(link.source)) {
            linksMap.set(link.source, { l1_in: [], l1_out: [] });
          }
          linksMap.get(link.source).l1_out.push({ target: link.target, type: link.link_type });
          
          // l1_in для target
          if (!linksMap.has(link.target)) {
            linksMap.set(link.target, { l1_in: [], l1_out: [] });
          }
          linksMap.get(link.target).l1_in.push({ source: link.source, type: link.link_type });
        }
      }

      const items = result.rows.map(row => {
        let l0_code = '';
        let l2_desc = '';

        // Обрабатываем агрегированные чанки
        const chunks = row.chunks || [];
        for (const chunk of chunks) {
          if (!chunk.level) continue;
          
          if (chunk.level.startsWith('0-')) {
            l0_code = chunk.chunk_content || '';
          } else if (chunk.level.startsWith('2-')) {
            l2_desc = chunk.chunk_content || '';
          }
        }

        const language = this._getLanguageFromFilename(row.filename);
        const links = linksMap.get(row.full_name) || { l1_in: [], l1_out: [] };

        return {
          id: row.full_name,
          type: row.type || 'unknown',
          language,
          l0_code,
          l1_out: links.l1_out,
          l1_in: links.l1_in,
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
           FROM public.chunk_vector fv
           JOIN public.files f ON fv.file_id = f.id
           WHERE fv.level LIKE '1-%' AND f.context_code = $1`
        : `SELECT COUNT(*) AS count 
           FROM public.chunk_vector 
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
           FROM public.chunk_vector fv
           JOIN public.files f ON fv.file_id = f.id
           WHERE fv.embedding IS NOT NULL AND f.context_code = $1`
        : `SELECT COUNT(*) AS count 
           FROM public.chunk_vector 
           WHERE embedding IS NOT NULL`;
      const vectorSizeRes = await this.pgClient.query(vectorSizeQuery, params);
      const vectorIndexSize = `${vectorSizeRes.rows[0].count} vectors`;

      // 6. Дата последней модификации (по чанкам)
      const lastScanQuery = contextCode
        ? `SELECT MAX(fv.created_at) AS last 
           FROM public.chunk_vector fv
           JOIN public.files f ON fv.file_id = f.id
           WHERE f.context_code = $1`
        : `SELECT MAX(created_at) AS last 
           FROM public.chunk_vector`;
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
        FROM public.chunk_vector fv
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
        SELECT id, created_at FROM public.chunk_vector
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
          `UPDATE public.chunk_vector
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
          `INSERT INTO public.chunk_vector
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
        DELETE FROM public.chunk_vector
        WHERE ai_item_id IN (
          SELECT ai.id FROM public.ai_item ai
          WHERE ai.full_name = $1
        ) AND level = '2-logic'
      `;
      const params = [fullName];

      if (contextCode) {
        query = `
          DELETE FROM public.chunk_vector
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

  /**
   * Получение комментария для ai_item
   * @param {string} contextCode - Контекстный код
   * @param {string} fullName - full_name AiItem
   * @returns {Promise<Object|null>} { comment, createdAt, updatedAt } или null
   */
  async getAiComment(contextCode, fullName) {
    try {
      const result = await this.pgClient.query(`
        SELECT comment, created_at, updated_at
        FROM public.ai_comment
        WHERE context_code = $1 AND full_name = $2
      `, [contextCode, fullName]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        comment: row.comment,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
      };
    } catch (error) {
      console.error(`[DB] Ошибка getAiComment("${contextCode}", "${fullName}"):`, error);
      throw error;
    }
  }

  /**
   * Создание комментария для ai_item (если не существует)
   * @param {string} contextCode - Контекстный код
   * @param {string} fullName - full_name AiItem
   * @param {string} comment - Текст комментария
   * @returns {Promise<void>}
   */
  async createAiCommentIfNotExists(contextCode, fullName, comment) {
    try {
      const result = await this.pgClient.query(`
        INSERT INTO public.ai_comment (context_code, full_name, comment)
        VALUES ($1, $2, $3)
        ON CONFLICT (context_code, full_name) DO NOTHING
        RETURNING id
      `, [contextCode, fullName, comment]);
      
      if (result.rows.length > 0) {
        console.log(`[DB] 📝 ai_comment создан: id=${result.rows[0].id}, context="${contextCode}", full_name="${fullName}"`);
      } else {
        console.log(`[DB] ℹ️  ai_comment уже существует, пропуск: context="${contextCode}", full_name="${fullName}"`);
      }
    } catch (error) {
      console.error(`[DB] ❌ Ошибка createAiCommentIfNotExists("${contextCode}", "${fullName}"):`, error);
      throw error;
    }
  }

  /**
   * Создание или обновление комментария для ai_item (UPSERT)
   * @param {string} contextCode - Контекстный код
   * @param {string} fullName - full_name AiItem
   * @param {string} comment - Текст комментария
   * @returns {Promise<Object>} { comment, createdAt, updatedAt }
   */
  async createAiComment(contextCode, fullName, comment) {
    try {
      const result = await this.pgClient.query(`
        INSERT INTO public.ai_comment (context_code, full_name, comment)
        VALUES ($1, $2, $3)
        ON CONFLICT (context_code, full_name) 
        DO UPDATE SET 
          comment = EXCLUDED.comment,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id, comment, created_at, updated_at
      `, [contextCode, fullName, comment]);

      const row = result.rows[0];
      const isNew = !row.updated_at || row.created_at === row.updated_at;
      const action = isNew ? 'создан' : 'обновлен';
      console.log(`[DB] 📝 ai_comment ${action}: id=${row.id}, context="${contextCode}", full_name="${fullName}"`);
      
      return {
        comment: row.comment,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
      };
    } catch (error) {
      console.error(`[DB] ❌ Ошибка createAiComment("${contextCode}", "${fullName}"):`, error);
      throw error;
    }
  }

  /**
   * Обновление комментария для ai_item
   * @param {string} contextCode - Контекстный код
   * @param {string} fullName - full_name AiItem
   * @param {string} comment - Текст комментария
   * @returns {Promise<Object|null>} { comment, createdAt, updatedAt } или null если не найдено
   */
  async updateAiComment(contextCode, fullName, comment) {
    try {
      const result = await this.pgClient.query(`
        UPDATE public.ai_comment
        SET comment = $3, updated_at = CURRENT_TIMESTAMP
        WHERE context_code = $1 AND full_name = $2
        RETURNING id, comment, created_at, updated_at
      `, [contextCode, fullName, comment]);

      if (result.rows.length === 0) {
        console.log(`[DB] ⚠️  ai_comment не найден для обновления: context="${contextCode}", full_name="${fullName}"`);
        return null;
      }

      const row = result.rows[0];
      console.log(`[DB] 📝 ai_comment обновлен: id=${row.id}, context="${contextCode}", full_name="${fullName}"`);
      
      return {
        comment: row.comment,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
      };
    } catch (error) {
      console.error(`[DB] ❌ Ошибка updateAiComment("${contextCode}", "${fullName}"):`, error);
      throw error;
    }
  }

  /**
   * Удаление комментария для ai_item
   * @param {string} contextCode - Контекстный код
   * @param {string} fullName - full_name AiItem
   * @returns {Promise<boolean>} true если удалено, false если не найдено
   */
  async deleteAiComment(contextCode, fullName) {
    try {
      const result = await this.pgClient.query(`
        DELETE FROM public.ai_comment
        WHERE context_code = $1 AND full_name = $2
        RETURNING id
      `, [contextCode, fullName]);

      if (result.rows.length > 0) {
        console.log(`[DB] 🗑️  ai_comment удален: id=${result.rows[0].id}, context="${contextCode}", full_name="${fullName}"`);
        return true;
      } else {
        console.log(`[DB] ⚠️  ai_comment не найден для удаления: context="${contextCode}", full_name="${fullName}"`);
        return false;
      }
    } catch (error) {
      console.error(`[DB] ❌ Ошибка deleteAiComment("${contextCode}", "${fullName}"):`, error);
      throw error;
    }
  }

/*
  AGENT-SCRIPT
*/


/**
 * Получение скрипта для агента
 * @param {string} contextCode - Контекстный код
 * @param {string} question - Вопрос
 * @returns {Promise<Object|null>} { id, script, question } или null если не найдено
 */
  async getAgentScript(contextCode, question) {
    try {
      const result = await this.pgClient.query(`
        SELECT id, script, question
        FROM public.agent_script
        WHERE context_code = $1 AND question = $2
      `, [contextCode, question]);

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } catch (error) {
      console.error(`[DB] ❌ Ошибка getAgentScript("${contextCode}", "${question}"):`, error);
      throw error;
    }
  }

  /**
   * Выполнение произвольного SELECT или WITH (CTE) запроса (только для чтения)
   * @param {string} sql - SQL запрос (должен начинаться с SELECT или WITH)
   * @param {Array} params - Параметры запроса
   * @returns {Promise<Array>} Массив строк результата
   */
  async queryRaw(sql, params = []) {
    try {
      const trimmedSql = sql.trim().toUpperCase();
      // Разрешаем SELECT и WITH (CTE) запросы, запрещаем всё остальное
      // WITH всегда содержит SELECT внутри, поэтому безопасно
      const isSelect = trimmedSql.startsWith('SELECT') || trimmedSql.startsWith('WITH');
      if (!isSelect) {
        throw new Error(`Only SELECT and WITH (CTE) queries are allowed. Found: ${trimmedSql.substring(0, 50)}...`);
      }

      const result = await this.pgClient.query(sql, params);
      return result.rows;
    } catch (error) {
      console.error(`[DB] ❌ Ошибка queryRaw:`, error);
      throw error;
    }
  }

  /**
   * Поиск скрипта по точному совпадению вопроса
   * @param {string} contextCode - Контекстный код
   * @param {string} question - Точный вопрос
   * @returns {Promise<Object|null>} { id, question, script } или null
   */
  async getAgentScriptByExactQuestion(contextCode, question) {
    try {
      const result = await this.pgClient.query(`
        SELECT id, question, script
        FROM public.agent_script
        WHERE context_code = $1 AND question = $2 AND is_valid = true
        LIMIT 1
      `, [contextCode, question]);

      if (result.rows.length === 0) {
        return null;
      }

      return {
        id: result.rows[0].id,
        question: result.rows[0].question,
        script: result.rows[0].script
      };
    } catch (error) {
      console.error(`[DB] ❌ Ошибка getAgentScriptByExactQuestion("${contextCode}", "${question}"):`, error);
      throw error;
    }
  }

  /**
   * Поиск похожего скрипта через FTS (Full Text Search)
   * @param {string} contextCode - Контекстный код
   * @param {string} question - Вопрос для поиска
   * @param {number} threshold - Минимальный ранг для совпадения (по умолчанию 0.1)
   * @returns {Promise<Object|null>} { id, question, script, rank } или null
   */
  async fuzzySearchScripts(contextCode, question, threshold = 0.1) {
    try {
      const result = await this.pgClient.query(`
        SELECT id, question, script, 
               ts_rank(to_tsvector('russian', question), plainto_tsquery('russian', $1)) as rank
        FROM public.agent_script
        WHERE context_code = $2
          AND to_tsvector('russian', question) @@ plainto_tsquery('russian', $1)
          AND is_valid = true
        ORDER BY rank DESC, usage_count DESC
        LIMIT 1
      `, [question, contextCode]);

      if (result.rows.length === 0) {
        return null;
      }

      const script = result.rows[0];
      // Проверяем порог релевантности
      if (script.rank < threshold) {
        return null;
      }

      return {
        id: script.id,
        question: script.question,
        script: script.script,
        rank: parseFloat(script.rank)
      };
    } catch (error) {
      console.error(`[DB] ❌ Ошибка fuzzySearchScripts("${contextCode}", "${question}"):`, error);
      throw error;
    }
  }

  /**
   * Сохранение нового скрипта в agent_script
   * @param {string} contextCode - Контекстный код
   * @param {string} question - Вопрос
   * @param {string} script - Код скрипта
   * @param {boolean} isValid - Флаг валидности (по умолчанию false)
   * @returns {Promise<Object>} { id, question, script, created_at }
   */
  async saveAgentScript(contextCode, question, script, isValid = false) {
    try {
      // Проверяем, нет ли уже такого вопроса (UNIQUE constraint)
      const existing = await this.pgClient.query(`
        SELECT id FROM public.agent_script
        WHERE context_code = $1 AND question = $2
      `, [contextCode, question]);

      if (existing.rows.length > 0) {
        // Обновляем существующий
        const result = await this.pgClient.query(`
          UPDATE public.agent_script
          SET script = $1, is_valid = $2, updated_at = CURRENT_TIMESTAMP
          WHERE context_code = $3 AND question = $4
          RETURNING id, question, script, created_at, updated_at
        `, [script, isValid, contextCode, question]);

        return result.rows[0];
      } else {
        // Создаём новый
        // Логируем количество переводов строк перед INSERT
        const newlineCount = (script.match(/\n/g) || []).length;
        console.log(`[DB] Сохранение скрипта: ${newlineCount} переводов строк, длина: ${script.length} символов`);
        
        const result = await this.pgClient.query(`
          INSERT INTO public.agent_script (context_code, question, script, is_valid)
          VALUES ($1, $2, $3, $4)
          RETURNING id, question, script, created_at, updated_at
        `, [contextCode, question, script, isValid]);

        // Проверяем, что вернулось из БД
        const returnedNewlineCount = (result.rows[0].script.match(/\n/g) || []).length;
        console.log(`[DB] Скрипт сохранён: ${returnedNewlineCount} переводов строк в возвращённом значении`);
        
        if (newlineCount !== returnedNewlineCount) {
          console.warn(`[DB] ⚠️  Несоответствие переводов строк: было ${newlineCount}, вернулось ${returnedNewlineCount}`);
        }

        return result.rows[0];
      }
    } catch (error) {
      console.error(`[DB] ❌ Ошибка saveAgentScript("${contextCode}", "${question}"):`, error);
      throw error;
    }
  }

  /**
   * Инкремент счётчика использования скрипта
   * @param {number} scriptId - ID скрипта
   * @returns {Promise<Object>} Обновлённый скрипт с usage_count
   */
  async incrementUsage(scriptId) {
    try {
      const result = await this.pgClient.query(`
        UPDATE public.agent_script
        SET usage_count = usage_count + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, usage_count, question
      `, [scriptId]);

      if (result.rows.length === 0) {
        throw new Error(`Script with id ${scriptId} not found`);
      }

      return result.rows[0];
    } catch (error) {
      console.error(`[DB] ❌ Ошибка incrementUsage(${scriptId}):`, error);
      throw error;
    }
  }

  /**
   * Сохранение эмбеддинга вопроса для векторного поиска
   * @param {number} scriptId - ID скрипта
   * @param {Array<number>} embedding - Вектор эмбеддинга (1536 элементов)
   * @returns {Promise<Object>} Сохранённая запись
   */
  async saveQuestionEmbedding(scriptId, embedding) {
    try {
      if (!Array.isArray(embedding) || embedding.length !== 1536) {
        throw new Error(`Embedding must be an array of 1536 numbers, got: ${Array.isArray(embedding) ? embedding.length : typeof embedding}`);
      }

      const vectorString = `[${embedding.join(',')}]`;

      const result = await this.pgClient.query(`
        UPDATE public.agent_script
        SET question_embedding = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, question, updated_at
      `, [scriptId, vectorString]);

      if (result.rows.length === 0) {
        throw new Error(`Script with id ${scriptId} not found`);
      }

      return result.rows[0];
    } catch (error) {
      console.error(`[DB] ❌ Ошибка saveQuestionEmbedding(${scriptId}):`, error);
      throw error;
    }
  }

  /**
   * Векторный поиск похожих вопросов по cosine similarity
   * @param {string} contextCode - Контекстный код
   * @param {Array<number>} embedding - Вектор эмбеддинга вопроса пользователя
   * @param {number} limit - Максимальное количество результатов
   * @param {number} threshold - Минимальный порог similarity (0.0 - 1.0)
   * @returns {Promise<Array>} Массив похожих скриптов с similarity
   */
  async searchSimilarQuestions(contextCode, embedding, limit = 5, threshold = 0.8) {
    try {
      if (!Array.isArray(embedding) || embedding.length !== 1536) {
        throw new Error(`Embedding must be an array of 1536 numbers, got: ${Array.isArray(embedding) ? embedding.length : typeof embedding}`);
      }

      const vectorString = `[${embedding.join(',')}]`;

      const result = await this.pgClient.query(`
        SELECT 
          id,
          question,
          script,
          usage_count,
          is_valid,
          last_result,
          1 - (question_embedding <=> $1::vector) AS similarity
        FROM public.agent_script
        WHERE context_code = $2
          AND is_valid = true
          AND question_embedding IS NOT NULL
          AND (1 - (question_embedding <=> $1::vector)) >= $3
        ORDER BY similarity DESC
        LIMIT $4
      `, [vectorString, contextCode, threshold, limit]);

      return result.rows.map(row => ({
        id: row.id,
        question: row.question,
        script: row.script,
        usage_count: row.usage_count,
        is_valid: row.is_valid,
        last_result: row.last_result,
        similarity: parseFloat(row.similarity)
      }));
    } catch (error) {
      console.error(`[DB] ❌ Ошибка searchSimilarQuestions("${contextCode}"):`, error);
      throw error;
    }
  }

  /**
   * Получение эмбеддинга вопроса по script_id
   * @param {number} scriptId - ID скрипта
   * @returns {Promise<Array<number>|null>} Вектор эмбеддинга или null
   */
  async getQuestionEmbedding(scriptId) {
    try {
      const result = await this.pgClient.query(`
        SELECT question_embedding
        FROM public.agent_script
        WHERE id = $1
      `, [scriptId]);

      if (result.rows.length === 0 || !result.rows[0].question_embedding) {
        return null;
      }

      // PostgreSQL возвращает vector как строку в формате [1,2,3]
      const vectorString = result.rows[0].question_embedding;
      // Парсим строку в массив чисел
      const embedding = vectorString
        .replace(/[\[\]]/g, '')
        .split(',')
        .map(Number);

      return embedding;
    } catch (error) {
      console.error(`[DB] ❌ Ошибка getQuestionEmbedding(${scriptId}):`, error);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAGS — Управление тегами для AI Items
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Получить все теги для context-code
   * @param {string} contextCode - Контекстный код
   * @returns {Promise<Array>} Массив тегов
   */
  async getAllTags(contextCode) {
    try {
      const result = await this.pgClient.query(`
        SELECT id, code, name, description, created_at, updated_at
        FROM public.tag
        WHERE context_code = $1
        ORDER BY name ASC
      `, [contextCode]);

      return result.rows;
    } catch (error) {
      console.error(`[DB] ❌ Ошибка getAllTags("${contextCode}"):`, error);
      throw error;
    }
  }

  /**
   * Получить тег по коду
   * @param {string} contextCode - Контекстный код
   * @param {string} tagCode - Код тега
   * @returns {Promise<Object|null>} Тег или null
   */
  async getTagByCode(contextCode, tagCode) {
    try {
      const result = await this.pgClient.query(`
        SELECT id, code, name, description, created_at, updated_at
        FROM public.tag
        WHERE context_code = $1 AND code = $2
      `, [contextCode, tagCode]);

      return result.rows[0] || null;
    } catch (error) {
      console.error(`[DB] ❌ Ошибка getTagByCode("${contextCode}", "${tagCode}"):`, error);
      throw error;
    }
  }

  /**
   * Создать новый тег
   * @param {string} contextCode - Контекстный код
   * @param {string} code - Код тега
   * @param {string} name - Название тега
   * @param {string|null} description - Описание тега
   * @returns {Promise<Object>} Созданный тег
   */
  async createTag(contextCode, code, name, description = null) {
    try {
      const result = await this.pgClient.query(`
        INSERT INTO public.tag (context_code, code, name, description)
        VALUES ($1, $2, $3, $4)
        RETURNING id, code, name, description, created_at, updated_at
      `, [contextCode, code, name, description]);

      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') { // unique_violation
        const customError = new Error(`Tag with code '${code}' already exists`);
        customError.code = 'DUPLICATE_TAG';
        throw customError;
      }
      console.error(`[DB] ❌ Ошибка createTag("${contextCode}", "${code}"):`, error);
      throw error;
    }
  }

  /**
   * Обновить тег
   * @param {string} contextCode - Контекстный код
   * @param {string} tagCode - Код тега
   * @param {Object} updates - Поля для обновления {name?, description?}
   * @returns {Promise<Object|null>} Обновлённый тег или null
   */
  async updateTag(contextCode, tagCode, updates) {
    try {
      const setClauses = [];
      const values = [];
      let paramIndex = 1;

      if (updates.name !== undefined) {
        setClauses.push(`name = $${paramIndex++}`);
        values.push(updates.name);
      }
      if (updates.description !== undefined) {
        setClauses.push(`description = $${paramIndex++}`);
        values.push(updates.description);
      }

      if (setClauses.length === 0) {
        return await this.getTagByCode(contextCode, tagCode);
      }

      setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(contextCode, tagCode);

      const result = await this.pgClient.query(`
        UPDATE public.tag
        SET ${setClauses.join(', ')}
        WHERE context_code = $${paramIndex++} AND code = $${paramIndex}
        RETURNING id, code, name, description, created_at, updated_at
      `, values);

      return result.rows[0] || null;
    } catch (error) {
      console.error(`[DB] ❌ Ошибка updateTag("${contextCode}", "${tagCode}"):`, error);
      throw error;
    }
  }

  /**
   * Удалить тег
   * @param {string} contextCode - Контекстный код
   * @param {string} tagCode - Код тега
   * @param {boolean} force - Принудительное удаление (удалить связи)
   * @returns {Promise<boolean>} true если удалён, false если не найден
   */
  async deleteTag(contextCode, tagCode, force = false) {
    try {
      // Сначала получаем id тега
      const tag = await this.getTagByCode(contextCode, tagCode);
      if (!tag) {
        return false;
      }

      // Проверяем, используется ли тег
      const usageCheck = await this.pgClient.query(`
        SELECT COUNT(*) as count
        FROM public.ai_item_tag
        WHERE tag_id = $1
      `, [tag.id]);

      const usageCount = parseInt(usageCheck.rows[0].count);

      if (usageCount > 0 && !force) {
        const error = new Error(`Tag is used by ${usageCount} AI Items. Use force=true to delete anyway`);
        error.code = 'TAG_IN_USE';
        error.usageCount = usageCount;
        throw error;
      }

      // Удаляем связи (каскадно)
      if (usageCount > 0) {
        await this.pgClient.query(`
          DELETE FROM public.ai_item_tag WHERE tag_id = $1
        `, [tag.id]);
      }

      // Удаляем тег
      await this.pgClient.query(`
        DELETE FROM public.tag WHERE id = $1
      `, [tag.id]);

      return true;
    } catch (error) {
      if (error.code === 'TAG_IN_USE') throw error;
      console.error(`[DB] ❌ Ошибка deleteTag("${contextCode}", "${tagCode}"):`, error);
      throw error;
    }
  }

  /**
   * Получить AI Items с указанным тегом
   * @param {string} contextCode - Контекстный код
   * @param {string} tagCode - Код тега
   * @returns {Promise<{tag: Object, items: Array}>} Тег и массив AI Items
   */
  async getAiItemsByTag(contextCode, tagCode) {
    try {
      const tag = await this.getTagByCode(contextCode, tagCode);
      if (!tag) {
        return null;
      }

      const result = await this.pgClient.query(`
        SELECT 
          ai.full_name as id,
          ai.type,
          f.filename as "filePath",
          COALESCE(
            (SELECT cv.metadata->>'language' 
             FROM public.chunk_vector cv 
             WHERE cv.ai_item_id = ai.id 
             LIMIT 1),
            'unknown'
          ) as language
        FROM public.ai_item_tag ait
        JOIN public.ai_item ai ON ai.full_name = ait.ai_item_full_name 
          AND ai.context_code = ait.ai_item_context_code
        LEFT JOIN public.files f ON f.id = ai.file_id
        WHERE ait.tag_id = $1
        ORDER BY ai.full_name ASC
      `, [tag.id]);

      return {
        tag,
        items: result.rows
      };
    } catch (error) {
      console.error(`[DB] ❌ Ошибка getAiItemsByTag("${contextCode}", "${tagCode}"):`, error);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ITEM TYPES — Справочник типов AI Items (аналогично tags)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Базовые типы для seed (из loaders: sql, js, ts, php, md, ddl, table) */
  static get BASE_ITEM_TYPES() {
    return [
      { code: 'function', name: 'Функция', description: 'PL/pgSQL, JS, TS, PHP функции' },
      { code: 'class', name: 'Класс', description: 'Класс (JS, TS, PHP)' },
      { code: 'method', name: 'Метод', description: 'Метод класса' },
      { code: 'arrow', name: 'Arrow функция', description: 'Стрелочная функция (JS, TS)' },
      { code: 'interface', name: 'Интерфейс', description: 'Интерфейс (TS, PHP)' },
      { code: 'trait', name: 'Trait', description: 'Trait (PHP)' },
      { code: 'table', name: 'Таблица', description: 'Таблица БД (DDL, schema)' },
      { code: 'table_column', name: 'Колонка таблицы', description: 'Колонка (column extractor)' },
      { code: 'view', name: 'Представление', description: 'View (SQL)' },
      { code: 'procedure', name: 'Процедура', description: 'Процедура (SQL)' },
      { code: 'trigger', name: 'Триггер', description: 'Триггер (SQL)' },
      { code: 'index', name: 'Индекс', description: 'Индекс (SQL)' },
      { code: 'sequence', name: 'Последовательность', description: 'Sequence (SQL)' },
      { code: 'type', name: 'Тип', description: 'Type/Domain (SQL)' },
      { code: 'domain', name: 'Domain', description: 'Domain (SQL)' },
      { code: 'schema', name: 'Схема', description: 'Схема БД' },
      { code: 'role', name: 'Роль', description: 'Роль PostgreSQL' },
      { code: 'grant', name: 'Grant', description: 'Права доступа' },
      { code: 'md_doc', name: 'MD документ', description: 'Пролог Markdown' },
      { code: 'head_level_1', name: 'H1 раздел', description: 'Раздел # Markdown' },
      { code: 'head_level_2', name: 'H2 подраздел', description: 'Подраздел ## Markdown' }
    ];
  }

  /**
   * Получить список всех типов (с lazy seed при первом обращении)
   * @param {string} contextCode - Контекстный код
   * @returns {Promise<Array>} Массив типов
   */
  async getAllItemTypes(contextCode) {
    try {
      const result = await this.pgClient.query(`
        SELECT id, code, name, description, is_system, created_at, updated_at
        FROM public.item_type
        WHERE context_code = $1
        ORDER BY name ASC
      `, [contextCode]);

      if (result.rows.length === 0) {
        await this._seedItemTypes(contextCode);
        return this.getAllItemTypes(contextCode);
      }
      return result.rows;
    } catch (error) {
      console.error(`[DB] ❌ Ошибка getAllItemTypes("${contextCode}"):`, error);
      throw error;
    }
  }

  async _seedItemTypes(contextCode) {
    const types = DbService.BASE_ITEM_TYPES;
    for (const t of types) {
      await this.pgClient.query(`
        INSERT INTO public.item_type (context_code, code, name, description, is_system)
        VALUES ($1, $2, $3, $4, true)
        ON CONFLICT (context_code, code) DO NOTHING
      `, [contextCode, t.code, t.name, t.description || null]);
    }
  }

  /**
   * Получить тип по коду
   * @param {string} contextCode - Контекстный код
   * @param {string} typeCode - Код типа
   * @returns {Promise<Object|null>} Тип или null
   */
  async getItemTypeByCode(contextCode, typeCode) {
    try {
      const result = await this.pgClient.query(`
        SELECT id, code, name, description, is_system, created_at, updated_at
        FROM public.item_type
        WHERE context_code = $1 AND code = $2
      `, [contextCode, typeCode]);
      return result.rows[0] || null;
    } catch (error) {
      console.error(`[DB] ❌ Ошибка getItemTypeByCode("${contextCode}", "${typeCode}"):`, error);
      throw error;
    }
  }

  /**
   * Создать новый тип (is_system=false)
   * @param {string} contextCode - Контекстный код
   * @param {Object} data - { code, name, description? }
   * @returns {Promise<Object>} Созданный тип
   */
  async createItemType(contextCode, { code, name, description = null }) {
    try {
      const result = await this.pgClient.query(`
        INSERT INTO public.item_type (context_code, code, name, description, is_system)
        VALUES ($1, $2, $3, $4, false)
        RETURNING id, code, name, description, is_system, created_at, updated_at
      `, [contextCode, code, name, description]);
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') {
        const customError = new Error(`Item type with code '${code}' already exists`);
        customError.code = 'DUPLICATE_TYPE';
        throw customError;
      }
      console.error(`[DB] ❌ Ошибка createItemType("${contextCode}", "${code}"):`, error);
      throw error;
    }
  }

  /**
   * Обновить тип
   * @param {string} contextCode - Контекстный код
   * @param {string} typeCode - Код типа
   * @param {Object} updates - { name?, description? }
   * @returns {Promise<Object|null>} Обновлённый тип или null
   */
  async updateItemType(contextCode, typeCode, updates) {
    try {
      const setClauses = [];
      const values = [];
      let paramIndex = 1;
      if (updates.name !== undefined) {
        setClauses.push(`name = $${paramIndex++}`);
        values.push(updates.name);
      }
      if (updates.description !== undefined) {
        setClauses.push(`description = $${paramIndex++}`);
        values.push(updates.description);
      }
      if (setClauses.length === 0) return this.getItemTypeByCode(contextCode, typeCode);
      setClauses.push('updated_at = CURRENT_TIMESTAMP');
      values.push(contextCode, typeCode);
      const result = await this.pgClient.query(`
        UPDATE public.item_type
        SET ${setClauses.join(', ')}
        WHERE context_code = $${paramIndex++} AND code = $${paramIndex}
        RETURNING id, code, name, description, is_system, created_at, updated_at
      `, values);
      return result.rows[0] || null;
    } catch (error) {
      console.error(`[DB] ❌ Ошибка updateItemType("${contextCode}", "${typeCode}"):`, error);
      throw error;
    }
  }

  /**
   * Удалить тип (только если is_system=false)
   * @param {string} contextCode - Контекстный код
   * @param {string} typeCode - Код типа
   * @returns {Promise<boolean>} true если удалён
   */
  async deleteItemType(contextCode, typeCode) {
    try {
      const type = await this.getItemTypeByCode(contextCode, typeCode);
      if (!type) return false;
      if (type.is_system) {
        const error = new Error('Cannot delete system type');
        error.code = 'SYSTEM_TYPE_READONLY';
        throw error;
      }
      await this.pgClient.query(`
        DELETE FROM public.item_type WHERE context_code = $1 AND code = $2
      `, [contextCode, typeCode]);
      return true;
    } catch (error) {
      if (error.code === 'SYSTEM_TYPE_READONLY') throw error;
      console.error(`[DB] ❌ Ошибка deleteItemType("${contextCode}", "${typeCode}"):`, error);
      throw error;
    }
  }

  /**
   * Получить AI Items с указанным типом
   * @param {string} contextCode - Контекстный код
   * @param {string} typeCode - Код типа
   * @returns {Promise<{itemType: Object, items: Array}|null>}
   */
  async getAiItemsByType(contextCode, typeCode) {
    try {
      const itemType = await this.getItemTypeByCode(contextCode, typeCode);
      if (!itemType) return null;

      const result = await this.pgClient.query(`
        SELECT
          ai.full_name as id,
          ai.type,
          f.filename as "filePath",
          COALESCE(
            (SELECT cv.metadata->>'language'
             FROM public.chunk_vector cv
             WHERE cv.ai_item_id = ai.id
             LIMIT 1),
            'unknown'
          ) as language
        FROM public.ai_item ai
        LEFT JOIN public.files f ON f.id = ai.file_id
        WHERE ai.context_code = $1 AND ai.type = $2
        ORDER BY ai.full_name ASC
      `, [contextCode, typeCode]);

      return { itemType, items: result.rows };
    } catch (error) {
      console.error(`[DB] ❌ Ошибка getAiItemsByType("${contextCode}", "${typeCode}"):`, error);
      throw error;
    }
  }

  /**
   * Получить теги AI Item
   * @param {string} contextCode - Контекстный код
   * @param {string} itemFullName - full_name AI Item
   * @returns {Promise<Array>} Массив тегов
   */
  async getAiItemTags(contextCode, itemFullName) {
    try {
      const result = await this.pgClient.query(`
        SELECT t.id, t.code, t.name, t.description, t.created_at, t.updated_at
        FROM public.tag t
        JOIN public.ai_item_tag ait ON ait.tag_id = t.id
        WHERE ait.ai_item_full_name = $1 AND ait.ai_item_context_code = $2
        ORDER BY t.name ASC
      `, [itemFullName, contextCode]);

      return result.rows;
    } catch (error) {
      console.error(`[DB] ❌ Ошибка getAiItemTags("${contextCode}", "${itemFullName}"):`, error);
      throw error;
    }
  }

  /**
   * Добавить теги к AI Item
   * @param {string} contextCode - Контекстный код
   * @param {string} itemFullName - full_name AI Item
   * @param {Array<string>} tagCodes - Массив кодов тегов
   * @returns {Promise<Array>} Обновлённый массив тегов
   */
  async addTagsToAiItem(contextCode, itemFullName, tagCodes) {
    try {
      // Проверяем существование AI Item
      const aiItem = await this.pgClient.query(`
        SELECT full_name FROM public.ai_item
        WHERE full_name = $1 AND context_code = $2
      `, [itemFullName, contextCode]);

      if (aiItem.rows.length === 0) {
        const error = new Error(`AI Item not found: ${itemFullName}`);
        error.code = 'AI_ITEM_NOT_FOUND';
        throw error;
      }

      // Получаем id тегов по кодам
      const tagsResult = await this.pgClient.query(`
        SELECT id, code FROM public.tag
        WHERE context_code = $1 AND code = ANY($2)
      `, [contextCode, tagCodes]);

      const foundCodes = tagsResult.rows.map(r => r.code);
      const notFoundCodes = tagCodes.filter(c => !foundCodes.includes(c));

      if (notFoundCodes.length > 0) {
        const error = new Error(`Tags not found: ${notFoundCodes.join(', ')}`);
        error.code = 'TAGS_NOT_FOUND';
        error.notFoundCodes = notFoundCodes;
        throw error;
      }

      // Добавляем связи (ON CONFLICT DO NOTHING для idempotent)
      for (const tag of tagsResult.rows) {
        await this.pgClient.query(`
          INSERT INTO public.ai_item_tag (ai_item_full_name, ai_item_context_code, tag_id)
          VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING
        `, [itemFullName, contextCode, tag.id]);
      }

      return await this.getAiItemTags(contextCode, itemFullName);
    } catch (error) {
      if (error.code === 'AI_ITEM_NOT_FOUND' || error.code === 'TAGS_NOT_FOUND') throw error;
      console.error(`[DB] ❌ Ошибка addTagsToAiItem("${contextCode}", "${itemFullName}"):`, error);
      throw error;
    }
  }

  /**
   * Удалить теги у AI Item
   * @param {string} contextCode - Контекстный код
   * @param {string} itemFullName - full_name AI Item
   * @param {Array<string>} tagCodes - Массив кодов тегов
   * @returns {Promise<Array>} Обновлённый массив тегов
   */
  async removeTagsFromAiItem(contextCode, itemFullName, tagCodes) {
    try {
      // Получаем id тегов по кодам
      const tagsResult = await this.pgClient.query(`
        SELECT id FROM public.tag
        WHERE context_code = $1 AND code = ANY($2)
      `, [contextCode, tagCodes]);

      const tagIds = tagsResult.rows.map(r => r.id);

      if (tagIds.length > 0) {
        await this.pgClient.query(`
          DELETE FROM public.ai_item_tag
          WHERE ai_item_full_name = $1 
            AND ai_item_context_code = $2 
            AND tag_id = ANY($3)
        `, [itemFullName, contextCode, tagIds]);
      }

      return await this.getAiItemTags(contextCode, itemFullName);
    } catch (error) {
      console.error(`[DB] ❌ Ошибка removeTagsFromAiItem("${contextCode}", "${itemFullName}"):`, error);
      throw error;
    }
  }

  /**
   * Синхронизировать теги AI Item (заменить все)
   * @param {string} contextCode - Контекстный код
   * @param {string} itemFullName - full_name AI Item
   * @param {Array<string>} tagCodes - Массив кодов тегов
   * @returns {Promise<Array>} Обновлённый массив тегов
   */
  async syncAiItemTags(contextCode, itemFullName, tagCodes) {
    try {
      // Проверяем существование AI Item
      const aiItem = await this.pgClient.query(`
        SELECT full_name FROM public.ai_item
        WHERE full_name = $1 AND context_code = $2
      `, [itemFullName, contextCode]);

      if (aiItem.rows.length === 0) {
        const error = new Error(`AI Item not found: ${itemFullName}`);
        error.code = 'AI_ITEM_NOT_FOUND';
        throw error;
      }

      // Удаляем все текущие связи
      await this.pgClient.query(`
        DELETE FROM public.ai_item_tag
        WHERE ai_item_full_name = $1 AND ai_item_context_code = $2
      `, [itemFullName, contextCode]);

      // Если массив пуст — просто возвращаем пустой список
      if (tagCodes.length === 0) {
        return [];
      }

      // Получаем id тегов по кодам
      const tagsResult = await this.pgClient.query(`
        SELECT id, code FROM public.tag
        WHERE context_code = $1 AND code = ANY($2)
      `, [contextCode, tagCodes]);

      const foundCodes = tagsResult.rows.map(r => r.code);
      const notFoundCodes = tagCodes.filter(c => !foundCodes.includes(c));

      if (notFoundCodes.length > 0) {
        const error = new Error(`Tags not found: ${notFoundCodes.join(', ')}`);
        error.code = 'TAGS_NOT_FOUND';
        error.notFoundCodes = notFoundCodes;
        throw error;
      }

      // Добавляем новые связи
      for (const tag of tagsResult.rows) {
        await this.pgClient.query(`
          INSERT INTO public.ai_item_tag (ai_item_full_name, ai_item_context_code, tag_id)
          VALUES ($1, $2, $3)
        `, [itemFullName, contextCode, tag.id]);
      }

      return await this.getAiItemTags(contextCode, itemFullName);
    } catch (error) {
      if (error.code === 'AI_ITEM_NOT_FOUND' || error.code === 'TAGS_NOT_FOUND') throw error;
      console.error(`[DB] ❌ Ошибка syncAiItemTags("${contextCode}", "${itemFullName}"):`, error);
      throw error;
    }
  }

  /**
   * Проверить существование AI Item
   * @param {string} contextCode - Контекстный код
   * @param {string} itemFullName - full_name AI Item
   * @returns {Promise<boolean>} true если существует
   */
  async aiItemExists(contextCode, itemFullName) {
    try {
      const result = await this.pgClient.query(`
        SELECT 1 FROM public.ai_item
        WHERE full_name = $1 AND context_code = $2
        LIMIT 1
      `, [itemFullName, contextCode]);

      return result.rows.length > 0;
    } catch (error) {
      console.error(`[DB] ❌ Ошибка aiItemExists("${contextCode}", "${itemFullName}"):`, error);
      throw error;
    }
  }

  /**
   * Массовое добавление тегов к множеству AI Items
   * @param {string} contextCode - Контекстный код
   * @param {Array<string>} itemIds - Массив full_name AI Items
   * @param {Array<string>} tagCodes - Массив кодов тегов
   * @returns {Promise<{processedItems: number, failedItems: Array}>}
   */
  async bulkAddTags(contextCode, itemIds, tagCodes) {
    try {
      // Получаем все теги по кодам
      const tagsResult = await this.pgClient.query(`
        SELECT id, code FROM public.tag
        WHERE context_code = $1 AND code = ANY($2)
      `, [contextCode, tagCodes]);

      const tagMap = new Map(tagsResult.rows.map(t => [t.code, t.id]));
      
      // Проверяем, что все теги существуют
      const missingTags = tagCodes.filter(code => !tagMap.has(code));
      if (missingTags.length > 0) {
        const error = new Error(`Tags not found: ${missingTags.join(', ')}`);
        error.code = 'TAGS_NOT_FOUND';
        error.missingTags = missingTags;
        throw error;
      }

      // Получаем все существующие AI Items
      const itemsResult = await this.pgClient.query(`
        SELECT full_name FROM public.ai_item
        WHERE context_code = $1 AND full_name = ANY($2)
      `, [contextCode, itemIds]);

      const existingItems = new Set(itemsResult.rows.map(r => r.full_name));
      
      let processedItems = 0;
      const failedItems = [];

      for (const itemId of itemIds) {
        if (!existingItems.has(itemId)) {
          failedItems.push({ itemId, error: 'Item not found' });
          continue;
        }

        try {
          // Добавляем все теги для этого item (ON CONFLICT DO NOTHING для idempotency)
          for (const tagCode of tagCodes) {
            const tagId = tagMap.get(tagCode);
            await this.pgClient.query(`
              INSERT INTO public.ai_item_tag (ai_item_full_name, ai_item_context_code, tag_id)
              VALUES ($1, $2, $3)
              ON CONFLICT DO NOTHING
            `, [itemId, contextCode, tagId]);
          }
          processedItems++;
        } catch (err) {
          failedItems.push({ itemId, error: err.message });
        }
      }

      return { processedItems, failedItems };
    } catch (error) {
      if (error.code === 'TAGS_NOT_FOUND') throw error;
      console.error(`[DB] ❌ Ошибка bulkAddTags:`, error);
      throw error;
    }
  }

  /**
   * Массовое удаление тегов у множества AI Items
   * @param {string} contextCode - Контекстный код
   * @param {Array<string>} itemIds - Массив full_name AI Items
   * @param {Array<string>} tagCodes - Массив кодов тегов
   * @returns {Promise<{processedItems: number, failedItems: Array}>}
   */
  async bulkRemoveTags(contextCode, itemIds, tagCodes) {
    try {
      // Получаем id тегов по кодам
      const tagsResult = await this.pgClient.query(`
        SELECT id, code FROM public.tag
        WHERE context_code = $1 AND code = ANY($2)
      `, [contextCode, tagCodes]);

      const tagIds = tagsResult.rows.map(t => t.id);
      
      // Если теги не найдены — просто ничего не удаляем (idempotent)
      if (tagIds.length === 0) {
        return { processedItems: itemIds.length, failedItems: [] };
      }

      let processedItems = 0;
      const failedItems = [];

      for (const itemId of itemIds) {
        try {
          await this.pgClient.query(`
            DELETE FROM public.ai_item_tag
            WHERE ai_item_full_name = $1 
              AND ai_item_context_code = $2 
              AND tag_id = ANY($3)
          `, [itemId, contextCode, tagIds]);
          processedItems++;
        } catch (err) {
          failedItems.push({ itemId, error: err.message });
        }
      }

      return { processedItems, failedItems };
    } catch (error) {
      console.error(`[DB] ❌ Ошибка bulkRemoveTags:`, error);
      throw error;
    }
  }

  /**
   * Поиск ai_item по короткому имени таблицы (без схемы)
   * @param {string} tableName - Короткое имя таблицы (например, 'label')
   * @param {string} contextCode - Код контекста
   * @returns {Promise<Object|null>} ai_item или null если не найдено
   */
  async findAiItemByName(tableName, contextCode) {
    try {
      // Ищем таблицу по короткому имени (s_name) или по полному имени, заканчивающемуся на .tableName
      const result = await this.pgClient.query(
        `SELECT * FROM public.ai_item 
         WHERE context_code = $1 
           AND type = 'table' 
           AND (s_name = $2 OR full_name LIKE $3 OR full_name = $2)
         ORDER BY 
           CASE WHEN s_name = $2 THEN 1 ELSE 2 END,
           CASE WHEN full_name = $2 THEN 1 ELSE 2 END
         LIMIT 1`,
        [contextCode, tableName, `%.${tableName}`]
      );

      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      console.error(`[DB] ❌ Ошибка findAiItemByName для ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Получение метаданных колонки из чанка таблицы
   * @param {string} tableFullName - Полное имя таблицы (например, 'carl_data.label')
   * @param {string} columnName - Имя колонки
   * @param {string} contextCode - Код контекста
   * @returns {Promise<Object|null>} Объект с data_type, is_nullable, column_default или null
   */
  async getColumnMetadataFromTable(tableFullName, columnName, contextCode) {
    try {
      // Находим ai_item таблицы
      const tableItemResult = await this.pgClient.query(
        `SELECT id FROM public.ai_item 
         WHERE full_name = $1 AND context_code = $2 AND type = 'table'`,
        [tableFullName, contextCode]
      );

      if (tableItemResult.rows.length === 0) {
        return null;
      }

      const tableAiItemId = tableItemResult.rows[0].id;

      // Находим чанк L0 для этой таблицы
      const chunkResult = await this.pgClient.query(
        `SELECT chunk_content FROM public.chunk_vector 
         WHERE ai_item_id = $1 AND level = '0-исходник' 
         ORDER BY created_at DESC LIMIT 1`,
        [tableAiItemId]
      );

      if (chunkResult.rows.length === 0) {
        return null;
      }

      const chunkContent = chunkResult.rows[0].chunk_content;
      
      // Парсим JSON из chunk_content
      let contentData;
      if (typeof chunkContent === 'string') {
        contentData = JSON.parse(chunkContent);
      } else {
        contentData = chunkContent;
      }

      // Если есть поле text, берём его
      const textData = contentData.text || contentData;

      // Ищем колонку в массиве columns
      if (textData.columns && Array.isArray(textData.columns)) {
        const column = textData.columns.find(col => 
          col.column_name && col.column_name.toLowerCase() === columnName.toLowerCase()
        );

        if (column) {
          return {
            data_type: column.data_type || null,
            is_nullable: column.is_nullable === 'YES' || column.is_nullable === true,
            column_default: column.column_default || null
          };
        }
      }

      return null;
    } catch (error) {
      console.error(`[DB] ❌ Ошибка getColumnMetadataFromTable для ${tableFullName}.${columnName}:`, error);
      throw error;
    }
  }

  /**
   * Получение тела функции (L0 чанк) по ai_item_id
   * @param {number} aiItemId - ID ai_item функции
   * @returns {Promise<string|null>} Тело функции или null
   */
  async getFunctionBodyByAiItemId(aiItemId) {
    try {
      const result = await this.pgClient.query(
        `SELECT cv.chunk_content 
         FROM public.chunk_vector cv
         WHERE cv.ai_item_id = $1 AND cv.level = '0-исходник'
         ORDER BY cv.created_at DESC LIMIT 1`,
        [aiItemId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const chunkContent = result.rows[0].chunk_content;
      
      // Парсим JSON из chunk_content
      let contentData;
      if (typeof chunkContent === 'string') {
        contentData = JSON.parse(chunkContent);
      } else {
        contentData = chunkContent;
      }

      // Если есть поле text, берём его
      const textData = contentData.text || contentData;

      // Возвращаем body из структуры функции
      if (textData.body) {
        return textData.body;
      }

      return null;
    } catch (error) {
      console.error(`[DB] ❌ Ошибка getFunctionBodyByAiItemId для ai_item_id ${aiItemId}:`, error);
      throw error;
    }
  }

  // === Методы для инкрементального обновления ===

  /**
   * Получение метаданных файла для инкрементальной проверки
   * @param {string} filename - Имя файла
   * @param {string} contextCode - Код контекста
   * @returns {Promise<{id: number, modified_at: string, file_hash: string}|null>}
   */
  async getFileMetaForIncrCheck(filename, contextCode) {
    try {
      const result = await this.pgClient.query(
        'SELECT id, modified_at, file_hash FROM public.files WHERE filename = $1 AND context_code = $2',
        [filename, contextCode]
      );
      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      console.error(`[DB] Ошибка getFileMetaForIncrCheck для ${filename}:`, error);
      throw error;
    }
  }

  /**
   * Обновление modified_at файла (при skip-by-hash)
   * @param {number} fileId - ID файла
   * @param {Date} mtime - Новое время модификации
   */
  async updateFileModifiedAt(fileId, mtime) {
    try {
      await this.pgClient.query(
        'UPDATE public.files SET modified_at = $1 WHERE id = $2',
        [mtime, fileId]
      );
    } catch (error) {
      console.error(`[DB] Ошибка updateFileModifiedAt для fileId ${fileId}:`, error);
      throw error;
    }
  }

  /**
   * Получение всех ai_item для файла (для инкрементального сравнения)
   * @param {number} fileId - ID файла
   * @param {string} contextCode - Код контекста
   * @returns {Promise<Array<{id: number, full_name: string, content_hash: string, file_id: number}>>}
   */
  async getAiItemsByFileId(fileId, contextCode) {
    try {
      const result = await this.pgClient.query(
        'SELECT id, full_name, content_hash, file_id FROM public.ai_item WHERE file_id = $1 AND context_code = $2',
        [fileId, contextCode]
      );
      return result.rows;
    } catch (error) {
      console.error(`[DB] Ошибка getAiItemsByFileId для fileId ${fileId}:`, error);
      throw error;
    }
  }

  /**
   * Пометить ai_item как требующие перестройки (needs_rebuild = true)
   * @param {string[]} fullNames - Список full_name для маркировки
   * @param {string} contextCode - Код контекста
   */
  async markNeedsRebuild(fullNames, contextCode) {
    try {
      if (!fullNames || fullNames.length === 0) return;
      await this.pgClient.query(
        'UPDATE public.ai_item SET needs_rebuild = true WHERE full_name = ANY($1::text[]) AND context_code = $2',
        [fullNames, contextCode]
      );
    } catch (error) {
      console.error(`[DB] Ошибка markNeedsRebuild:`, error);
      throw error;
    }
  }

  /**
   * Сброс флага needs_rebuild для конкретного ai_item
   * @param {number} aiItemId - ID ai_item
   */
  async clearNeedsRebuild(aiItemId) {
    try {
      await this.pgClient.query(
        'UPDATE public.ai_item SET needs_rebuild = false WHERE id = $1',
        [aiItemId]
      );
    } catch (error) {
      console.error(`[DB] Ошибка clearNeedsRebuild для aiItemId ${aiItemId}:`, error);
      throw error;
    }
  }

  /**
   * Каскадное удаление ai_item: link -> chunk_vector -> ai_item
   * @param {number} aiItemId - ID ai_item
   * @param {string} fullName - full_name сущности
   * @param {string} contextCode - Код контекста
   */
  async deleteAiItemCascade(aiItemId, fullName, contextCode) {
    try {
      // 1. Удалить link'и где source = fullName
      await this.pgClient.query(
        'DELETE FROM public.link WHERE context_code = $1 AND source = $2',
        [contextCode, fullName]
      );
      // 2. Удалить все чанки (L0, L1, 2-logic, все)
      await this.pgClient.query(
        'DELETE FROM public.chunk_vector WHERE ai_item_id = $1',
        [aiItemId]
      );
      // 3. Удалить сам ai_item
      await this.pgClient.query(
        'DELETE FROM public.ai_item WHERE id = $1',
        [aiItemId]
      );
    } catch (error) {
      console.error(`[DB] Ошибка deleteAiItemCascade для aiItemId ${aiItemId} (${fullName}):`, error);
      throw error;
    }
  }

  /**
   * Получение обратных соседей (кто ссылается на fullName через link.target)
   * @param {string} fullName - full_name целевой сущности
   * @param {string} contextCode - Код контекста
   * @returns {Promise<string[]>} Список source full_name
   */
  async getReverseLinkedItems(fullName, contextCode) {
    try {
      const result = await this.pgClient.query(
        'SELECT DISTINCT source FROM public.link WHERE target = $1 AND context_code = $2',
        [fullName, contextCode]
      );
      return result.rows.map(r => r.source);
    } catch (error) {
      console.error(`[DB] Ошибка getReverseLinkedItems для ${fullName}:`, error);
      throw error;
    }
  }

  /**
   * Удаление всех чанков для ai_item
   * @param {number} aiItemId - ID ai_item
   */
  async deleteChunksByAiItemId(aiItemId) {
    try {
      await this.pgClient.query(
        'DELETE FROM public.chunk_vector WHERE ai_item_id = $1',
        [aiItemId]
      );
    } catch (error) {
      console.error(`[DB] Ошибка deleteChunksByAiItemId для aiItemId ${aiItemId}:`, error);
      throw error;
    }
  }

  /**
   * Удаление всех link'ов где source = fullName
   * @param {string} fullName - full_name источника
   * @param {string} contextCode - Код контекста
   */
  async deleteLinksBySource(fullName, contextCode) {
    try {
      await this.pgClient.query(
        'DELETE FROM public.link WHERE context_code = $1 AND source = $2',
        [contextCode, fullName]
      );
    } catch (error) {
      console.error(`[DB] Ошибка deleteLinksBySource для ${fullName}:`, error);
      throw error;
    }
  }

  /**
   * Получение текущего file_id для ai_item (перечитывание перед удалением)
   * @param {number} aiItemId - ID ai_item
   * @returns {Promise<number|null>} file_id или null
   */
  async getAiItemFileId(aiItemId) {
    try {
      const result = await this.pgClient.query(
        'SELECT file_id FROM public.ai_item WHERE id = $1',
        [aiItemId]
      );
      return result.rows.length > 0 ? result.rows[0].file_id : null;
    } catch (error) {
      console.error(`[DB] Ошибка getAiItemFileId для aiItemId ${aiItemId}:`, error);
      throw error;
    }
  }

}

module.exports = DbService; 