// appConfigService.js
// Сервис для управления глобальной конфигурацией приложения (config.json)
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(process.cwd(), 'config.json');

/**
 * Дефолтная конфигурация приложения
 */
function getDefaultConfig() {
  return {
    KOSMOS_BASE_URL: "http://localhost:3002/v1",
    KOSMOS_MODEL: "FAST",
    KOSMOS_LOGIC_ARHITECT_MODEL: "INSTRUCT",
    LOG_LEVEL: "info",
    NATURAL_QUERY_SUGGEST_LIMIT: 5,
    NATURAL_QUERY_SIMILARITY_THRESHOLD: 0.8,
    NATURAL_QUERY_AUTO_USE_THRESHOLD: 0.95
  };
}

/**
 * Валидация конфигурации
 * @param {object} config - конфигурация для валидации
 * @returns {object} { valid: boolean, errors: string[] }
 */
function validateConfig(config) {
  const errors = [];

  // Валидация KOSMOS_BASE_URL
  if (config.KOSMOS_BASE_URL !== undefined) {
    if (typeof config.KOSMOS_BASE_URL !== 'string') {
      errors.push('KOSMOS_BASE_URL must be a string');
    } else {
      try {
        new URL(config.KOSMOS_BASE_URL);
      } catch (err) {
        errors.push('KOSMOS_BASE_URL must be a valid URL');
      }
    }
  }

  // Валидация KOSMOS_MODEL
  // TODO: Согласовать список допустимых моделей с проектом kosmos-model
  if (config.KOSMOS_MODEL !== undefined && typeof config.KOSMOS_MODEL !== 'string') {
    errors.push('KOSMOS_MODEL must be a string');
  }

  // Валидация KOSMOS_LOGIC_ARHITECT_MODEL
  // TODO: Согласовать список допустимых моделей с проектом kosmos-model
  if (config.KOSMOS_LOGIC_ARHITECT_MODEL !== undefined && 
      config.KOSMOS_LOGIC_ARHITECT_MODEL !== null && 
      typeof config.KOSMOS_LOGIC_ARHITECT_MODEL !== 'string') {
    errors.push('KOSMOS_LOGIC_ARHITECT_MODEL must be a string or null');
  }

  // Валидация LOG_LEVEL
  if (config.LOG_LEVEL !== undefined) {
    const validLevels = ['debug', 'info', 'warn', 'error'];
    if (!validLevels.includes(config.LOG_LEVEL)) {
      errors.push(`LOG_LEVEL must be one of: ${validLevels.join(', ')}`);
    }
  }

  // Валидация числовых параметров
  if (config.NATURAL_QUERY_SUGGEST_LIMIT !== undefined) {
    const val = Number(config.NATURAL_QUERY_SUGGEST_LIMIT);
    if (isNaN(val) || val < 1 || val > 100) {
      errors.push('NATURAL_QUERY_SUGGEST_LIMIT must be a number between 1 and 100');
    }
  }

  if (config.NATURAL_QUERY_SIMILARITY_THRESHOLD !== undefined) {
    const val = Number(config.NATURAL_QUERY_SIMILARITY_THRESHOLD);
    if (isNaN(val) || val < 0 || val > 1) {
      errors.push('NATURAL_QUERY_SIMILARITY_THRESHOLD must be a number between 0 and 1');
    }
  }

  if (config.NATURAL_QUERY_AUTO_USE_THRESHOLD !== undefined) {
    const val = Number(config.NATURAL_QUERY_AUTO_USE_THRESHOLD);
    if (isNaN(val) || val < 0 || val > 1) {
      errors.push('NATURAL_QUERY_AUTO_USE_THRESHOLD must be a number between 0 and 1');
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * Получить текущую конфигурацию приложения
 * @returns {object} конфигурация
 */
function getConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.log('[AppConfig] Конфиг не найден, создаём дефолтный');
    const defaultConfig = getDefaultConfig();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return defaultConfig;
  }

  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(data);

    // Гарантируем наличие всех полей (на случай старых версий)
    const fullConfig = {
      ...getDefaultConfig(),
      ...config
    };

    return fullConfig;
  } catch (error) {
    console.error('[AppConfig] Ошибка чтения конфига:', error);
    throw new Error('Failed to read application configuration');
  }
}

/**
 * Сохранить конфигурацию приложения
 * Поддерживает частичный патч — обновляются только переданные поля
 * @param {object} updates - частичные или полные данные
 * @returns {object} новая полная конфигурация
 */
function saveConfig(updates) {
  if (!updates || typeof updates !== 'object') {
    throw new Error('Updates must be a non-empty object');
  }

  // Валидация обновлений
  const validation = validateConfig(updates);
  if (!validation.valid) {
    const error = new Error('Configuration validation failed');
    error.validationErrors = validation.errors;
    throw error;
  }

  const currentConfig = getConfig(); // гарантирует существование файла

  const newConfig = {
    ...currentConfig,
    ...updates
  };

  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2), 'utf-8');
    console.log('[AppConfig] Конфиг обновлён');
    return newConfig;
  } catch (error) {
    console.error('[AppConfig] Ошибка записи конфига:', error);
    throw new Error('Failed to save application configuration');
  }
}

/**
 * Сбросить конфигурацию к значениям по умолчанию
 * @returns {object} дефолтная конфигурация
 */
function resetConfig() {
  const defaultConfig = getDefaultConfig();
  
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    console.log('[AppConfig] Конфиг сброшен к значениям по умолчанию');
    return defaultConfig;
  } catch (error) {
    console.error('[AppConfig] Ошибка сброса конфига:', error);
    throw new Error('Failed to reset application configuration');
  }
}

module.exports = {
  getConfig,
  saveConfig,
  resetConfig,
  validateConfig,
  getDefaultConfig
};
