// hashUtils.js — утилиты хеширования для инкрементального обновления
const crypto = require('crypto');

/**
 * Вычисление SHA-256 хеша содержимого файла
 * @param {string} content — строковое содержимое файла
 * @returns {string} hex-строка SHA-256
 */
function computeFileHash(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Вычисление SHA-256 хеша сущности (entity) — функции, класса, секции и т.д.
 * Формат: SHA-256(body + '\n---\n' + signature + '\n---\n' + comment)
 * undefined/null заменяются на ''
 * @param {{ body?: string, signature?: string, comment?: string }} entity
 * @returns {string} hex-строка SHA-256
 */
function computeEntityHash({ body, signature, comment }) {
  const b = body ?? '';
  const s = signature ?? '';
  const c = comment ?? '';
  const payload = b + '\n---\n' + s + '\n---\n' + c;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

module.exports = {
  computeFileHash,
  computeEntityHash
};
