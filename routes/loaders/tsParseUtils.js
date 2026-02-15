// Общие утилиты для парсинга TypeScript/JavaScript/TSX файлов
// routes/loaders/tsParseUtils.js

/**
 * Поиск конца блока кода (с учётом вложенных скобок)
 * @param {string} text - Исходный текст
 * @param {number} startPos - Позиция начала поиска
 * @returns {number} Позиция конца блока или -1 если не найден
 */
function findBlockEnd(text, startPos) {
    let braceLevel = 0;
    let parenLevel = 0;
    let angleLevel = 0;
    let inString = false;
    let stringChar = null;
    let firstBraceFound = false;

    for (let i = startPos; i < text.length; i++) {
        const char = text[i];
        const prevChar = i > 0 ? text[i - 1] : '';

        // Обработка строк
        if (!inString && (char === '"' || char === "'" || char === '`')) {
            inString = true;
            stringChar = char;
            continue;
        }
        if (inString && char === stringChar && prevChar !== '\\') {
            inString = false;
            stringChar = null;
            continue;
        }
        if (inString) continue;

        // Подсчёт скобок
        if (char === '{') {
            braceLevel++;
            firstBraceFound = true;
        } else if (char === '}') {
            braceLevel--;
            if (firstBraceFound && braceLevel === 0) {
                return i + 1;
            }
        } else if (char === '(') {
            parenLevel++;
        } else if (char === ')') {
            parenLevel--;
        } else if (char === '<') {
            angleLevel++;
        } else if (char === '>') {
            angleLevel--;
        }
    }

    return -1; // Не найден конец
}

/**
 * Извлечение JSDoc/TSDoc комментария перед функцией/классом
 * @param {string[]} lines - Массив строк исходного кода
 * @param {number} startLineIndex - Индекс строки начала сущности
 * @returns {string|null} Текст комментария или null
 */
function extractDocComment(lines, startLineIndex) {
    const commentLines = [];
    let i = startLineIndex - 1;

    while (i >= 0) {
        const line = lines[i].trim();
        
        if (line === '') {
            i--;
            continue;
        }

        // Многострочный комментарий /* */ или /** */
        if (line.includes('*/')) {
            let j = i;
            while (j >= 0 && !lines[j].includes('/*')) {
                commentLines.unshift(lines[j]);
                j--;
            }
            if (j >= 0) {
                commentLines.unshift(lines[j]);
            }
            break;
        }

        // Однострочный комментарий //
        if (line.startsWith('//')) {
            commentLines.unshift(lines[i]);
            i--;
        } else {
            break;
        }
    }

    return commentLines
        .map(l => l.replace(/^\/\/\s?/, '').replace(/^\s*\*+\s?/, '').replace(/^\/\*\*?\s?/, '').replace(/\*\/\s*$/, '').trim())
        .filter(l => l.length > 0)
        .join('\n')
        .trim() || null;
}

/**
 * Чёрный список встроенных функций/методов для фильтрации L1 связей
 */
const BUILTIN_BLACKLIST = new Set([
    'console', 'log', 'error', 'warn', 'info', 'debug', 'trace', 'assert',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Number', 'String', 'Boolean',
    'Object', 'Array', 'Date', 'Math', 'JSON', 'Promise', 'Error', 'Map', 'Set', 'WeakMap', 'WeakSet',
    'require', 'module', 'exports', 'process', 'Buffer', 'global',
    'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
    'push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'concat', 'join', 'reverse', 'sort',
    'indexOf', 'lastIndexOf', 'includes', 'find', 'findIndex', 'filter', 'map', 'reduce', 'forEach',
    'keys', 'values', 'entries', 'assign', 'create', 'defineProperty', 'freeze', 'seal',
    'get', 'set', 'has', 'delete', 'clear', 'size',
    'then', 'catch', 'finally', 'all', 'race', 'resolve', 'reject',
    'async', 'await', 'this', 'super', 'new', 'typeof', 'instanceof',
    'query', 'querySync', 'exec', 'execSync', 'spawn', 'spawnSync'
]);

/**
 * Проверка, является ли имя функции встроенной (для фильтрации L1)
 * @param {string} name - Имя функции или метода
 * @returns {boolean}
 */
function isBuiltinFunction(name) {
    const parts = name.split('.');
    const simpleName = parts[parts.length - 1].toLowerCase();
    return BUILTIN_BLACKLIST.has(simpleName) || BUILTIN_BLACKLIST.has(name.toLowerCase());
}

module.exports = {
    findBlockEnd,
    extractDocComment,
    BUILTIN_BLACKLIST,
    isBuiltinFunction
};
