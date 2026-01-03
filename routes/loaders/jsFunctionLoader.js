// Загрузчик JavaScript функций и классов
// routes/loaders/jsFunctionLoader.js

const fs = require('fs');
const path = require('path');

/**
 * Поиск конца блока кода (с учётом вложенных скобок)
 */
function findBlockEnd(text, startPos) {
    let braceLevel = 0;
    let parenLevel = 0;
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
        }
    }

    return -1; // Не найден конец
}

/**
 * Извлечение JSDoc комментария перед функцией/классом
 */
function extractJSDocComment(lines, startLineIndex) {
    const commentLines = [];
    let i = startLineIndex - 1;

    // Ищем комментарии вверх от начала функции
    while (i >= 0) {
        const line = lines[i].trim();
        
        if (line === '') {
            i--;
            continue;
        }

        // Многострочный комментарий /* */
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
        .map(l => l.replace(/^\/\/\s?/, '').replace(/^\s*\*+\s?/, '').trim())
        .filter(l => l.length > 0)
        .join('\n')
        .trim() || null;
}

/**
 * Парсинг JavaScript функций и классов из контента
 */
function parseJsEntitiesFromContent(jsContent, filePath) {
    const entities = [];
    const lines = jsContent.split('\n');
    let pendingCommentLines = [];
    let processedRanges = []; // Для отслеживания обработанных диапазонов (чтобы не парсить методы дважды)

    // 1. Парсинг классов
    const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z0-9_$]+)\s*(?:extends\s+[a-zA-Z0-9_$.]+\s*)?\{/g;
    let classMatch;

    while ((classMatch = classRegex.exec(jsContent)) !== null) {
        const className = classMatch[1];
        const classStart = classMatch.index;
        const classEnd = findBlockEnd(jsContent, classStart);

        if (classEnd === -1) {
            console.warn(`[JS-Loader] Не найден конец класса ${className}`);
            continue;
        }

        const classBody = jsContent.substring(classStart, classEnd);
        const classStartLine = jsContent.substring(0, classStart).split('\n').length - 1;
        const comment = extractJSDocComment(lines, classStartLine) || 
                       (pendingCommentLines.length > 0 ? pendingCommentLines.join('\n').trim() : null);

        entities.push({
            full_name: className,
            sname: className,
            type: 'class',
            comment: comment,
            signature: `class ${className}`,
            body: classBody
        });

        processedRanges.push({ start: classStart, end: classEnd });
        pendingCommentLines = [];
    }

    // 2. Парсинг обычных функций
    const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(/g;
    let funcMatch;

    while ((funcMatch = functionRegex.exec(jsContent)) !== null) {
        const funcName = funcMatch[1];
        const funcStart = funcMatch.index;
        
        // Пропускаем если функция внутри уже обработанного класса
        const isProcessed = processedRanges.some(range => funcStart >= range.start && funcStart < range.end);
        if (isProcessed) {
            continue;
        }

        const funcEnd = findBlockEnd(jsContent, funcStart);
        if (funcEnd === -1) {
            console.warn(`[JS-Loader] Не найден конец функции ${funcName}`);
            continue;
        }

        const funcBody = jsContent.substring(funcStart, funcEnd);
        const funcStartLine = jsContent.substring(0, funcStart).split('\n').length - 1;
        const comment = extractJSDocComment(lines, funcStartLine) || 
                       (pendingCommentLines.length > 0 ? pendingCommentLines.join('\n').trim() : null);

        // Извлечение сигнатуры
        const signatureMatch = funcBody.match(/function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)/);
        const signature = signatureMatch ? `function ${funcName}(${signatureMatch[2]})` : `function ${funcName}()`;

        entities.push({
            full_name: funcName,
            sname: funcName,
            type: 'function',
            comment: comment,
            signature: signature,
            body: funcBody
        });

        pendingCommentLines = [];
    }

    // 3. Парсинг arrow functions (const name = ...)
    const arrowFunctionRegex = /(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/g;
    let arrowMatch;

    while ((arrowMatch = arrowFunctionRegex.exec(jsContent)) !== null) {
        const funcName = arrowMatch[1];
        const arrowStart = arrowMatch.index;
        
        // Пропускаем если внутри обработанного класса
        const isProcessed = processedRanges.some(range => arrowStart >= range.start && arrowStart < range.end);
        if (isProcessed) {
            continue;
        }

        // Ищем конец выражения (до точки с запятой или новой строки после блока)
        let arrowEnd = arrowStart;
        let braceLevel = 0;
        let parenLevel = 0;
        let inString = false;
        let stringChar = null;
        let foundArrow = false;

        for (let i = arrowStart; i < jsContent.length; i++) {
            const char = jsContent[i];
            const prevChar = i > 0 ? jsContent[i - 1] : '';

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

            if (char === '{') {
                braceLevel++;
                foundArrow = true;
            } else if (char === '}') {
                braceLevel--;
                if (foundArrow && braceLevel === 0) {
                    arrowEnd = i + 1;
                    break;
                }
            } else if (char === '(') {
                parenLevel++;
            } else if (char === ')') {
                parenLevel--;
            } else if (braceLevel === 0 && parenLevel === 0 && char === ';' && foundArrow) {
                arrowEnd = i + 1;
                break;
            } else if (braceLevel === 0 && parenLevel === 0 && char === '\n' && foundArrow) {
                // Для однострочных arrow functions без блока
                arrowEnd = i;
                break;
            }
        }

        if (arrowEnd === arrowStart) {
            continue;
        }

        const arrowBody = jsContent.substring(arrowStart, arrowEnd);
        const arrowStartLine = jsContent.substring(0, arrowStart).split('\n').length - 1;
        const comment = extractJSDocComment(lines, arrowStartLine) || 
                       (pendingCommentLines.length > 0 ? pendingCommentLines.join('\n').trim() : null);

        const params = arrowMatch[2] || '';
        entities.push({
            full_name: funcName,
            sname: funcName,
            type: 'arrow',
            comment: comment,
            signature: `${funcName}(${params}) =>`,
            body: arrowBody
        });

        pendingCommentLines = [];
    }

    // 4. Парсинг методов классов
    for (const classEntity of entities.filter(e => e.type === 'class')) {
        const classBody = classEntity.body;
        const className = classEntity.full_name;

        // Методы класса: methodName(...) { или methodName = (...) => {
        const methodRegex = /(?:async\s+)?([a-zA-Z0-9_$]+)\s*(?:\(([^)]*)\)|=\s*(?:async\s+)?\(([^)]*)\)\s*=>)\s*\{/g;
        let methodMatch;

        while ((methodMatch = methodRegex.exec(classBody)) !== null) {
            const methodName = methodMatch[1];
            const params = methodMatch[2] || methodMatch[3] || '';
            const methodStart = classBody.indexOf(methodMatch[0], methodMatch.index);
            const methodEnd = findBlockEnd(classBody, methodStart);

            if (methodEnd === -1) {
                continue;
            }

            const methodBody = classBody.substring(methodStart, methodEnd);
            const methodStartLine = classBody.substring(0, methodStart).split('\n').length - 1;
            const classLines = classBody.split('\n');
            const comment = extractJSDocComment(classLines, methodStartLine);

            const isArrow = methodMatch[0].includes('=>');
            const signature = isArrow 
                ? `${className}.${methodName}(${params}) =>`
                : `${className}.${methodName}(${params})`;

            entities.push({
                full_name: `${className}.${methodName}`,
                sname: methodName,
                type: 'method',
                comment: comment,
                signature: signature,
                body: methodBody
            });
        }
    }

    return entities;
}

