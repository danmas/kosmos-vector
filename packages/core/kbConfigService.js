// packages/core/kbConfigService.js
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(process.cwd(), 'data', 'kb-configs');

// Создаём директорию при старте сервера, если её нет
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  console.log(`[KBConfig] Создана папка для конфигов: ${CONFIG_DIR}`);
}

/**
 * Полный путь к файлу конфигурации для конкретного context-code
 * @param {string} contextCode
 * @returns {string}
 */
function getConfigFilePath(contextCode) {
  if (!contextCode || typeof contextCode !== 'string') {
    throw new Error('contextCode must be a non-empty string');
  }
  // Защита от path traversal
  const sanitized = contextCode.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(CONFIG_DIR, `${sanitized}.json`);
}

/**
 * Дефолтная конфигурация — вдохновлена текущим хардкодом в step1Runner.js
 * и адаптирована под общий случай RAG-анализа кодовой базы
 */
function getDefaultConfig() {
  return {
    rootPath: path.join(process.cwd(), 'docs'), // по аналогии с текущим проектом
    includeMask: "**/*.{sql,js,ts,tsx,py,java,go}", // расширенный набор языков из контракта
    ignorePatterns: "**/node_modules/**,**/venv/**,**/__pycache__/**,**/dist/**,**/.git/**",
    fileSelection: [], // пустой = используем glob-маски
    lastUpdated: new Date().toISOString(),
    metadata: {
      projectName: "New Project",
      description: "RAG knowledge base",
      tags: [],
      custom_settings: null  // YAML строка с произвольными настройками
    }
  };
}

/**
 * Читает конфигурацию по contextCode.
 * Если файла нет — создаёт с дефолтными значениями.
 * @param {string} contextCode
 * @returns {Promise<object>} KnowledgeBaseConfig
 */
async function getConfig(contextCode) {
  const filePath = getConfigFilePath(contextCode);

  if (!fs.existsSync(filePath)) {
    console.log(`[KBConfig] Конфиг не найден для ${contextCode}, создаём дефолтный`);
    const defaultConfig = getDefaultConfig();
    defaultConfig.lastUpdated = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return defaultConfig;
  }

  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const config = JSON.parse(data);

    // Гарантируем наличие всех полей (на случай старых версий)
    const fullConfig = {
      ...getDefaultConfig(),
      ...config,
      metadata: { ...getDefaultConfig().metadata, ...(config.metadata || {}) }
    };

    // Обновляем lastUpdated при чтении (опционально, но полезно для отслеживания активности)
    // Если не хочешь — можно убрать
    // fullConfig.lastUpdated = new Date().toISOString();

    return fullConfig;
  } catch (error) {
    console.error(`[KBConfig] Ошибка чтения конфига ${filePath}:`, error);
    throw new Error('Failed to read knowledge base configuration');
  }
}

/**
 * Сохраняет (обновляет) конфигурацию.
 * Поддерживает частичный патч — обновляются только переданные поля.
 * @param {string} contextCode
 * @param {object} updates - частичные или полные данные
 * @returns {Promise<object>} новая полная конфигурация
 */
async function saveConfig(contextCode, updates) {
  if (!updates || typeof updates !== 'object') {
    throw new Error('Updates must be a non-empty object');
  }

  const currentConfig = await getConfig(contextCode); // гарантирует существование файла

  const newConfig = {
    ...currentConfig,
    ...updates,
    metadata: { ...currentConfig.metadata, ...(updates.metadata || {}) },
    lastUpdated: new Date().toISOString()
  };

  // Если fileSelection стал не пустым — можно очистить маски (по контракту приоритет у него),
  // но оставляем как есть — фронтенд сам решает.

  const filePath = getConfigFilePath(contextCode);
  try {
    fs.writeFileSync(filePath, JSON.stringify(newConfig, null, 2), 'utf-8');
    console.log(`[KBConfig] Конфиг обновлён: ${filePath}`);
    return newConfig;
  } catch (error) {
    console.error(`[KBConfig] Ошибка записи конфига ${filePath}:`, error);
    throw new Error('Failed to save knowledge base configuration');
  }
}

module.exports = {
  getConfig,
  saveConfig,
  getConfigFilePath,
  CONFIG_DIR
};