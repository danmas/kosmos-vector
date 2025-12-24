// Утилита для сбора логов во время выполнения шагов pipeline
// routes/pipeline/stepLogger.js

/**
 * Создаёт логгер, который собирает все сообщения в массив
 * и одновременно выводит их в консоль
 * 
 * @param {string} prefix - Префикс для логов (например, '[Step1]')
 * @returns {object} Объект с методами log, warn, error и getLogs
 */
function createStepLogger(prefix = '') {
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
  
  return {
    /**
     * Логирование информационного сообщения
     */
    log(...args) {
      const entry = formatMessage('info', ...args);
      logs.push(entry);
      console.log(entry.message);
    },
    
    /**
     * Логирование предупреждения
     */
    warn(...args) {
      const entry = formatMessage('warn', ...args);
      logs.push(entry);
      console.warn(entry.message);
    },
    
    /**
     * Логирование ошибки
     */
    error(...args) {
      const entry = formatMessage('error', ...args);
      logs.push(entry);
      console.error(entry.message);
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





