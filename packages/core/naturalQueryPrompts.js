// naturalQueryPrompts.js
// Промпты для генерации и обработки скриптов Natural Query Engine
const promptsService = require('./promptsService');

/**
 * Системный промпт для генерации скриптов
 * @param {string} question - Вопрос пользователя
 * @returns {string} Полный промпт с подставленным вопросом
 */
function getScriptGenerationPrompt(question) {
  return promptsService.getScriptGenerationPrompt(question);
}

/**
 * Промпт для превращения rawData в человекочитаемый текст
 * @param {string} question - Оригинальный вопрос пользователя
 * @param {any} rawData - Сырые данные из скрипта
 * @returns {string} Промпт для humanize
 */
function getHumanizePrompt(question, rawData) {
  return promptsService.getHumanizePrompt(question, rawData);
}

module.exports = {
  getScriptGenerationPrompt,
  getHumanizePrompt
};

