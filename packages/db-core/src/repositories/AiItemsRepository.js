// AiItemsRepository.js - Репозиторий для работы с ai_item, ai_comment и тегами
// Отвечает за SQL-операции с AI элементами и связанными данными

/**
 * @typedef {Object} AiItemRecord
 * @property {number} id
 * @property {string} full_name
 * @property {string} context_code
 * @property {number|null} file_id
 * @property {string|null} type
 * @property {string|null} s_name
 * @property {string|null} h_name
 * @property {string|null} content_hash
 * @property {boolean} needs_rebuild
 * @property {Date} created_at
 * @property {Date} updated_at
 */

/**
 * @typedef {Object} AiCommentRecord
 * @property {number} id
 * @property {string} context_code
 * @property {string} full_name
 * @property {string} comment
 * @property {Date} created_at
 * @property {Date} updated_at
 */

/**
 * @typedef {Object} TagRecord
 * @property {number} id
 * @property {string} context_code
 * @property {string} code
 * @property {string} name
 * @property {string|null} description
 * @property {Date} created_at
 * @property {Date} updated_at
 */

/**
 * Репозиторий для работы с AI Items, комментариями и тегами
 */
class AiItemsRepository {
  /**
   * @param {import('../Database')} db - Экземпляр Database
   */
  constructor(db) {
    this.db = db;
  }

  // ==================== AI Items ====================

