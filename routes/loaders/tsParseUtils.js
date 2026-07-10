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
    let firstBraceFound = false;
    let inString = false;
    let stringChar = null;
    let inLineComment = false;
    let inBlockComment = false;
    let inRegex = false;
    let inRegexClass = false;
    // Последний значащий символ вне строк/комментариев/regex —
    // нужен, чтобы отличить деление (a / b) от начала regex-литерала (/['"]/)
    let lastSig = null;
    const REGEX_ALLOWED_BEFORE = new Set(['(', '[', '{', '=', ',', ';', ':', '!', '&', '|', '?', '+', '-', '*', '%', '<', '>', '~', '^']);

    for (let i = startPos; i < text.length; i++) {
        const char = text[i];
        const nextChar = i + 1 < text.length ? text[i + 1] : '';

        // --- Комментарии: кавычки и скобки внутри них не считаются
        // (иначе апостроф в комментарии типа "// link'и" ломает подсчёт)
        if (inLineComment) {
            if (char === '\n') inLineComment = false;
            continue;
        }
        if (inBlockComment) {
            if (char === '*' && nextChar === '/') {
                inBlockComment = false;
                i++; // пропускаем '/'
            }
            continue;
        }

        // --- Строки (escape обрабатываем пропуском следующего символа)
        if (inString) {
            if (char === '\\') { i++; continue; }
            if (char === stringChar) { inString = false; stringChar = null; lastSig = '"'; }
            continue;
        }

        // --- Regex-литералы: /['"}(]/ и т.п. не должны включать строковый режим и счёт скобок
        if (inRegex) {
            if (char === '\\') { i++; continue; }
            if (char === '[') { inRegexClass = true; continue; }
            if (char === ']') { inRegexClass = false; continue; }
            if (char === '/' && !inRegexClass) { inRegex = false; lastSig = 'r'; }
            continue;
        }

        if (char === '/' && nextChar === '/') { inLineComment = true; i++; continue; }
        if (char === '/' && nextChar === '*') { inBlockComment = true; i++; continue; }
        if (char === '/') {
            // regex или деление? Regex возможен только в позиции выражения
            let regexPossible = lastSig === null || REGEX_ALLOWED_BEFORE.has(lastSig);
            if (!regexPossible && /[a-zA-Z]/.test(lastSig)) {
                // после ключевого слова (return /x/.test(...)) regex тоже возможен
                const before = text.slice(Math.max(0, i - 12), i);
                const wordMatch = before.match(/([a-zA-Z_$]+)\s*$/);
                const KEYWORDS = ['return', 'case', 'typeof', 'do', 'else', 'in', 'of', 'instanceof', 'new', 'void', 'delete', 'yield', 'await'];
                if (wordMatch && KEYWORDS.includes(wordMatch[1])) regexPossible = true;
            }
            if (regexPossible) {
                inRegex = true;
                inRegexClass = false;
                continue;
            }
            lastSig = '/';
            continue;
        }

        if (char === '"' || char === "'" || char === '`') {
            inString = true;
            stringChar = char;
            continue;
        }

        // --- Подсчёт скобок.
        // Фигурные скобки внутри круглых не открывают блок:
        // иначе default-параметр вида (options = {}) немедленно "закрывает" функцию.
        if (char === '(') {
            parenLevel++;
        } else if (char === ')') {
            parenLevel = Math.max(0, parenLevel - 1);
        } else if (char === '{') {
            if (parenLevel === 0 || firstBraceFound) {
                braceLevel++;
                firstBraceFound = true;
            }
        } else if (char === '}') {
            if (firstBraceFound) {
                braceLevel--;
                if (braceLevel === 0) {
                    return i + 1;
                }
            }
        }

        if (!/\s/.test(char)) lastSig = char;
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
