// FilesRepository.js - Репозиторий для работы с таблицей public.files
// Отвечает только за SQL-операции с файлами, без бизнес-логики файловой системы

/**
 * @typedef {Object} FileRecord
 * @property {number} id
 * @property {string} filename
 * @property {string} file_url
 * @property {string} context_code
 * @property {string|null} file_hash
 * @property {string|null} content
 * @property {Date} created_at
 * @property {Date} modified_at
 */

/**
 * @typedef {Object} CreateFileParams
 * @property {string} filename - Имя файла
 * @property {string} [fileUrl] - Абсолютный путь к файлу
 * @property {string} [contextCode='DEFAULT'] - Код контекста
 * @property {string|null} [content=null] - Содержимое файла
 * @property {string|null} [fileHash=null] - SHA-256 хеш содержимого
 * @property {Date} [modifiedAt] - Дата модификации
 */

/**
 * Репозиторий для работы с таблицей files
 */
class FilesRepository {
  /**
   * @param {import('../Database')} db - Экземпляр Database
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Создание или обновление записи о файле (upsert по filename + context_code)
   * @param {CreateFileParams} params
   * @returns {Promise<{id: number, isNew: boolean}>}
   */
  async upsert(params) {
    const {
      filename,
      fileUrl = null,
      contextCode = 'DEFAULT',
      content = null,
      fileHash = null,
      modifiedAt = new Date()
    } = params;

    // Поиск существующего файла по filename + context_code
    const existing = await this.db.queryOne(
      `SELECT id FROM public.files WHERE filename = $1 AND context_code = $2`,
      [filename, contextCode]
    );

    if (!existing) {
      // INSERT
      const result = await this.db.queryOne(
        `INSERT INTO public.files (filename, file_url, modified_at, content, context_code, file_hash)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [filename, fileUrl, modifiedAt, content, contextCode, fileHash]
      );
      return { id: result.id, isNew: true };
    } else {
      // UPDATE
      await this.db.query(
        `UPDATE public.files
         SET file_url = $1, modified_at = $2, content = $3, context_code = $4, file_hash = $5
         WHERE id = $6`,
        [fileUrl, modifiedAt, content, contextCode, fileHash, existing.id]
      );
      return { id: existing.id, isNew: false };
    }
  }

  /**
   * Создание новой записи о файле
   * @param {CreateFileParams} params
   * @returns {Promise<FileRecord>}
   */
  async create(params) {
    const {
      filename,
      fileUrl = null,
      contextCode = 'DEFAULT',
      content = null,
      fileHash = null,
      modifiedAt = new Date()
    } = params;

    return this.db.queryOne(
      `INSERT INTO public.files (filename, file_url, modified_at, content, context_code, file_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [filename, fileUrl, modifiedAt, content, contextCode, fileHash]
    );
  }

  /**
   * Получение файла по ID
   * @param {number} fileId
   * @returns {Promise<FileRecord|null>}
   */
  async getById(fileId) {
    return this.db.queryOne(
      `SELECT * FROM public.files WHERE id = $1`,
      [fileId]
    );
  }

  /**
   * Получение файла по имени и контексту
   * @param {string} filename
   * @param {string} [contextCode]
   * @returns {Promise<FileRecord|null>}
   */
  async getByFilename(filename, contextCode = null) {
    if (contextCode) {
      return this.db.queryOne(
        `SELECT * FROM public.files WHERE filename = $1 AND context_code = $2`,
        [filename, contextCode]
      );
    }
    return this.db.queryOne(
      `SELECT * FROM public.files WHERE filename = $1`,
      [filename]
    );
  }

  /**
   * Получение файла по хешу содержимого
   * @param {string} fileHash
   * @param {string} [contextCode]
   * @returns {Promise<FileRecord|null>}
   */
  async getByHash(fileHash, contextCode = null) {
    if (contextCode) {
      return this.db.queryOne(
        `SELECT * FROM public.files WHERE file_hash = $1 AND context_code = $2`,
        [fileHash, contextCode]
      );
    }
    return this.db.queryOne(
      `SELECT * FROM public.files WHERE file_hash = $1`,
      [fileHash]
    );
  }

  /**
   * Получение всех файлов с информацией о количестве чанков
   * @param {string} [contextCode] - Фильтр по контексту
   * @returns {Promise<Array<FileRecord & {chunks_count: number}>>}
   */
  async getAllWithChunksCount(contextCode = null) {
    let sql = `
      SELECT f.*, 
             (SELECT COUNT(*) FROM public.chunk_vector WHERE file_id = f.id) as chunks_count
      FROM public.files f
    `;
    const params = [];

    if (contextCode) {
      sql += ' WHERE f.context_code = $1';
      params.push(contextCode);
    }

    sql += ' ORDER BY f.created_at DESC';

    return this.db.queryAll(sql, params);
  }

  /**
   * Получение списка уникальных контекстных кодов
   * @returns {Promise<string[]>}
   */
  async getContextCodes() {
    const rows = await this.db.queryAll(
      `SELECT DISTINCT context_code 
       FROM public.files 
       WHERE context_code IS NOT NULL 
       ORDER BY context_code`
    );

    // Всегда включаем DEFAULT
    const contexts = new Set(['DEFAULT']);
    rows.forEach(row => {
      if (row.context_code) {
        contexts.add(row.context_code);
      }
    });

    return Array.from(contexts);
  }

  /**
   * Обновление контекстного кода файла
   * @param {number} fileId
   * @param {string} contextCode
   * @returns {Promise<boolean>}
   */
  async updateContextCode(fileId, contextCode) {
    const result = await this.db.query(
      `UPDATE public.files SET context_code = $1 WHERE id = $2`,
      [contextCode, fileId]
    );
    return result.rowCount > 0;
  }

  /**
   * Обновление времени модификации файла
   * @param {number} fileId
   * @param {Date} [modifiedAt=new Date()]
   * @returns {Promise<boolean>}
   */
  async updateModifiedAt(fileId, modifiedAt = new Date()) {
    const result = await this.db.query(
      `UPDATE public.files SET modified_at = $1 WHERE id = $2`,
      [modifiedAt, fileId]
    );
    return result.rowCount > 0;
  }

  /**
   * Удаление файла по ID (каскадно удалит chunk_vector)
   * @param {number} fileId
   * @returns {Promise<boolean>}
   */
  async delete(fileId) {
    const result = await this.db.query(
      `DELETE FROM public.files WHERE id = $1`,
      [fileId]
    );
    return result.rowCount > 0;
  }

  /**
   * Удаление файлов по контексту
   * @param {string} contextCode
   * @returns {Promise<number>} - Количество удаленных файлов
   */
  async deleteByContext(contextCode) {
    const result = await this.db.query(
      `DELETE FROM public.files WHERE context_code = $1`,
      [contextCode]
    );
    return result.rowCount;
  }

  /**
   * Проверка существования файла
   * @param {string} filename
   * @param {string} [contextCode]
   * @returns {Promise<boolean>}
   */
  async exists(filename, contextCode = null) {
    const file = await this.getByFilename(filename, contextCode);
    return file !== null;
  }

  /**
   * Подсчет файлов в контексте
   * @param {string} [contextCode]
   * @returns {Promise<number>}
   */
  async count(contextCode = null) {
    let sql = 'SELECT COUNT(*) as count FROM public.files';
    const params = [];

    if (contextCode) {
      sql += ' WHERE context_code = $1';
      params.push(contextCode);
    }

    const result = await this.db.queryOne(sql, params);
    return parseInt(result.count);
  }
}

module.exports = FilesRepository;
