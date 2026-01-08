// promptsService.js
// Сервис для загрузки и доступа к промптам из prompts.json

const fs = require('fs');
const path = require('path');

let promptsCache = null;

/**
 * Загружает prompts.json из корня проекта
 * @returns {Object} Объект с промптами
 */
function loadPrompts() {
  if (promptsCache !== null) {
    return promptsCache;
  }

  const promptsPath = path.join(__dirname, '../../prompts.json');
  
  try {
    const promptsContent = fs.readFileSync(promptsPath, 'utf8');
    promptsCache = JSON.parse(promptsContent);
    console.log('[PROMPTS] Промпты загружены из prompts.json');
    return promptsCache;
  } catch (error) {
    console.error('[PROMPTS] Ошибка загрузки prompts.json:', error.message);
    throw new Error(`Не удалось загрузить prompts.json: ${error.message}`);
  }
}

/**
 * Получить промпт для генерации L1/L2 чанков
 * @param {string} fileType - Тип файла: 'sql', 'js', 'md'
 * @param {string} objectType - Тип объекта: 'function', 'table', 'view', 'class', 'section'
 * @param {number} level - Уровень: 1 или 2
 * @returns {{prompt: string, inputText: string}}
 */
function getL1L2Prompt(fileType, objectType, level) {
  const prompts = loadPrompts();
  
  const ft = (fileType || 'js').toLowerCase();
  const ot = (objectType || 'function').toLowerCase();
  const l = `l${level}`;

  // Нормализация типов
  let normalizedFt = ft;
  let normalizedOt = ot;

  // Нормализация fileType
  if (ft === 'ts') normalizedFt = 'js'; // TypeScript использует JS промпты
  if (ft === 'javascript') normalizedFt = 'js';
  if (ft === 'markdown') normalizedFt = 'md';

  // Нормализация objectType для SQL
  if (normalizedFt === 'sql') {
    if (ot.includes('function') || ot.includes('procedure')) normalizedOt = 'function';
    else if (ot.includes('table') || ot.includes('type') || ot.includes('domain') || ot.includes('sequence')) normalizedOt = 'table';
    else if (ot.includes('view')) normalizedOt = 'view';
  }
  // Нормализация objectType для JS
  else if (normalizedFt === 'js') {
    if (ot.includes('method') || ot.includes('function')) normalizedOt = 'function';
    else if (ot.includes('class')) normalizedOt = 'class';
    else normalizedOt = 'function'; // По умолчанию для JS
  }
  // Нормализация objectType для MD
  else if (normalizedFt === 'md') {
    normalizedOt = 'section';
  }

  try {
    const template = prompts.l1l2Templates[normalizedFt]?.[normalizedOt]?.[l];
    
    if (!template || !template.prompt || !template.inputText) {
      throw new Error(
        `Промпт не найден для: fileType=${normalizedFt}, objectType=${normalizedOt}, level=${level}`
      );
    }

    return {
      prompt: template.prompt,
      inputText: template.inputText
    };
  } catch (error) {
    throw new Error(
      `Ошибка получения промпта L${level} для ${normalizedFt}/${normalizedOt}: ${error.message}`
    );
  }
}

/**
 * Получить промпты для RAG-чата
 * @returns {{systemPrompt: string, userPromptTemplate: string}}
 */
function getRagPrompts() {
  const prompts = loadPrompts();
  
  if (!prompts.rag || !prompts.rag.systemPrompt || !prompts.rag.userPromptTemplate) {
    throw new Error('RAG промпты не найдены в prompts.json');
  }

  return {
    systemPrompt: prompts.rag.systemPrompt,
    userPromptTemplate: prompts.rag.userPromptTemplate
  };
}

/**
 * Получить промпт для генерации скриптов Natural Query Engine
 * @param {string} question - Вопрос пользователя
 * @returns {string} Полный промпт с подставленным вопросом
 */
function getScriptGenerationPrompt(question) {
  const prompts = loadPrompts();
  
  if (!prompts.naturalQuery || !prompts.naturalQuery.scriptGeneration) {
    throw new Error('Промпт для генерации скриптов не найден в prompts.json');
  }

  return prompts.naturalQuery.scriptGeneration.replace('{question}', question);
}

/**
 * Получить промпт для превращения rawData в человекочитаемый текст
 * @param {string} question - Оригинальный вопрос пользователя
 * @param {any} rawData - Сырые данные из скрипта
 * @returns {string} Промпт для humanize
 */