  /**
   * Создание или обновление AI Item (upsert по full_name + context_code)
   * @param {Object} params
   * @returns {Promise<{id: number, isNew: boolean}>}
   */
  async upsert(params) {
    const {
      fullName,
      contextCode = 'DEFAULT',
      fileId = null,
      type = null,
      sName = null,
      hName = null,
      contentHash = null
    } = params;

    const existing = await this.db.queryOne(
      `SELECT id FROM kosmos.ai_item WHERE full_name = $1 AND context_code = $2`,
      [fullName, contextCode]
    );

    if (!existing) {
      const result = await this.db.queryOne(
        `INSERT INTO kosmos.ai_item (full_name, context_code, file_id, type, s_name, h_name, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [fullName, contextCode, fileId, type, sName, hName, contentHash]
      );
      return { id: result.id, isNew: true };
    } else {
      await this.db.query(
        `UPDATE kosmos.ai_item
         SET file_id = COALESCE($1, file_id),
             type = COALESCE($2, type),
             s_name = COALESCE($3, s_name),
             h_name = COALESCE($4, h_name),
             content_hash = COALESCE($5, content_hash),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $6`,
        [fileId, type, sName, hName, contentHash, existing.id]
      );
      return { id: existing.id, isNew: false };
    }
  }

  /**
   * Получение AI Item по ID
   * @param {number} itemId
   * @returns {Promise<AiItemRecord|null>}
   */
  async getById(itemId) {
    return this.db.queryOne(
      `SELECT * FROM kosmos.ai_item WHERE id = $1`,
      [itemId]
    );
  }

  /**
   * Получение AI Item по full_name и context_code
   * @param {string} fullName
   * @param {string} contextCode
   * @returns {Promise<AiItemRecord|null>}
   */
  async getByFullName(fullName, contextCode) {
    return this.db.queryOne(
      `SELECT * FROM kosmos.ai_item WHERE full_name = $1 AND context_code = $2`,
      [fullName, contextCode]
    );
  }

  /**
   * Получение всех AI Items для контекста
   * @param {string} [contextCode]
   * @returns {Promise<AiItemRecord[]>}
   */
  async getAll(contextCode = null) {
    if (contextCode) {
      return this.db.queryAll(
        `SELECT * FROM kosmos.ai_item WHERE context_code = $1 ORDER BY full_name`,
        [contextCode]
      );
    }
    return this.db.queryAll(`SELECT * FROM kosmos.ai_item ORDER BY full_name`);
  }

  /**
   * Получение AI Items по списку full_names
   * @param {string[]} fullNames
   * @param {string} contextCode
   * @returns {Promise<Array<{id: number, full_name: string}>>}
   */
  async getByFullNames(fullNames, contextCode) {
    if (!Array.isArray(fullNames) || fullNames.length === 0) {
      return [];
    }
    return this.db.queryAll(
      `SELECT id, full_name FROM kosmos.ai_item 
       WHERE full_name = ANY($1::text[]) AND context_code = $2`,
      [fullNames, contextCode]
    );
  }

  /**
   * Обновление context_code для AI Item
   * @param {number} itemId
   * @param {string} newContextCode
   * @returns {Promise<AiItemRecord|null>}
   */
  async updateContextCode(itemId, newContextCode) {
    return this.db.queryOne(
      `UPDATE kosmos.ai_item 
       SET context_code = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2
       RETURNING *`,
      [newContextCode, itemId]
    );
  }

  /**
   * Пометить AI Item как нуждающийся в перестроении
   * @param {number} itemId
   * @param {boolean} needsRebuild
   * @returns {Promise<boolean>}
   */
  async setNeedsRebuild(itemId, needsRebuild = true) {
    const result = await this.db.query(
      `UPDATE kosmos.ai_item SET needs_rebuild = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [needsRebuild, itemId]
    );
    return result.rowCount > 0;
  }

  /**
   * Удаление AI Item
   * @param {number} itemId
   * @returns {Promise<boolean>}
   */
  async delete(itemId) {
    const result = await this.db.query(
      `DELETE FROM kosmos.ai_item WHERE id = $1`,
      [itemId]
    );
    return result.rowCount > 0;
  }

  /**
   * Удаление AI Items по контексту
   * @param {string} contextCode
   * @returns {Promise<number>}
   */
  async deleteByContext(contextCode) {
    const result = await this.db.query(
      `DELETE FROM kosmos.ai_item WHERE context_code = $1`,
      [contextCode]
    );
    return result.rowCount;
  }

  /**
   * Очистка "осиротевших" AI Items (без ссылок из чанков уровня 0)
   * @param {string} [contextCode]
   * @returns {Promise<Array<{id: number, full_name: string}>>}
   */
  async cleanupOrphaned(contextCode = null) {
    let sql;
    const params = [];

    if (contextCode) {
      sql = `
        DELETE FROM kosmos.ai_item
        WHERE context_code = $1
          AND id NOT IN (
            SELECT DISTINCT fv.ai_item_id 
            FROM kosmos.chunk_vector fv
            JOIN kosmos.files f ON fv.file_id = f.id
            WHERE fv.ai_item_id IS NOT NULL 
              AND fv.level = '0-исходник'
              AND f.context_code = $1
          )
        RETURNING id, full_name
      `;
      params.push(contextCode);
    } else {
      sql = `
        DELETE FROM kosmos.ai_item
        WHERE id NOT IN (
          SELECT DISTINCT ai_item_id 
          FROM kosmos.chunk_vector 
          WHERE ai_item_id IS NOT NULL AND level = '0-исходник'
        )
        RETURNING id, full_name
      `;
    }

    return this.db.queryAll(sql, params);
  }

  // ==================== AI Comments ====================

  /**
   * Получение комментария для AI Item
   * @param {string} contextCode
   * @param {string} fullName
   * @returns {Promise<AiCommentRecord|null>}
   */
  async getComment(contextCode, fullName) {
    return this.db.queryOne(
      `SELECT * FROM kosmos.ai_comment WHERE context_code = $1 AND full_name = $2`,
      [contextCode, fullName]
    );
  }

  /**
   * Создание комментария (если не существует)
   * @param {string} contextCode
   * @param {string} fullName
   * @param {string} comment
   * @returns {Promise<{id: number, isNew: boolean}|null>}
   */
  async createCommentIfNotExists(contextCode, fullName, comment) {
    const result = await this.db.queryOne(
      `INSERT INTO kosmos.ai_comment (context_code, full_name, comment)
       VALUES ($1, $2, $3)
       ON CONFLICT (context_code, full_name) DO NOTHING
       RETURNING id`,
      [contextCode, fullName, comment]
    );

    if (result) {
      return { id: result.id, isNew: true };
    }
    return null; // Already exists
  }

  /**
   * Создание или обновление комментария (upsert)
   * @param {string} contextCode
   * @param {string} fullName
   * @param {string} comment
   * @returns {Promise<AiCommentRecord>}
   */
  async upsertComment(contextCode, fullName, comment) {
    return this.db.queryOne(
      `INSERT INTO kosmos.ai_comment (context_code, full_name, comment)
       VALUES ($1, $2, $3)
       ON CONFLICT (context_code, full_name) 
       DO UPDATE SET comment = EXCLUDED.comment, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [contextCode, fullName, comment]
    );
  }

  /**
   * Обновление комментария
   * @param {string} contextCode
   * @param {string} fullName
   * @param {string} comment
   * @returns {Promise<AiCommentRecord|null>}
   */
  async updateComment(contextCode, fullName, comment) {
    return this.db.queryOne(
      `UPDATE kosmos.ai_comment
       SET comment = $3, updated_at = CURRENT_TIMESTAMP
       WHERE context_code = $1 AND full_name = $2
       RETURNING *`,
      [contextCode, fullName, comment]
    );
  }

  /**
   * Удаление комментария
   * @param {string} contextCode
   * @param {string} fullName
   * @returns {Promise<boolean>}
   */
  async deleteComment(contextCode, fullName) {
    const result = await this.db.query(
      `DELETE FROM kosmos.ai_comment WHERE context_code = $1 AND full_name = $2`,
      [contextCode, fullName]
    );
    return result.rowCount > 0;
  }

  /**
   * Удаление всех комментариев для контекста
   * @param {string} contextCode
   * @returns {Promise<number>}
   */
  async deleteCommentsByContext(contextCode) {
    const result = await this.db.query(
      `DELETE FROM kosmos.ai_comment WHERE context_code = $1`,
      [contextCode]
    );
    return result.rowCount;
  }

  // ==================== Tags ====================

  /**
   * Получение всех тегов для контекста
   * @param {string} contextCode
   * @returns {Promise<TagRecord[]>}
   */
  async getAllTags(contextCode) {
    return this.db.queryAll(
      `SELECT * FROM kosmos.tag WHERE context_code = $1 ORDER BY name`,
      [contextCode]
    );
  }

  /**
   * Получение тега по коду
   * @param {string} contextCode
   * @param {string} tagCode
   * @returns {Promise<TagRecord|null>}
   */
  async getTagByCode(contextCode, tagCode) {
    return this.db.queryOne(
      `SELECT * FROM kosmos.tag WHERE context_code = $1 AND code = $2`,
      [contextCode, tagCode]
    );
  }

  /**
   * Создание тега
   * @param {string} contextCode
   * @param {string} code
   * @param {string} name
   * @param {string|null} [description=null]
   * @returns {Promise<TagRecord>}
   */
  async createTag(contextCode, code, name, description = null) {
    return this.db.queryOne(
      `INSERT INTO kosmos.tag (context_code, code, name, description)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [contextCode, code, name, description]
    );
  }

  /**
   * Обновление тега
   * @param {string} contextCode
   * @param {string} tagCode
   * @param {Object} updates - { name?, description? }
   * @returns {Promise<TagRecord|null>}
   */
  async updateTag(contextCode, tagCode, updates) {
    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      params.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      params.push(updates.description);
    }

    if (setClauses.length === 0) {
      return this.getTagByCode(contextCode, tagCode);
    }

    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    params.push(contextCode, tagCode);

    return this.db.queryOne(
      `UPDATE kosmos.tag
       SET ${setClauses.join(', ')}
       WHERE context_code = $${paramIndex++} AND code = $${paramIndex}
       RETURNING *`,
      params
    );
  }

