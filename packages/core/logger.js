const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(process.cwd(), 'logs');

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function getLogFilePath(prefix) {
  const date = new Date().toISOString().split('T')[0];
  return path.join(LOGS_DIR, `${prefix}-${date}.log`);
}

/**
 * Записать лог в файл
 * @param {string} level - Уровень (INFO, WARN, ERROR)
 * @param {string} context - Контекст/категория (SERVER, DB, NATURAL_QUERY, etc.)
 * @param {string} message - Сообщение
 */
function writeToFile(level, context, message) {
  const timestamp = new Date().toISOString();
  const ctx = context ? `[${context}] ` : '';
  const line = `${timestamp} [${level}] ${ctx}${message}\n`;

  try {
    const combinedPath = getLogFilePath('combined');
    fs.appendFileSync(combinedPath, line, 'utf8');

    if (level === 'ERROR') {
      const errorPath = getLogFilePath('error');
      fs.appendFileSync(errorPath, line, 'utf8');
    }
  } catch (err) {
    // Fallback: выводим в stderr если не удалось записать в файл
    process.stderr.write(`[LOGGER ERROR] Failed to write log: ${err.message}\n`);
  }
}

function formatMessage(message, args) {
  const formatted = args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
  return message + (formatted ? ' ' + formatted : '');
}

/**
 * Создать логгер с привязанным контекстом
 * @param {string} context - Контекст/категория
 * @returns {object} Логгер с методами info, warn, error
 */
function createLogger(context) {
  return {
    info: (message, ...args) => {
      const fullMsg = formatMessage(message, args);
      writeToFile('INFO', context, fullMsg);
      process.stdout.write(`[INFO] [${context}] ${fullMsg}\n`);
    },
    warn: (message, ...args) => {
      const fullMsg = formatMessage(message, args);
      writeToFile('WARN', context, fullMsg);
      process.stdout.write(`[WARN] [${context}] ${fullMsg}\n`);
    },
    error: (message, ...args) => {
      const fullMsg = formatMessage(message, args);
      writeToFile('ERROR', context, fullMsg);
      process.stderr.write(`[ERROR] [${context}] ${fullMsg}\n`);
    }
  };
}

// Дефолтный логгер
const logger = createLogger('APP');

module.exports = { logger, createLogger, writeToFile, LOGS_DIR };
