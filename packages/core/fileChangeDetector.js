// fileChangeDetector.js — двухступенчатая проверка изменений файла (mtime + SHA-256)
const fs = require('fs');
const path = require('path');
const { computeFileHash } = require('./hashUtils');

/**
 * Проверяет, изменился ли файл с момента последней загрузки.
 * Двухступенчатая стратегия:
 *   1. Сравниваем mtime файловой системы с modified_at в БД
 *   2. Если mtime новее — считаем SHA-256 и сравниваем с file_hash в БД
 *
 * @param {string} filePath - Полный путь к файлу
 * @param {string} contextCode - Код контекста
 * @param {Object} dbService - Экземпляр DbService
 * @returns {Promise<{
 *   changed: boolean,
 *   fileId: number|null,
 *   content: string|null,
 *   newHash: string|null,
 *   status: 'new'|'skipped_mtime'|'skipped_hash'|'changed'
 * }>}
 */
async function checkFileChanged(filePath, contextCode, dbService) {
  const basename = path.basename(filePath);

  // 1. Читаем mtime из файловой системы
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch (err) {
    // Файл не существует — считаем «новым» (caller должен обработать)
    return { changed: true, fileId: null, content: null, newHash: null, status: 'new' };
  }
  const mtime = stats.mtime;

  // 2. Получаем метаданные из БД
  const dbFile = await dbService.getFileMetaForIncrCheck(basename, contextCode);

  // 3. Если файл есть в БД и mtime не обновился — skip
  if (dbFile) {
    const dbModifiedAt = new Date(dbFile.modified_at);
    if (mtime <= dbModifiedAt) {
      return { changed: false, fileId: dbFile.id, content: null, newHash: null, status: 'skipped_mtime' };
    }
  }

  // 4. Читаем содержимое файла
  const content = fs.readFileSync(filePath, 'utf8');

  // 5. Считаем хеш
  const newHash = computeFileHash(content);

  // 6. Если файл есть в БД и хеш совпадает — skip (но обновим mtime в БД)
  if (dbFile && dbFile.file_hash === newHash) {
    await dbService.updateFileModifiedAt(dbFile.id, mtime);
    return { changed: false, fileId: dbFile.id, content: null, newHash: null, status: 'skipped_hash' };
  }

  // 7. Файл изменился (или новый)
  return {
    changed: true,
    fileId: dbFile ? dbFile.id : null,
    content,
    newHash,
    status: dbFile ? 'changed' : 'new'
  };
}

module.exports = {
  checkFileChanged
};