  /**
   * Удаление тега
   * @param {string} contextCode
   * @param {string} tagCode
   * @returns {Promise<boolean>}
   */
  async deleteTag(contextCode, tagCode) {
    const result = await this.db.query(
      `DELETE FROM kosmos.tag WHERE context_code = $1 AND code = $2`,
      [contextCode, tagCode]
    );
    return result.rowCount > 0;
  }

  // ==================== AI Item Tags ====================

  /**
   * Получение тегов для AI Item
   * @param {string} fullName
   * @param {string} contextCode
   * @returns {Promise<TagRecord[]>}
   */
  async getItemTags(fullName, contextCode) {
    return this.db.queryAll(
      `SELECT t.*
       FROM kosmos.tag t
       JOIN kosmos.ai_item_tag ait ON ait.tag_id = t.id
       WHERE ait.ai_item_full_name = $1 AND ait.ai_item_context_code = $2`,
      [fullName, contextCode]
    );
  }

  /**
   * Привязка тега к AI Item
   * @param {string} fullName
   * @param {string} contextCode
   * @param {number} tagId
   * @returns {Promise<boolean>}
   */
  async addTagToItem(fullName, contextCode, tagId) {
    try {
      await this.db.query(
        `INSERT INTO kosmos.ai_item_tag (ai_item_full_name, ai_item_context_code, tag_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [fullName, contextCode, tagId]
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Отвязка тега от AI Item
   * @param {string} fullName
   * @param {string} contextCode
   * @param {number} tagId
   * @returns {Promise<boolean>}
   */
  async removeTagFromItem(fullName, contextCode, tagId) {
    const result = await this.db.query(
      `DELETE FROM kosmos.ai_item_tag 
       WHERE ai_item_full_name = $1 AND ai_item_context_code = $2 AND tag_id = $3`,
      [fullName, contextCode, tagId]
    );
    return result.rowCount > 0;
  }

  /**
   * Получение AI Items по тегу
   * @param {string} contextCode
   * @param {string} tagCode
   * @returns {Promise<AiItemRecord[]>}
   */
  async getItemsByTag(contextCode, tagCode) {
    return this.db.queryAll(
      `SELECT ai.*
       FROM kosmos.ai_item ai
       JOIN kosmos.ai_item_tag ait ON ait.ai_item_full_name = ai.full_name 
         AND ait.ai_item_context_code = ai.context_code
       JOIN kosmos.tag t ON t.id = ait.tag_id
       WHERE t.context_code = $1 AND t.code = $2`,
      [contextCode, tagCode]
    );
  }

  // ==================== Statistics ====================

  /**
   * Подсчет AI Items в контексте
   * @param {string} [contextCode]
   * @returns {Promise<number>}
   */
  async count(contextCode = null) {
    let sql = 'SELECT COUNT(*) as count FROM kosmos.ai_item';
    const params = [];

    if (contextCode) {
      sql += ' WHERE context_code = $1';
      params.push(contextCode);
    }

    const result = await this.db.queryOne(sql, params);
    return parseInt(result.count);
  }

  /**
   * Статистика по типам AI Items
   * @param {string} [contextCode]
   * @returns {Promise<Array<{type: string, count: number}>>}
   */
  async getTypeStats(contextCode = null) {
    let sql = `
      SELECT type, COUNT(*) as count 
      FROM kosmos.ai_item 
      WHERE type IS NOT NULL AND type != ''
    `;
    const params = [];

    if (contextCode) {
      sql += ' AND context_code = $1';
      params.push(contextCode);
    }

    sql += ' GROUP BY type ORDER BY count DESC';

    return this.db.queryAll(sql, params);
  }
}

module.exports = AiItemsRepository;
