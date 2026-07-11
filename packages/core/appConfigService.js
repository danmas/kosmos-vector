// appConfigService.js
// Сервис для управления глобальной конфигурацией приложения (config.json)
const fs = require('fs');
const path = require('path');
const {
  getDefaultOntologyBuilderConfig
} = require('./ontologyBuilderDefaults');

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
    NATURAL_QUERY_AUTO_USE_THRESHOLD: 0.95,
    ontology_builder: getDefaultOntologyBuilderConfig()
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

  // Ontology Builder nested settings
  if (config.ontology_builder !== undefined) {
    if (config.ontology_builder === null || typeof config.ontology_builder !== 'object' || Array.isArray(config.ontology_builder)) {
      errors.push('ontology_builder must be an object');
    } else {
      const ob = config.ontology_builder;
      if (ob.model !== undefined && ob.model !== null && typeof ob.model !== 'string') {
        errors.push('ontology_builder.model must be a string or null');
      }
      if (ob.maxConcepts !== undefined) {
        const n = Number(ob.maxConcepts);
        if (isNaN(n) || n < 1 || n > 30) {
          errors.push('ontology_builder.maxConcepts must be a number between 1 and 30');
        }
      }
      if (ob.depth !== undefined && !['concepts', 'concepts+grounding'].includes(ob.depth)) {
        errors.push('ontology_builder.depth must be "concepts" or "concepts+grounding"');
      }
      if (ob.temperature !== undefined) {
        const t = Number(ob.temperature);
        if (isNaN(t) || t < 0 || t > 2) {
          errors.push('ontology_builder.temperature must be a number between 0 and 2');
        }
      }
      for (const field of [
        'systemPrompt',
        'userPromptTemplate',
        'descriptionSystemPrompt',
        'descriptionPrompt',
        'outputRulesSuffix',
        'retrySystemPrompt',
        'retryUserTemplate',
        'byoInstruction'
      ]) {
        if (ob[field] !== undefined && typeof ob[field] !== 'string') {
          errors.push(`ontology_builder.${field} must be a string`);
        }
      }
      if (ob.excludeNamePatterns !== undefined) {
        if (!Array.isArray(ob.excludeNamePatterns) || ob.excludeNamePatterns.some((p) => typeof p !== 'string')) {
          errors.push('ontology_builder.excludeNamePatterns must be an array of strings');
        }
      }
      if (ob.enableDescriptionPass !== undefined && typeof ob.enableDescriptionPass !== 'boolean') {
        errors.push('ontology_builder.enableDescriptionPass must be a boolean');
      }
      if (ob.seedMode !== undefined && !['user-only', 'all-existing'].includes(ob.seedMode)) {
        errors.push('ontology_builder.seedMode must be "user-only" or "all-existing"');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * Merge ontology_builder with factory defaults.
 * Empty prompt strings MUST NOT hide defaults — UI must show the real text used at runtime.
 * @param {object|null|undefined} raw
 * @returns {object}
 */
function normalizeOntologyBuilder(raw) {
  const defaults = getDefaultOntologyBuilderConfig();
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const merged = { ...defaults, ...src };

  for (const key of [
    'systemPrompt',
    'userPromptTemplate',
    'descriptionSystemPrompt',
    'descriptionPrompt',
    'outputRulesSuffix',
    'retrySystemPrompt',
    'retryUserTemplate',
    'byoInstruction'
  ]) {
    if (!merged[key] || !String(merged[key]).trim()) {
      merged[key] = defaults[key];
    }
  }
  if (merged.model !== undefined && merged.model !== null && !String(merged.model).trim()) {
    merged.model = null;
  }
  if (!Array.isArray(merged.excludeNamePatterns)) {
    merged.excludeNamePatterns = [...(defaults.excludeNamePatterns || [])];
  }
  if (merged.maxConcepts === undefined || merged.maxConcepts === null) {
    merged.maxConcepts = defaults.maxConcepts;
  }
  if (!merged.depth) {
    merged.depth = defaults.depth;
  }
  if (merged.temperature === undefined || merged.temperature === null || isNaN(Number(merged.temperature))) {
    merged.temperature = defaults.temperature;
  }
  if (typeof merged.enableDescriptionPass !== 'boolean') {
    merged.enableDescriptionPass = defaults.enableDescriptionPass;
  }
  if (merged.seedMode !== 'user-only' && merged.seedMode !== 'all-existing') {
    merged.seedMode = defaults.seedMode || 'user-only';
  }
  return merged;
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
    const defaults = getDefaultConfig();

    // Гарантируем наличие всех полей (на случай старых версий) + deep merge ontology_builder
    const fullConfig = {
      ...defaults,
      ...config,
      ontology_builder: normalizeOntologyBuilder(
        config.ontology_builder && typeof config.ontology_builder === 'object'
          ? config.ontology_builder
          : {}
      )
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
  const defaults = getDefaultConfig();

  const newConfig = {
    ...currentConfig,
    ...updates
  };

  // Deep-merge nested ontology_builder so partial PATCH does not wipe prompts
  if (updates.ontology_builder && typeof updates.ontology_builder === 'object') {
    newConfig.ontology_builder = normalizeOntologyBuilder({
      ...defaults.ontology_builder,
      ...(currentConfig.ontology_builder || {}),
      ...updates.ontology_builder
    });
  }

  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2), 'utf-8');
    console.log('[AppConfig] Конфиг обновлён');
    // Return normalized view (prompts never blank in API response)
    return getConfig();
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
  getDefaultConfig,
  getDefaultOntologyBuilderConfig,
  normalizeOntologyBuilder
};
