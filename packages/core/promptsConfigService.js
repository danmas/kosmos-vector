// promptsConfigService.js
// Сервис для управления конфигурацией промптов (prompts.json) с историей изменений
const fs = require('fs');
const path = require('path');

const PROMPTS_FILE = path.join(process.cwd(), 'prompts.json');

/**
 * Дефолтная конфигурация промптов
 */
function getDefaultPromptsConfig() {
  return {
    l1l2Templates: {
      sql: {
        function: {
          l1: {
            prompt: "Проанализируй эту SQL функцию/процедуру и опиши её зависимости от других объектов базы данных.",
            inputText: "Какие другие функции, процедуры или таблицы использует этот код? Опиши связи между объектами."
          },
          l2: {
            prompt: "Опиши бизнес-логику этой SQL функции/процедуры простым языком.",
            inputText: "Что делает эта функция? Какую бизнес-задачу она решает? Опиши алгоритм работы."
          }
        },
        table: {
          l1: {
            prompt: "Опиши связи этой таблицы с другими объектами базы данных.",
            inputText: "Какие таблицы ссылаются на эту через внешние ключи? С какими таблицами она связана?"
          },
          l2: {
            prompt: "Опиши назначение этой таблицы в системе.",
            inputText: "Какие данные хранятся в этой таблице? Для каких бизнес-процессов она используется?"
          }
        },
        view: {
          l1: {
            prompt: "Опиши связи этого представления с другими объектами базы данных.",
            inputText: "Какие таблицы или другие представления использует это представление?"
          },
          l2: {
            prompt: "Опиши назначение этого представления в системе.",
            inputText: "Для чего используется это представление? Какие данные оно предоставляет?"
          }
        }
      },
      js: {
        function: {
          l1: {
            prompt: "Проанализируй эту JavaScript функцию и опиши её зависимости.",
            inputText: "Какие другие функции она вызывает? Какие модули импортирует? К каким данным обращается?"
          },
          l2: {
            prompt: "Опиши бизнес-логику этой JavaScript функции простым языком.",
            inputText: "Что делает эта функция? Какую задачу она решает? Опиши алгоритм работы."
          }
        },
        class: {
          l1: {
            prompt: "Проанализируй этот JavaScript класс и опиши его зависимости.",
            inputText: "Какие другие классы он использует? Какие интерфейсы реализует? Какие методы экспортирует?"
          },
          l2: {
            prompt: "Опиши назначение этого JavaScript класса.",
            inputText: "Какую роль играет этот класс в системе? Какую функциональность он предоставляет?"
          }
        }
      },
      md: {
        section: {
          l1: {
            prompt: "Проанализируй эту секцию документации и опиши её связи с другими частями проекта.",
            inputText: "Какие другие секции документации или код связаны с этой секцией?"
          },
          l2: {
            prompt: "Кратко опиши содержание этой секции документации.",
            inputText: "О чём эта секция? Какую информацию она содержит?"
          }
        }
      }
    },
    rag: {
      systemPrompt: "Ты помощник для анализа кодовой базы. Используй предоставленный контекст из документов для ответа на вопрос пользователя. \nЕсли в контексте нет информации для ответа, честно скажи об этом. Отвечай на русском языке.",
      userPromptTemplate: "Контекст из кодовой базы:\n\n{context}\n\nВопрос пользователя: {question}\n\nОтвет:"
    },
    naturalQuery: {
      scriptGeneration: "Ты — генератор простых async JS-скриптов для анализа кодовой базы...",
      humanize: "Ты помощник для анализа кодовой базы. Преврати сырые данные из базы данных в понятный человекочитаемый текст на русском языке..."
    },
    vectorOperations: {
      qaPromptTemplate: "Используй следующие фрагменты контекста для ответа на вопрос в конце..."
    }
  };
}

/**
 * Валидация структуры конфигурации промптов
 * @param {object} config - конфигурация для валидации
 * @returns {object} { valid: boolean, errors: string[] }
 */
