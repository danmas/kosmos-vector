// VectorRepository.js - Репозиторий для работы с таблицей public.chunk_vector
// Отвечает за векторный поиск (pgvector), сохранение/получение чанков

/**
 * @typedef {Object} ChunkRecord
 * @property {number} id
 * @property {number} file_id
 * @property {number|null} ai_item_id
 * @property {number|null} parent_chunk_id
 * @property {Object} chunk_content - JSONB содержимое
 * @property {string|null} embedding - Вектор эмбеддинга
 * @property {number|null} chunk_index
 * @property {string} type
 * @property {string} level
 * @property {string|null} s_name
 * @property {string|null} h_name
 * @property {string|null} full_name
 * @property {Date} created_at
 */

/**
 * @typedef {Object} SimilaritySearchOptions
 * @property {number} [limit=5] - Максимальное количество результатов
 * @property {string} [contextCode] - Фильтр по контексту
 * @property {string} [chunkType] - Фильтр по типу чанка
 * @property {string} [chunkLevel] - Фильтр по уровню чанка
 * @property {string[]} [typeCodes] - Фильтр по типам AI Item
 * @property {string[]} [tagCodes] - Фильтр по тегам AI Item
 */

/**
 * @typedef {Object} SimilarityResult
 * @property {number} id
 * @property {string} content
 * @property {number} similarity
 * @property {Object} metadata
 */

/**
 * @typedef {Object} SaveChunkParams
 * @property {number} fileId
 * @property {Object} chunkContent - JSON объект для chunk_content
 * @property {number[]|null} [embedding=null]
 * @property {string} [type='текст']
 * @property {string} [level='0-исходник']
 * @property {string|null} [sName=null]
 * @property {string|null} [fullName=null]
 * @property {string|null} [hName=null]
 * @property {number|null} [parentChunkId=null]
 * @property {number|null} [aiItemId=null]
 */

/**
 * Репозиторий для работы с векторами и чанками
 */
