// Утилита для сбора логов во время выполнения шагов pipeline
// routes/pipeline/stepLogger.js

const { logContext } = require('../../server');

/**
 * Создаёт логгер, который собирает все сообщения в массив
 * и одновременно выводит их в консоль с поддержкой sessionId
 * 
 * @param {string} prefix - Префикс для логов (например, '[Step1]')
 * @param {string} sessionId - ID сессии для привязки логов
 * @returns {object} Объект с методами log, warn, error и getLogs
 */
function createStepLogger(prefix = '', sessionId = null) {
  const logs = [];
  
  const formatMessage = (level, ...args) => {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    
    return {
      timestamp,
      level,
      message: prefix ? `${prefix} ${message}` : message
    };
  };
  
  // Обёртка для вызова console.log с установкой контекста sessionId
  const logWithContext = (level, ...args) => {
    const entry = formatMessage(level, ...args);
    logs.push(entry);
    
    // Устанавливаем контекст sessionId для этого вызова
    if (sessionId) {
      logContext.run({ sessionId }, () => {
        if (level === 'error') {
          console.error(entry.message);
        } else if (level === 'warn') {
          console.warn(entry.message);
        } else {
          console.log(entry.message);
        }
      });
    } else {
      // Без sessionId - обычный вызов
      if (level === 'error') {
        console.error(entry.message);
      } else if (level === 'warn') {
        console.warn(entry.message);
      } else {
        console.log(entry.message);
      }
    }
  };
  
  return {
    /**
     * Логирование информационного сообщения
     */
    log(...args) {
      logWithContext('info', ...args);
    },
    
    /**
     * Логирование предупреждения
     */
    warn(...args) {
      logWithContext('warn', ...args);
    },
    
    /**
     * Логирование ошибки
     */
    error(...args) {
      logWithContext('error', ...args);
    },
    
    /**
     * Получить все собранные логи
     * @returns {Array} Массив объектов {timestamp, level, message}
     */
    getLogs() {
      return [...logs];
    },
    
    /**
     * Получить логи как массив строк (для совместимости)
     * @returns {Array<string>} Массив строк сообщений
     */
    getLogsAsStrings() {
      return logs.map(entry => `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`);
    },
    
    /**
     * Очистить логи
     */
    clear() {
      logs.length = 0;
    }
  };
}

module.exports = { createStepLogger };





