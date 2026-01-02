// packages/core/pipelineConfigService.js
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(process.cwd(), 'kb-configs');

// Создаём директорию при старте сервера, если её нет
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  console.log(`[PipelineConfig] Создана папка для конфигов: ${CONFIG_DIR}`);
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
 * Дефолтные определения шагов pipeline с описаниями и схемами конфигурации
 * @returns {Array<PipelineStepDefinition>}
 */
function getDefaultStepDefinitions() {
  return [
    {
      id: 1,
      name: 'parsing',
      label: 'Polyglot Parsing (L0)',
      description: 'Parsing AST for .py, .ts, .go, .java files...',
      configurationSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      id: 2,
      name: 'dependencies',
      label: 'Dependencies Extraction (L1)',
      description: 'Resolving imports, class hierarchy, and calls...',
      configurationSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      id: 3,
      name: 'enrichment',
      label: 'Enrichment (L2)',
      description: 'Generating natural language descriptions via LLM...',
      configurationSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      id: 4,
      name: 'vectorization',
      label: 'Vectorization',
      description: 'Creating embeddings (text-embedding-ada-002 or Gecko)...',
      configurationSchema: {
        type: 'object',
        properties: {
          embeddingModel: {
            type: 'string',
            description: 'Embedding model to use',
            default: 'Google Gemini (text-embedding-004)',
            enum: ['Google Gemini (text-embedding-004)', 'text-embedding-ada-002', 'Gecko']
          },
          chunkStrategy: {
            type: 'string',
            description: 'Strategy for chunking code',
            default: 'Semantic (Ailtem / Function-based)',
            enum: ['Semantic (Ailtem / Function-based)']
          }
        }
      }
    },
    {
      id: 5,
      name: 'indexing',
      label: 'Indexing',
      description: 'Building FAISS/ChromaDB index...',
      configurationSchema: {
        type: 'object',
        properties: {}
      }
    }
  ];
}

/**
 * Дефолтная конфигурация pipeline для новых конфигов
 * @returns {object} PipelineContextConfig с дефолтными значениями
 */
function getDefaultPipelineConfig() {
  return {
    parsing: {},
    dependencies: {},
    enrichment: {},
    vectorization: {
      embeddingModel: 'Google Gemini (text-embedding-004)',
      chunkStrategy: 'Semantic (Ailtem / Function-based)'
    },
    indexing: {}
  };
}

/**
 * Дефолтные определения шагов pipeline для хранения в конфигурационных файлах
 * @returns {Array<PipelineStepDefinition>}
 */
function getDefaultPipelineDefinitions() {
  return getDefaultStepDefinitions();
}

/**
 * Читает определения шагов pipeline по contextCode из конфигурационного файла.
 * Если файла нет или поле pipelineDefinitions отсутствует — возвращает дефолтные определения.
 * @param {string} contextCode
 * @returns {Promise<Array<PipelineStepDefinition>>}
 */
async function getPipelineDefinitions(contextCode) {
  const filePath = getConfigFilePath(contextCode);

  if (!fs.existsSync(filePath)) {
    // Возвращаем дефолтные определения, если файла нет
    return getDefaultStepDefinitions();
  }

  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const config = JSON.parse(data);
    
    // Возвращаем pipelineDefinitions из файла, или дефолтные если их нет
    return config.pipelineDefinitions || getDefaultStepDefinitions();
  } catch (error) {
    console.error(`[PipelineConfig] Ошибка чтения pipelineDefinitions ${filePath}:`, error);
    // В случае ошибки возвращаем дефолтные определения
    return getDefaultStepDefinitions();
  }
}

/**
 * Читает конфигурацию pipeline по contextCode из основного конфигурационного файла.
 * Если файла нет или поле pipelineConfig отсутствует — возвращает пустой объект {}.
 * @param {string} contextCode
 * @returns {Promise<object>} PipelineContextConfig
 */
async function getPipelineConfig(contextCode) {
  const filePath = getConfigFilePath(contextCode);

  if (!fs.existsSync(filePath)) {
    // Возвращаем пустой объект, если файла нет
    return {};
  }

  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const config = JSON.parse(data);
    
    // Возвращаем pipelineConfig из конфигурационного файла, или пустой объект
    return config.pipelineConfig || {};
  } catch (error) {
    console.error(`[PipelineConfig] Ошибка чтения конфига ${filePath}:`, error);
    throw new Error('Failed to read pipeline configuration');
  }
}

/**
 * Сохраняет конфигурацию pipeline в основном конфигурационном файле.
 * Обновляет только поле pipelineConfig, сохраняя остальные поля файла.
 * @param {string} contextCode
 * @param {object} pipelineConfig - конфигурация PipelineContextConfig
 * @returns {Promise<object>} сохранённая конфигурация
 */
async function savePipelineConfig(contextCode, pipelineConfig) {
  if (!pipelineConfig || typeof pipelineConfig !== 'object') {
    throw new Error('PipelineConfig must be a non-empty object');
  }

  const filePath = getConfigFilePath(contextCode);
  
  try {
    // Читаем существующий конфиг или создаём пустой объект
    let fullConfig = {};
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      fullConfig = JSON.parse(data);
    }
    
    // Обновляем только поле pipelineConfig
    fullConfig.pipelineConfig = pipelineConfig;
    fullConfig.lastUpdated = new Date().toISOString();
    
    // Сохраняем обновлённый конфиг
    fs.writeFileSync(filePath, JSON.stringify(fullConfig, null, 2), 'utf-8');
    console.log(`[PipelineConfig] Конфиг обновлён: ${filePath}`);
    return pipelineConfig;
  } catch (error) {
    console.error(`[PipelineConfig] Ошибка записи конфига ${filePath}:`, error);
    throw new Error('Failed to save pipeline configuration');
  }
}

module.exports = {
  getPipelineConfig,
  savePipelineConfig,
  getPipelineDefinitions,
  getDefaultStepDefinitions,
  getDefaultPipelineConfig,
  getDefaultPipelineDefinitions,
  getConfigFilePath,
  CONFIG_DIR
};