class VectorRepository {
  /**
   * @param {import('../Database')} db - Экземпляр Database
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Поиск похожих чанков по вектору запроса (similarity search)
   * @param {number[]} queryEmbedding - Вектор запроса
   * @param {SimilaritySearchOptions} [options={}]
   * @returns {Promise<SimilarityResult[]>}
   */
  async similaritySearch(queryEmbedding, options = {}) {
    const {
      limit = 5,
      contextCode = null,
      chunkType = null,
      chunkLevel = null,
      typeCodes = [],
      tagCodes = []
    } = options;

    // Форматируем вектор для PostgreSQL
    const vectorString = `[${queryEmbedding.join(',')}]`;

    // Определяем, нужен ли JOIN с ai_item
    const hasItemFilter = (Array.isArray(typeCodes) && typeCodes.length > 0) ||
      (Array.isArray(tagCodes) && tagCodes.length > 0);

    // Построение запроса с динамическими фильтрами
    const params = [vectorString];
    let paramIndex = 2;

    let sql = `
      SELECT fv.id, 
             COALESCE(fv.chunk_content->>'text', fv.chunk_content::text) as content, 
             1 - (fv.embedding <=> $1) as similarity,
             f.filename,
             f.context_code,
             fv.type,
             fv.level
      FROM public.chunk_vector fv
      JOIN public.files f ON fv.file_id = f.id
    `;

    if (hasItemFilter) {
      sql += `\n      JOIN public.ai_item ai ON fv.ai_item_id = ai.id`;
    }

    sql += `\n      WHERE 1=1`;

    // Фильтр по контекстному коду
    if (contextCode) {
      sql += ` AND f.context_code = $${paramIndex++}`;
      params.push(contextCode);
    }

    // Фильтр по типу чанка
    if (chunkType) {
      sql += ` AND fv.type = $${paramIndex++}`;
      params.push(chunkType);
    }

    // Фильтр по уровню чанка
    if (chunkLevel) {
      sql += ` AND fv.level = $${paramIndex++}`;
      params.push(chunkLevel);
    }

    // Фильтр по типам AI Item
    if (Array.isArray(typeCodes) && typeCodes.length > 0) {
      sql += ` AND ai.type = ANY($${paramIndex++})`;
      params.push(typeCodes);
    }

    // Фильтр по тегам AI Item
    if (Array.isArray(tagCodes) && tagCodes.length > 0) {
      sql += ` AND EXISTS (
        SELECT 1
        FROM public.ai_item_tag ait
        JOIN public.tag t ON ait.tag_id = t.id
        WHERE ait.ai_item_full_name = ai.full_name
          AND ait.ai_item_context_code = ai.context_code
          AND t.code = ANY($${paramIndex++})
      )`;
      params.push(tagCodes);
    }

    // Сортировка и лимит
    sql += `
      ORDER BY similarity DESC
      LIMIT $${paramIndex}
    `;
    params.push(limit);

    const rows = await this.db.queryAll(sql, params);

    // Преобразование результатов
    return rows.map(row => ({
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
  }

  /**
   * Сохранение чанка (upsert по file_id + full_name + level или chunk_content)
   * @param {SaveChunkParams} params
   * @returns {Promise<{id: number, isNew: boolean}>}
   */
  async saveChunk(params) {
    const {
      fileId,
      chunkContent,
      embedding = null,
      type = 'текст',
      level = '0-исходник',
      sName = null,
      fullName = null,
      hName = null,
      parentChunkId = null,
      aiItemId = null
    } = params;

    // Форматируем вектор
    let vectorString = null;
    if (embedding && Array.isArray(embedding) && embedding.length > 0) {
      vectorString = `[${embedding.join(',')}]`;
    }

    // Поиск существующего чанка
    let existing = null;
    if (fullName) {
      existing = await this.db.queryOne(
        `SELECT id, ai_item_id FROM public.chunk_vector
         WHERE file_id = $1 AND full_name = $2 AND level = $3`,
        [fileId, fullName, level]
      );
    } else {
      // Fallback: поиск по chunk_content
      existing = await this.db.queryOne(
        `SELECT id, ai_item_id FROM public.chunk_vector
         WHERE file_id = $1 AND chunk_content::text = $2::text 
         AND (full_name IS NULL OR full_name = '') AND level = $3`,
        [fileId, JSON.stringify(chunkContent), level]
      );
    }

    if (!existing) {
      // INSERT
      const result = await this.db.queryOne(
        `INSERT INTO public.chunk_vector 
           (file_id, chunk_content, embedding, type, level, s_name, full_name, h_name, parent_chunk_id, ai_item_id)
         VALUES 
           ($1, (($2)::json->'text')::jsonb, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [fileId, chunkContent, vectorString, type, level, sName, fullName, hName, parentChunkId, aiItemId]
      );
      return { id: result.id, isNew: true };
    } else {
      // UPDATE
      await this.db.query(
        `UPDATE public.chunk_vector
         SET chunk_content = (($1)::json->'text')::jsonb,
             embedding = $2,
             type = $3,
             level = $4,
             s_name = $5,
             full_name = $6,
             h_name = $7,
             parent_chunk_id = $8,
             ai_item_id = COALESCE($9, ai_item_id)
         WHERE id = $10`,
        [JSON.stringify(chunkContent), vectorString, type, level, sName, fullName, hName, parentChunkId, aiItemId, existing.id]
      );
      return { id: existing.id, isNew: false };
    }
  }

  /**
   * Получение чанка по ID
   * @param {number|string} chunkId
   * @returns {Promise<ChunkRecord|null>}
   */
  async getById(chunkId) {
    return this.db.queryOne(
      `SELECT fv.*, 
              COALESCE(fv.chunk_content->>'text', fv.chunk_content::text) as content_text,
              f.filename, f.context_code
       FROM public.chunk_vector fv
       JOIN public.files f ON fv.file_id = f.id
       WHERE fv.id = $1`,
      [chunkId]
    );
  }

  /**
   * Получение чанков файла
   * @param {number} fileId
   * @param {string} [level] - Фильтр по уровню
   * @returns {Promise<ChunkRecord[]>}
   */
  async getByFileId(fileId, level = null) {
    let sql = `
      SELECT id, 
             COALESCE(chunk_content->>'text', chunk_content::text) as content, 
             chunk_index, type, level, s_name, h_name, full_name, ai_item_id
      FROM public.chunk_vector
      WHERE file_id = $1
    `;
    const params = [fileId];

    if (level) {
      sql += ' AND level = $2';
      params.push(level);
    }

    sql += ' ORDER BY chunk_index';

    return this.db.queryAll(sql, params);
  }

  /**
   * Получение дочерних чанков
   * @param {number} parentChunkId
   * @param {string} [level]
   * @returns {Promise<ChunkRecord[]>}
   */
  async getChildren(parentChunkId, level = null) {
    let sql = `
      SELECT id, 
             COALESCE(chunk_content->>'text', chunk_content::text) as content, 
             chunk_index, type, level, s_name, h_name, full_name, ai_item_id
      FROM public.chunk_vector
      WHERE parent_chunk_id = $1
    `;
    const params = [parentChunkId];

    if (level) {
      sql += ' AND level = $2';
      params.push(level);
    }

    sql += ' ORDER BY chunk_index';

    return this.db.queryAll(sql, params);
  }

  /**
   * Обновление метаданных чанка
   * @param {number} chunkId
   * @param {Object} metadata - { type, level, sName, hName, fullName }
   * @returns {Promise<ChunkRecord|null>}
   */
  async updateMetadata(chunkId, metadata) {
    const { type, level, sName, hName, fullName } = metadata;

    const updateParts = [];
    const params = [chunkId];
    let paramIndex = 2;

    if (type !== undefined) {
      updateParts.push(`type = $${paramIndex++}`);
      params.push(type);
    }
    if (level !== undefined) {
      updateParts.push(`level = $${paramIndex++}`);
      params.push(level);
    }
    if (sName !== undefined) {
      updateParts.push(`s_name = $${paramIndex++}`);
      params.push(sName);
    }
    if (hName !== undefined) {
      updateParts.push(`h_name = $${paramIndex++}`);
      params.push(hName);
    }
    if (fullName !== undefined) {
      updateParts.push(`full_name = $${paramIndex++}`);
      params.push(fullName);
    }

    if (updateParts.length === 0) {
      return this.getById(chunkId);
    }

    return this.db.queryOne(
      `UPDATE public.chunk_vector
       SET ${updateParts.join(', ')}
       WHERE id = $1
       RETURNING *`,
      params
    );
  }

  /**
   * Привязка чанка к AI Item
   * @param {number} chunkId
   * @param {number} aiItemId
   * @returns {Promise<boolean>}
   */
  async linkToAiItem(chunkId, aiItemId) {
    const result = await this.db.query(
      `UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2`,
      [aiItemId, chunkId]
    );
    return result.rowCount > 0;
  }

  /**
   * Удаление чанков по файлу
   * @param {number} fileId
   * @returns {Promise<number>} - Количество удаленных чанков
   */
  async deleteByFileId(fileId) {
    const result = await this.db.query(
      `DELETE FROM public.chunk_vector WHERE file_id = $1`,
      [fileId]
    );
    return result.rowCount;
  }

  /**
   * Удаление дочерних чанков
   * @param {number} parentChunkId
   * @param {string} [level]
   * @returns {Promise<number>}
   */
  async deleteChildren(parentChunkId, level = null) {
    let sql = 'DELETE FROM public.chunk_vector WHERE parent_chunk_id = $1';
    const params = [parentChunkId];

    if (level) {
      sql += ' AND level = $2';
      params.push(level);
    }

    const result = await this.db.query(sql, params);
    return result.rowCount;
  }

  /**
   * Удаление чанка по ID
   * @param {number} chunkId
   * @returns {Promise<boolean>}
   */
  async delete(chunkId) {
    const result = await this.db.query(
      `DELETE FROM public.chunk_vector WHERE id = $1`,
      [chunkId]
    );
    return result.rowCount > 0;
  }

  /**
   * Подсчет чанков в файле
   * @param {number} fileId
   * @param {string} [level]
   * @returns {Promise<number>}
   */
  async countByFileId(fileId, level = null) {
    let sql = 'SELECT COUNT(*) as count FROM public.chunk_vector WHERE file_id = $1';
    const params = [fileId];

    if (level) {
      sql += ' AND level = $2';
      params.push(level);
    }

    const result = await this.db.queryOne(sql, params);
    return parseInt(result.count);
  }

  /**
   * Получение ID ai_items, связанных с файлом
   * @param {number} fileId
   * @param {string} [level='0-исходник']
   * @returns {Promise<number[]>}
   */
  async getAiItemIdsByFileId(fileId, level = '0-исходник') {
    const rows = await this.db.queryAll(
      `SELECT DISTINCT ai_item_id 
       FROM public.chunk_vector 
       WHERE file_id = $1 AND level = $2 AND ai_item_id IS NOT NULL`,
      [fileId, level]
    );
    return rows.map(row => row.ai_item_id);
  }
}

module.exports = VectorRepository;
