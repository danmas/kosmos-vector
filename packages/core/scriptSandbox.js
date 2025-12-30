// scriptSandbox.js
// Безопасное выполнение скриптов для Natural Query Engine

/**
 * Выполнение скрипта в изолированном контексте с таймаутом
 * @param {string} scriptCode - Код скрипта (async function execute(contextCode) { ... })
 * @param {string} contextCode - Контекстный код для передачи в скрипт
 * @param {Object} dbService - Экземпляр DbService
 * @param {number} timeoutMs - Таймаут в миллисекундах (по умолчанию 5000)
 * @returns {Promise<any>} Результат выполнения скрипта (rawData)
 */
async function executeScript(scriptCode, contextCode, dbService, timeoutMs = 5000) {
  // Проверка формата скрипта
  if (!scriptCode || typeof scriptCode !== 'string') {
    throw new Error('Script code must be a non-empty string');
  }

  if (!scriptCode.includes('async function execute')) {
    throw new Error('Script must contain "async function execute(contextCode)"');
  }

  // Создаём безопасную обёртку для DbService
  // Только queryRaw доступен, и только для SELECT запросов
  const safeDbService = {
    queryRaw: async (sql, params = []) => {
      const trimmedSql = sql.trim();
      if (!trimmedSql.toUpperCase().startsWith('SELECT')) {
        throw new Error('Only SELECT queries are allowed in scripts');
      }
      return dbService.queryRaw(sql, params);
    }
  };

  try {
    // Создаём функцию из строки кода с инъекцией DbService
    // Используем new Function вместо eval для изоляции scope
    const executeFn = new Function('DbService', `
      ${scriptCode}
      return execute;
    `)(safeDbService);

    // Проверяем, что получили функцию
    if (typeof executeFn !== 'function') {
      throw new Error('Script must export an async function named "execute"');
    }

    // Выполняем с таймаутом через Promise.race
    const executionPromise = executeFn(contextCode);
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Script execution timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const result = await Promise.race([executionPromise, timeoutPromise]);
    
    return result;
  } catch (error) {
    // Перехватываем все ошибки и логируем
    console.error('[ScriptSandbox] Ошибка выполнения скрипта:', error);
    throw error;
  }
}

/**
 * Проверка безопасности скрипта перед выполнением
 * @param {string} scriptCode - Код скрипта
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateScript(scriptCode) {
  if (!scriptCode || typeof scriptCode !== 'string') {
    return { valid: false, error: 'Script code must be a non-empty string' };
  }

  if (!scriptCode.includes('async function execute')) {
    return { valid: false, error: 'Script must contain "async function execute(contextCode)"' };
  }

  // Проверяем на опасные паттерны
  const dangerousPatterns = [
    /eval\s*\(/i,
    /Function\s*\(/i,
    /require\s*\(/i,
    /import\s+/i,
    /process\./i,
    /global\./i,
    /__dirname/i,
    /__filename/i,
    /fs\./i,
    /child_process/i,
    /exec\s*\(/i,
    /spawn\s*\(/i
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(scriptCode)) {
      return { 
        valid: false, 
        error: `Script contains potentially dangerous pattern: ${pattern.toString()}` 
      };
    }
  }

  return { valid: true };
}

module.exports = {
  executeScript,
  validateScript
};