function validatePromptsConfig(config) {
  const errors = [];

  // Проверка наличия основных секций
  if (!config.l1l2Templates || typeof config.l1l2Templates !== 'object') {
    errors.push('l1l2Templates must be an object');
  }
  if (!config.rag || typeof config.rag !== 'object') {
    errors.push('rag must be an object');
  }
  if (!config.naturalQuery || typeof config.naturalQuery !== 'object') {
    errors.push('naturalQuery must be an object');
  }
  if (!config.vectorOperations || typeof config.vectorOperations !== 'object') {
    errors.push('vectorOperations must be an object');
  }

  // Проверка обязательных полей RAG
  if (config.rag) {
    if (!config.rag.systemPrompt || typeof config.rag.systemPrompt !== 'string') {
      errors.push('rag.systemPrompt must be a non-empty string');
    }
    if (!config.rag.userPromptTemplate || typeof config.rag.userPromptTemplate !== 'string') {
      errors.push('rag.userPromptTemplate must be a non-empty string');
    }
  }

  // Проверка обязательных полей Natural Query
  if (config.naturalQuery) {
    if (!config.naturalQuery.scriptGeneration || typeof config.naturalQuery.scriptGeneration !== 'string') {
      errors.push('naturalQuery.scriptGeneration must be a non-empty string');
    }
    if (!config.naturalQuery.humanize || typeof config.naturalQuery.humanize !== 'string') {
      errors.push('naturalQuery.humanize must be a non-empty string');
    }
  }

  // Проверка обязательных полей Vector Operations
  if (config.vectorOperations) {
    if (!config.vectorOperations.qaPromptTemplate || typeof config.vectorOperations.qaPromptTemplate !== 'string') {
      errors.push('vectorOperations.qaPromptTemplate must be a non-empty string');
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * Получить текущую конфигурацию промптов из prompts.json
 * @returns {object} конфигурация промптов
 */
function getPromptsConfig() {
  if (!fs.existsSync(PROMPTS_FILE)) {
    console.log('[PromptsConfig] Файл prompts.json не найден, создаём дефолтный');
    const defaultConfig = getDefaultPromptsConfig();
    fs.writeFileSync(PROMPTS_FILE, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return defaultConfig;
  }

  try {
    const data = fs.readFileSync(PROMPTS_FILE, 'utf-8');
    const config = JSON.parse(data);

    // Гарантируем наличие всех секций
    const fullConfig = {
      ...getDefaultPromptsConfig(),
      ...config
    };

    return fullConfig;
  } catch (error) {
    console.error('[PromptsConfig] Ошибка чтения prompts.json:', error);
    throw new Error('Failed to read prompts configuration');
  }
}

/**
 * Сохранить конфигурацию промптов
 * @param {object} config - конфигурация для сохранения
 * @returns {object} сохранённая конфигурация
 */
function savePromptsConfig(config) {
  try {
    fs.writeFileSync(PROMPTS_FILE, JSON.stringify(config, null, 2), 'utf-8');
    console.log('[PromptsConfig] Конфигурация сохранена в prompts.json');
    return config;
  } catch (error) {
    console.error('[PromptsConfig] Ошибка записи prompts.json:', error);
    throw new Error('Failed to save prompts configuration');
  }
}

/**
 * Обновить конфигурацию промптов с сохранением в историю
 * @param {object} pgClient - PostgreSQL клиент
 * @param {object} updates - частичные или полные данные
 * @param {string} [comment] - опциональный комментарий к изменению
 * @returns {Promise<object>} { config, historyEntry }
 */
async function updatePromptsConfig(pgClient, updates, comment = null) {
  if (!updates || typeof updates !== 'object') {
    throw new Error('Updates must be a non-empty object');
  }

  // Валидация обновлений
  const validation = validatePromptsConfig(updates);
  if (!validation.valid) {
    const error = new Error('Configuration validation failed');
    error.validationErrors = validation.errors;
    throw error;
  }

  const currentConfig = getPromptsConfig();

  // Полная замена (не deep merge)
  const newConfig = {
    ...currentConfig,
    ...updates
  };

  // Получить следующий номер версии
  const versionResult = await pgClient.query(
    'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM prompt_config_history'
  );
  const nextVersion = versionResult.rows[0].next_version;

  // Сохранить в историю
  const historyResult = await pgClient.query(
    `INSERT INTO prompt_config_history (config_snapshot, version, comment)
     VALUES ($1, $2, $3)
     RETURNING id, created_at, version`,
    [JSON.stringify(newConfig), nextVersion, comment]
  );

  const historyEntry = historyResult.rows[0];

  // Сохранить в файл
  savePromptsConfig(newConfig);

  console.log(`[PromptsConfig] Конфигурация обновлена (версия ${nextVersion})`);

  return {
    config: newConfig,
    historyEntry: {
      id: historyEntry.id,
      version: historyEntry.version,
      createdAt: historyEntry.created_at,
      comment: comment
    }
  };
}

/**
 * Получить историю изменений конфигурации
 * @param {object} pgClient - PostgreSQL клиент
 * @param {number} [limit=50] - количество записей
 * @param {number} [offset=0] - смещение
 * @returns {Promise<Array>} массив записей истории
 */
async function getPromptsConfigHistory(pgClient, limit = 50, offset = 0) {
  const result = await pgClient.query(
    `SELECT id, version, created_at, comment
     FROM prompt_config_history
     ORDER BY version DESC
     LIMIT $1 OFFSET $2`,
    [Math.min(limit, 100), offset]
  );

  return result.rows.map(row => ({
    id: row.id,
    version: row.version,
    createdAt: row.created_at,
    comment: row.comment
  }));
}

/**
 * Получить конкретную версию из истории
 * @param {object} pgClient - PostgreSQL клиент
 * @param {number} id - ID записи истории
 * @returns {Promise<object>} запись истории с полным snapshot
 */
async function getPromptsConfigHistoryById(pgClient, id) {
  const result = await pgClient.query(
    `SELECT id, config_snapshot, version, created_at, comment
     FROM prompt_config_history
     WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    version: row.version,
    createdAt: row.created_at,
    comment: row.comment,
    config: row.config_snapshot
  };
}

/**
 * Восстановить конфигурацию из истории
 * @param {object} pgClient - PostgreSQL клиент
 * @param {number} id - ID записи истории для восстановления
 * @param {string} [comment] - комментарий к восстановлению
 * @returns {Promise<object>} { config, historyEntry }
 */
async function restorePromptsConfigFromHistory(pgClient, id, comment = null) {
  // Получить конфигурацию из истории
  const historyEntry = await getPromptsConfigHistoryById(pgClient, id);
  
  if (!historyEntry) {
    throw new Error(`History entry with id ${id} not found`);
  }

  const configToRestore = historyEntry.config;

  // Создать новую версию с этой конфигурацией
  const restoreComment = comment || `Restored from version ${historyEntry.version}`;
  
  return await updatePromptsConfig(pgClient, configToRestore, restoreComment);
}

/**
 * Сбросить конфигурацию к значениям по умолчанию
 * @param {object} pgClient - PostgreSQL клиент
 * @param {string} [comment] - комментарий к сбросу
 * @returns {Promise<object>} { config, historyEntry }
 */
async function resetPromptsConfig(pgClient, comment = null) {
  const defaultConfig = getDefaultPromptsConfig();
  const resetComment = comment || 'Reset to default configuration';
  
  return await updatePromptsConfig(pgClient, defaultConfig, resetComment);
}

/**
 * Удалить запись из истории
 * @param {object} pgClient - PostgreSQL клиент
 * @param {number} id - ID записи истории
 * @returns {Promise<boolean>} успешность удаления
 */
async function deletePromptsConfigHistoryEntry(pgClient, id) {
  const result = await pgClient.query(
    'DELETE FROM prompt_config_history WHERE id = $1 RETURNING id',
    [id]
  );

  return result.rowCount > 0;
}

module.exports = {
  getPromptsConfig,
  savePromptsConfig,
  updatePromptsConfig,
  getPromptsConfigHistory,
  getPromptsConfigHistoryById,
  restorePromptsConfigFromHistory,
  resetPromptsConfig,
  deletePromptsConfigHistoryEntry,
  validatePromptsConfig,
  getDefaultPromptsConfig
};
