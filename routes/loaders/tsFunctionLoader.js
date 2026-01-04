// Загрузчик TypeScript функций, классов, интерфейсов и типов
// routes/loaders/tsFunctionLoader.js

const fs = require('fs');
const path = require('path');

/**
 * Поиск конца блока кода (с учётом вложенных скобок)
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
 * Парсинг TypeScript сущностей из контента
 */
function parseTsEntitiesFromContent(tsContent, filePath) {
    const entities = [];
    const lines = tsContent.split('\n');
    let processedRanges = [];

    // 1. Парсинг интерфейсов
    const interfaceRegex = /(?:export\s+)?interface\s+([a-zA-Z0-9_$]+)(?:<[^>]+>)?\s*(?:extends\s+[^{]+)?\{/g;
    let interfaceMatch;

    while ((interfaceMatch = interfaceRegex.exec(tsContent)) !== null) {
        const interfaceName = interfaceMatch[1];
        const interfaceStart = interfaceMatch.index;
        const interfaceEnd = findBlockEnd(tsContent, interfaceStart);

        if (interfaceEnd === -1) {
            console.warn(`[TS-Loader] Не найден конец интерфейса ${interfaceName}`);
            continue;
        }

        const interfaceBody = tsContent.substring(interfaceStart, interfaceEnd);
        const interfaceStartLine = tsContent.substring(0, interfaceStart).split('\n').length - 1;
        const comment = extractDocComment(lines, interfaceStartLine);

        // Извлекаем сигнатуру с дженериками
        const signatureMatch = interfaceBody.match(/interface\s+([a-zA-Z0-9_$]+(?:<[^>]+>)?)/);
        const signature = signatureMatch ? `interface ${signatureMatch[1]}` : `interface ${interfaceName}`;

        entities.push({
            full_name: interfaceName,
            sname: interfaceName,
            type: 'interface',
            comment: comment,
            signature: signature,
            body: interfaceBody
        });

        processedRanges.push({ start: interfaceStart, end: interfaceEnd });
    }

    // 2. Парсинг type алиасов
    const typeRegex = /(?:export\s+)?type\s+([a-zA-Z0-9_$]+)(?:<[^>]+>)?\s*=\s*/g;
    let typeMatch;

    while ((typeMatch = typeRegex.exec(tsContent)) !== null) {
        const typeName = typeMatch[1];
        const typeStart = typeMatch.index;
        
        // Ищем конец type (до ; или конца строки)
        let typeEnd = typeStart;
        let braceLevel = 0;
        let parenLevel = 0;
        let inString = false;
        let stringChar = null;

        for (let i = typeStart; i < tsContent.length; i++) {
            const char = tsContent[i];
            const prevChar = i > 0 ? tsContent[i - 1] : '';

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

            if (char === '{') braceLevel++;
            else if (char === '}') braceLevel--;
            else if (char === '(') parenLevel++;
            else if (char === ')') parenLevel--;
            else if (char === ';' && braceLevel === 0 && parenLevel === 0) {
                typeEnd = i + 1;
                break;
            }
        }

        if (typeEnd === typeStart) continue;

        const typeBody = tsContent.substring(typeStart, typeEnd);
        const typeStartLine = tsContent.substring(0, typeStart).split('\n').length - 1;
        const comment = extractDocComment(lines, typeStartLine);

        const signatureMatch = typeBody.match(/type\s+([a-zA-Z0-9_$]+(?:<[^>]+>)?)/);
        const signature = signatureMatch ? `type ${signatureMatch[1]}` : `type ${typeName}`;

        entities.push({
            full_name: typeName,
            sname: typeName,
            type: 'type',
            comment: comment,
            signature: signature,
            body: typeBody
        });

        processedRanges.push({ start: typeStart, end: typeEnd });
    }

    // 3. Парсинг enum
    const enumRegex = /(?:export\s+)?(?:const\s+)?enum\s+([a-zA-Z0-9_$]+)\s*\{/g;
    let enumMatch;

    while ((enumMatch = enumRegex.exec(tsContent)) !== null) {
        const enumName = enumMatch[1];
        const enumStart = enumMatch.index;
        const enumEnd = findBlockEnd(tsContent, enumStart);

        if (enumEnd === -1) continue;

        const enumBody = tsContent.substring(enumStart, enumEnd);
        const enumStartLine = tsContent.substring(0, enumStart).split('\n').length - 1;
        const comment = extractDocComment(lines, enumStartLine);

        entities.push({
            full_name: enumName,
            sname: enumName,
            type: 'enum',
            comment: comment,
            signature: `enum ${enumName}`,
            body: enumBody
        });

        processedRanges.push({ start: enumStart, end: enumEnd });
    }

    // 4. Парсинг классов (включая abstract)
    const classRegex = /(?:@\w+(?:\([^)]*\))?\s*)*(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z0-9_$]+)(?:<[^>]+>)?(?:\s+extends\s+[a-zA-Z0-9_$<>,\s]+)?(?:\s+implements\s+[a-zA-Z0-9_$<>,\s]+)?\s*\{/g;
    let classMatch;

    while ((classMatch = classRegex.exec(tsContent)) !== null) {
        const className = classMatch[1];
        const classStart = classMatch.index;
        const classEnd = findBlockEnd(tsContent, classStart);

        if (classEnd === -1) {
            console.warn(`[TS-Loader] Не найден конец класса ${className}`);
            continue;
        }

        const classBody = tsContent.substring(classStart, classEnd);
        const classStartLine = tsContent.substring(0, classStart).split('\n').length - 1;
        const comment = extractDocComment(lines, classStartLine);

        // Извлекаем полную сигнатуру
        const signatureMatch = classBody.match(/(?:abstract\s+)?class\s+([a-zA-Z0-9_$]+(?:<[^>]+>)?)/);
        const isAbstract = classBody.match(/abstract\s+class/) ? 'abstract ' : '';
        const signature = signatureMatch ? `${isAbstract}class ${signatureMatch[1]}` : `class ${className}`;

        entities.push({
            full_name: className,
            sname: className,
            type: 'class',
            comment: comment,
            signature: signature,
            body: classBody
        });

        processedRanges.push({ start: classStart, end: classEnd });
    }

    // 5. Парсинг обычных функций (с типами)
    const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)(?:<[^>]+>)?\s*\(/g;
    let funcMatch;

    while ((funcMatch = functionRegex.exec(tsContent)) !== null) {
        const funcName = funcMatch[1];
        const funcStart = funcMatch.index;
        
        const isProcessed = processedRanges.some(range => funcStart >= range.start && funcStart < range.end);
        if (isProcessed) continue;

        const funcEnd = findBlockEnd(tsContent, funcStart);
        if (funcEnd === -1) continue;

        const funcBody = tsContent.substring(funcStart, funcEnd);
        const funcStartLine = tsContent.substring(0, funcStart).split('\n').length - 1;
        const comment = extractDocComment(lines, funcStartLine);

        // Извлечение сигнатуры с параметрами и возвращаемым типом
        const signatureMatch = funcBody.match(/function\s+([a-zA-Z0-9_$]+(?:<[^>]+>)?)\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/);
        let signature = `function ${funcName}()`;
        if (signatureMatch) {
            const params = signatureMatch[2] || '';
            const returnType = signatureMatch[3] ? `: ${signatureMatch[3].trim()}` : '';
            signature = `function ${signatureMatch[1]}(${params})${returnType}`;
        }

        entities.push({
            full_name: funcName,
            sname: funcName,
            type: 'function',
            comment: comment,
            signature: signature,
            body: funcBody
        });

        processedRanges.push({ start: funcStart, end: funcEnd });
    }

    // 6. Парсинг arrow functions с типами
    const arrowFunctionRegex = /(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)(?:\s*:\s*[^=]+)?\s*=\s*(?:async\s+)?(?:<[^>]+>)?\s*\(([^)]*)\)(?:\s*:\s*([^=]+))?\s*=>/g;
    let arrowMatch;

    while ((arrowMatch = arrowFunctionRegex.exec(tsContent)) !== null) {
        const funcName = arrowMatch[1];
        const arrowStart = arrowMatch.index;
        
        const isProcessed = processedRanges.some(range => arrowStart >= range.start && arrowStart < range.end);
        if (isProcessed) continue;

        // Ищем конец arrow function
        let arrowEnd = arrowStart;
        let braceLevel = 0;
        let foundArrow = false;

        for (let i = arrowStart; i < tsContent.length; i++) {
            const char = tsContent[i];
            
            if (char === '{') {
                braceLevel++;
                foundArrow = true;
            } else if (char === '}') {
                braceLevel--;
                if (foundArrow && braceLevel === 0) {
                    arrowEnd = i + 1;
                    break;
                }
            } else if (char === ';' && braceLevel === 0 && foundArrow) {
                arrowEnd = i + 1;
                break;
            }
        }

        if (arrowEnd === arrowStart) continue;

        const arrowBody = tsContent.substring(arrowStart, arrowEnd);
        const arrowStartLine = tsContent.substring(0, arrowStart).split('\n').length - 1;
        const comment = extractDocComment(lines, arrowStartLine);

        const params = arrowMatch[2] || '';
        const returnType = arrowMatch[3] ? `: ${arrowMatch[3].trim()}` : '';
        const signature = `${funcName}(${params})${returnType} =>`;

        entities.push({
            full_name: funcName,
            sname: funcName,
            type: 'arrow',
            comment: comment,
            signature: signature,
            body: arrowBody
        });

        processedRanges.push({ start: arrowStart, end: arrowEnd });
    }

    // 7. Парсинг методов классов
    for (const classEntity of entities.filter(e => e.type === 'class')) {
        const classBody = classEntity.body;
        const className = classEntity.full_name;

        // Методы с модификаторами доступа и декораторами
        const methodRegex = /(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|private|protected|static|readonly|async)\s+)*([a-zA-Z0-9_$]+)(?:<[^>]+>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?\s*\{/g;
        let methodMatch;

        while ((methodMatch = methodRegex.exec(classBody)) !== null) {
            const methodName = methodMatch[1];
            
            // Пропускаем constructor и служебные слова
            if (['constructor', 'if', 'for', 'while', 'switch', 'catch', 'get', 'set'].includes(methodName)) {
                continue;
            }

            const methodStart = classBody.indexOf(methodMatch[0], methodMatch.index);
            const methodEnd = findBlockEnd(classBody, methodStart);

            if (methodEnd === -1) continue;

            const methodBody = classBody.substring(methodStart, methodEnd);
            const methodStartLine = classBody.substring(0, methodStart).split('\n').length - 1;
            const classLines = classBody.split('\n');
            const comment = extractDocComment(classLines, methodStartLine);

            const params = methodMatch[2] || '';
            const returnType = methodMatch[3] ? `: ${methodMatch[3].trim()}` : '';
            const signature = `${className}.${methodName}(${params})${returnType}`;

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
 * Извлечение связей L1 из TypeScript кода
 */
async function parseTsFunctionL1(code) {
    // Удаление комментариев
    let cleaned = code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

    const calledFunctions = new Set();
    const imports = new Set();
    const typeImports = new Set();

    // Чёрный список
    const blacklist = new Set([
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
        'async', 'await', 'this', 'super', 'new', 'typeof', 'instanceof'
    ]);

    // 1. Импорты ES6: import ... from '...'
    const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
    let importMatch;
    while ((importMatch = importRegex.exec(cleaned)) !== null) {
        imports.add(importMatch[1]);
    }

    // 2. Type импорты: import type { ... } from '...'
    const typeImportRegex = /import\s+type\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/g;
    let typeImportMatch;
    while ((typeImportMatch = typeImportRegex.exec(cleaned)) !== null) {
        typeImports.add(typeImportMatch[1]);
    }

    // 3. Вызовы функций
    const funcCallRegex = /(?:^|[^a-zA-Z0-9_$.])([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*)\s*(?:<[^>]*>)?\s*\(/g;
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
        type_imports: Array.from(typeImports).sort()
    };
}

/**
 * Загрузка TypeScript сущностей из файла
 */
async function loadTsFunctionsFromFile(filePath, contextCode, dbService, pipelineState = null) {
    const filename = path.basename(filePath);
    console.log(`[TS-Loader] Обработка файла: ${filename}`);

    const report = {
        filename: filename,
        fileId: null,
        isNew: false,
        functionsFound: 0,
        functionsProcessed: 0,
        functions: [],
        errors: []
    };

    let tsContent;
    try {
        tsContent = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        const errorMsg = `Не удалось прочитать файл ${filename}: ${err.message}`;
        console.error(`[TS-Loader] ${errorMsg}`);
        report.errors.push(errorMsg);
        return report;
    }

    const entities = parseTsEntitiesFromContent(tsContent, filePath);
    report.functionsFound = entities.length;

    if (entities.length === 0) {
        console.log(`[TS-Loader] Нет сущностей в ${filename}`);
        return report;
    }

    console.log(`[TS-Loader] Найдено сущностей: ${entities.length}`);

    // Регистрация файла
    try {
        const { id: fileId, isNew } = await dbService.saveFileInfo(filename, tsContent, filePath, contextCode);
        report.fileId = fileId;
        report.isNew = isNew;
        console.log(`[TS-Loader] Файл зарегистрирован: fileId = ${fileId}, isNew = ${isNew}`);
    } catch (err) {
        const errorMsg = `Не удалось зарегистрировать файл ${filename}: ${err.message}`;
        console.error(`[TS-Loader] ${errorMsg}`);
        report.errors.push(errorMsg);
        return report;
    }

    // Загрузка каждой сущности
    for (const entity of entities) {
        console.log(`[TS-Loader] → Сущность: ${entity.full_name} (${entity.sname}, тип: ${entity.type})`);

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
            const aiItem = await dbService.createAiItem({
                full_name: entity.full_name,
                contextCode: contextCode,
                type: entity.type,
                sName: entity.sname,
                fileId: report.fileId
            });

            if (!aiItem || !aiItem.id) {
                const errorMsg = `Не удалось создать AI Item для ${entity.full_name}`;
                console.error(`[TS-Loader] ${errorMsg}`);
                entityReport.errors.push(errorMsg);
                report.functions.push(entityReport);
                continue;
            }

            entityReport.aiItemId = aiItem.id;

            const chunkContentL0 = {
                full_name: entity.full_name,
                s_name: entity.sname,
                signature: entity.signature,
                body: entity.body
            };

            const chunkContent = { text: chunkContentL0 };
            if (entity.comment && typeof entity.comment === 'string' && entity.comment.trim()) {
                chunkContent.comment = entity.comment.trim();
            }

            try {
                const chunkIdL0 = await dbService.saveChunkVector(
                    report.fileId,
                    chunkContent,
                    null,
                    {
                        type: entity.type,
                        level: '0-исходник',
                        full_name: entity.full_name,
                        s_name: entity.sname
                    },
                    null,
                    contextCode
                );

                entityReport.chunkL0Id = chunkIdL0;

                await dbService.pgClient.query(
                    'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
                    [entityReport.aiItemId, chunkIdL0]
                );

                console.log(`[TS-Loader] Чанк 0 сохранён: chunkId = ${chunkIdL0}`);

                // Парсинг L1 только для функций, методов и классов
                if (['function', 'method', 'arrow', 'class'].includes(entity.type)) {
                    try {
                        const l1Result = await parseTsFunctionL1(entity.body);
                        entityReport.l1Parsed = true;
                        entityReport.l1CalledFunctions = l1Result.called_functions || [];
                        console.log(`[TS-Loader] Успешно построен L1 для ${entity.full_name}`);

                        const chunkIdL1 = await dbService.saveChunkVector(
                            report.fileId,
                            { text: l1Result },
                            null,
                            {
                                type: 'json',
                                level: '1-связи',
                                full_name: entity.full_name,
                                s_name: entity.sname
                            },
                            chunkIdL0,
                            contextCode
                        );

                        entityReport.chunkL1Id = chunkIdL1;

                        await dbService.pgClient.query(
                            'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
                            [entityReport.aiItemId, chunkIdL1]
                        );

                        console.log(`[TS-Loader] Чанк 1 (связи) сохранён: chunkId = ${chunkIdL1}`);
                    } catch (err) {
                        const errorMsg = `Ошибка парсинга L1 для ${entity.full_name}: ${err.message}`;
                        console.error(`[TS-Loader] ${errorMsg}`);
                        entityReport.errors.push(errorMsg);
                    }
                }
            } catch (err) {
                const errorMsg = `Ошибка сохранения чанка L0 для ${entity.full_name}: ${err.message}`;
                console.error(`[TS-Loader] ${errorMsg}`);
                entityReport.errors.push(errorMsg);
            }
        } catch (err) {
            const errorMsg = `Ошибка при обработке сущности ${entity.full_name}: ${err.message}`;
            console.error(`[TS-Loader] ${errorMsg}`);
            entityReport.errors.push(errorMsg);
        }

        if (entityReport.aiItemId && entityReport.chunkL0Id) {
            report.functionsProcessed++;
        }

        report.functions.push(entityReport);
    }

    console.log(`[TS-Loader] Файл ${filename} успешно обработан`);
    return report;
}

module.exports = {
    parseTsFunctionL1,
    parseTsEntitiesFromContent,
    loadTsFunctionsFromFile
};