/**
 * Извлечение связей L1 из JavaScript кода
 */
async function parseJsFunctionL1(code) {
    // Удаление комментариев
    let cleaned = code
        .replace(/\/\*[\s\S]*?\*\//g, '')   // /* ... */
        .replace(/\/\/.*$/gm, '')           // // ...
        .replace(/\/\*[\s\S]*?\*\//g, '');  // ещё раз для вложенных

    // Множества для результатов
    const calledFunctions = new Set();
    const imports = new Set();
    const requires = new Set();

    // Чёрный список встроенных функций/методов
    const blacklist = new Set([
        'console', 'log', 'error', 'warn', 'info', 'debug', 'trace', 'assert',
        'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
        'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Number', 'String', 'Boolean',
        'Object', 'Array', 'Date', 'Math', 'JSON', 'Promise', 'Error',
        'require', 'module', 'exports', 'process', 'Buffer', 'global',
        'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
        'push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'concat', 'join', 'reverse', 'sort',
        'indexOf', 'lastIndexOf', 'includes', 'find', 'findIndex', 'filter', 'map', 'reduce', 'forEach',
        'keys', 'values', 'entries', 'assign', 'create', 'defineProperty', 'freeze', 'seal',
        'get', 'set', 'has', 'delete', 'clear', 'size', 'forEach',
        'then', 'catch', 'finally', 'all', 'race', 'resolve', 'reject',
        'query', 'querySync', 'exec', 'execSync', 'spawn', 'spawnSync'
    ]);

    // 1. Импорты ES6: import ... from '...'
    const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
    let importMatch;
    while ((importMatch = importRegex.exec(cleaned)) !== null) {
        imports.add(importMatch[1]);
    }

    // 2. require(): require('...')
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let requireMatch;
    while ((requireMatch = requireRegex.exec(cleaned)) !== null) {
        requires.add(requireMatch[1]);
    }

    // 3. Вызовы функций: funcName(...) или obj.method(...)
    // Исключаем вызовы встроенных методов
    const funcCallRegex = /(?:^|[^a-zA-Z0-9_$.])([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*)\s*\(/g;
    let funcMatch;
    while ((funcMatch = funcCallRegex.exec(cleaned)) !== null) {
        const fullName = funcMatch[1];
        const parts = fullName.split('.');
        const simpleName = parts[parts.length - 1].toLowerCase();

        if (!blacklist.has(simpleName) && !blacklist.has(fullName.toLowerCase())) {
            calledFunctions.add(fullName);
        }
    }

    return {
        called_functions: Array.from(calledFunctions).sort(),
        imports: Array.from(imports).sort(),
        requires: Array.from(requires).sort()
    };
}

/**
 * Загрузка JavaScript функций и классов из файла
 */
async function loadJsFunctionsFromFile(filePath, contextCode, dbService, pipelineState = null) {
    const filename = path.basename(filePath);
    console.log(`[JS-Loader] Обработка файла: ${filename}`);

    // Инициализация отчета
    const report = {
        filename: filename,
        fileId: null,
        isNew: false,
        functionsFound: 0,
        functionsProcessed: 0,
        functions: [],
        errors: []
    };

    let jsContent;
    try {
        jsContent = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        const errorMsg = `Не удалось прочитать файл ${filename}: ${err.message}`;
        console.error(`[JS-Loader] ${errorMsg}`);
        report.errors.push(errorMsg);
        return report;
    }

    const entities = parseJsEntitiesFromContent(jsContent, filePath);
    report.functionsFound = entities.length;

    if (entities.length === 0) {
        console.log(`[JS-Loader] Нет функций или классов в ${filename}`);
        return report;
    }

    console.log(`[JS-Loader] Найдено сущностей: ${entities.length}`);

    // Регистрация файла
    try {
        const { id: fileId, isNew } = await dbService.saveFileInfo(filename, jsContent, filePath, contextCode);
        report.fileId = fileId;
        report.isNew = isNew;
        console.log(`[JS-Loader] Файл зарегистрирован: fileId = ${fileId}, isNew = ${isNew}`);
    } catch (err) {
        const errorMsg = `Не удалось зарегистрировать файл ${filename}: ${err.message}`;
        console.error(`[JS-Loader] ${errorMsg}`);
        report.errors.push(errorMsg);
        return report;
    }

    // Загрузка каждой сущности
    for (const entity of entities) {
        console.log(`[JS-Loader] → Сущность: ${entity.full_name} (${entity.sname}, тип: ${entity.type})`);

        const entityReport = {
            full_name: entity.full_name,
            sname: entity.sname,
            type: entity.type,
            aiItemId: null,
            chunkL0Id: null,
            chunkL1Id: null,
            l1Parsed: false,
            l1CalledFunctions: [],
            errors: []
        };

        try {
            // Создание AI Item
            const aiItem = await dbService.createAiItem({
                full_name: entity.full_name,
                contextCode: contextCode,
                type: entity.type,
                sName: entity.sname,
                fileId: report.fileId
            });

            if (!aiItem || !aiItem.id) {
                const errorMsg = `Не удалось создать AI Item для ${entity.full_name}`;
                console.error(`[JS-Loader] ${errorMsg}`);
                entityReport.errors.push(errorMsg);
                report.functions.push(entityReport);
                continue;
            }

            entityReport.aiItemId = aiItem.id;

            // Сохранение чанка уровня 0
            const chunkContentL0 = {
                full_name: entity.full_name,
                s_name: entity.sname,
                signature: entity.signature,
                body: entity.body
            };

            // Формируем chunkContent с comment на верхнем уровне
            const chunkContent = {
                text: chunkContentL0
            };
            if (entity.comment && typeof entity.comment === 'string' && entity.comment.trim()) {
                chunkContent.comment = entity.comment.trim();
            }

            try {
                const chunkIdL0 = await dbService.saveChunkVector(
                    report.fileId,
                    chunkContent,
                    null, // без embedding
                    {
                        type: entity.type,
                        level: '0-исходник',
                        full_name: entity.full_name,
                        s_name: entity.sname
                    },
                    null, // parentChunkId
                    contextCode
                );

                entityReport.chunkL0Id = chunkIdL0;

                // Привязываем чанк к AI Item
                await dbService.pgClient.query(
                    'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
                    [entityReport.aiItemId, chunkIdL0]
                );

                console.log(`[JS-Loader] Чанк 0 сохранён: chunkId = ${chunkIdL0}`);

                // Парсинг L1 (связи)
                try {
                    const l1Result = await parseJsFunctionL1(entity.body);
                    entityReport.l1Parsed = true;
                    entityReport.l1CalledFunctions = l1Result.called_functions || [];
                    console.log(`[JS-Loader] Успешно построен L1 для ${entity.full_name}`);

                    // Сохранение чанка уровня 1 (связи)
                    const chunkIdL1 = await dbService.saveChunkVector(
                        report.fileId,
                        { text: l1Result },
                        null, // без embedding
                        {
                            type: 'json',
                            level: '1-связи',
                            full_name: entity.full_name,
                            s_name: entity.sname
                        },
                        chunkIdL0, // parentChunkId
                        contextCode
                    );

                    entityReport.chunkL1Id = chunkIdL1;

                    // Привязываем чанк L1 к AI Item
                    await dbService.pgClient.query(
                        'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
                        [entityReport.aiItemId, chunkIdL1]
                    );

                    console.log(`[JS-Loader] Чанк 1 (связи) сохранён: chunkId = ${chunkIdL1}`);
                } catch (err) {
                    const errorMsg = `Ошибка парсинга L1 для ${entity.full_name}: ${err.message}`;
                    console.error(`[JS-Loader] ${errorMsg}`);
                    entityReport.errors.push(errorMsg);
                }
            } catch (err) {
                const errorMsg = `Ошибка сохранения чанка L0 для ${entity.full_name}: ${err.message}`;
                console.error(`[JS-Loader] ${errorMsg}`);
                entityReport.errors.push(errorMsg);
            }
        } catch (err) {
            const errorMsg = `Ошибка при обработке сущности ${entity.full_name}: ${err.message}`;
            console.error(`[JS-Loader] ${errorMsg}`);
            entityReport.errors.push(errorMsg);
        }

        // Если сущность обработана успешно (есть aiItemId и chunkL0Id), увеличиваем счетчик
        if (entityReport.aiItemId && entityReport.chunkL0Id) {
            report.functionsProcessed++;
        }

        report.functions.push(entityReport);
    }

    console.log(`[JS-Loader] Файл ${filename} успешно обработан`);
    return report;
}

module.exports = {
    parseJsFunctionL1,
    parseJsEntitiesFromContent,
    loadJsFunctionsFromFile
};