function getHumanizePrompt(question, rawData) {
  const prompts = loadPrompts();
  
  if (!prompts.naturalQuery || !prompts.naturalQuery.humanize) {
    throw new Error('Промпт для humanize не найден в prompts.json');
  }

  const rawDataStr = JSON.stringify(rawData, null, 2);
  
  return prompts.naturalQuery.humanize
    .replace('{question}', question)
    .replace('{rawData}', rawDataStr);
}

/**
 * Получить шаблон промпта для QA (vectorOperations)
 * @returns {string} Шаблон промпта с плейсхолдерами {context} и {question}
 */
function getQaPromptTemplate() {
  const prompts = loadPrompts();
  
  if (!prompts.vectorOperations || !prompts.vectorOperations.qaPromptTemplate) {
    throw new Error('QA промпт-шаблон не найден в prompts.json');
  }

  return prompts.vectorOperations.qaPromptTemplate;
}

/**
 * Получить все промпты Natural Query
 * @returns {{scriptGeneration: string, humanize: string}}
 */
function getNaturalQueryPrompts() {
  const prompts = loadPrompts();
  
  if (!prompts.naturalQuery || !prompts.naturalQuery.scriptGeneration || !prompts.naturalQuery.humanize) {
    throw new Error('Natural Query промпты не найдены в prompts.json');
  }

  return {
    scriptGeneration: prompts.naturalQuery.scriptGeneration,
    humanize: prompts.naturalQuery.humanize
  };
}

/**
 * Обновить промпты Natural Query
 * @param {{scriptGeneration?: string, humanize?: string}} updates - Частичные обновления
 * @returns {Promise<{scriptGeneration: string, humanize: string}>} Обновленные промпты
 */
async function updateNaturalQueryPrompts(updates) {
  const prompts = loadPrompts();
  
  if (!prompts.naturalQuery) {
    prompts.naturalQuery = {};
  }

  // Частичное обновление
  if (updates.scriptGeneration !== undefined) {
    prompts.naturalQuery.scriptGeneration = updates.scriptGeneration;
  }
  if (updates.humanize !== undefined) {
    prompts.naturalQuery.humanize = updates.humanize;
  }

  // Сохраняем в файл
  await savePrompts(prompts);
  
  // Сбрасываем кэш
  clearCache();

  return {
    scriptGeneration: prompts.naturalQuery.scriptGeneration,
    humanize: prompts.naturalQuery.humanize
  };
}

/**
 * Сохранить промпты в файл
 * @param {Object} prompts - Объект с промптами
 * @returns {Promise<void>}
 */
async function savePrompts(prompts) {
  const promptsPath = path.join(__dirname, '../../prompts.json');
  
  try {
    const promptsJson = JSON.stringify(prompts, null, 2);
    fs.writeFileSync(promptsPath, promptsJson, 'utf8');
    console.log('[PROMPTS] Промпты сохранены в prompts.json');
  } catch (error) {
    console.error('[PROMPTS] Ошибка сохранения prompts.json:', error.message);
    throw new Error(`Не удалось сохранить prompts.json: ${error.message}`);
  }
}

/**
 * Получить все промпты (полная конфигурация)
 * @returns {Object} Полная конфигурация промптов
 */
function getAllPrompts() {
  return loadPrompts();
}

/**
 * Обновить все промпты (полная замена)
 * @param {Object} newPrompts - Новая полная конфигурация
 * @returns {Promise<Object>} Сохраненная конфигурация
 */
async function updateAllPrompts(newPrompts) {
  // Валидация структуры
  if (!newPrompts.naturalQuery || !newPrompts.naturalQuery.scriptGeneration || !newPrompts.naturalQuery.humanize) {
    throw new Error('naturalQuery.scriptGeneration и naturalQuery.humanize обязательны');
  }

  await savePrompts(newPrompts);
  clearCache();
  
  return loadPrompts();
}

/**
 * Сбросить кэш промптов (для перезагрузки после изменения файла)
 */
function clearCache() {
  promptsCache = null;
}

module.exports = {
  loadPrompts,
  getL1L2Prompt,
  getRagPrompts,
  getScriptGenerationPrompt,
  getHumanizePrompt,
  getQaPromptTemplate,
  getNaturalQueryPrompts,
  updateNaturalQueryPrompts,
  getAllPrompts,
  updateAllPrompts,
  savePrompts,
  clearCache
};
