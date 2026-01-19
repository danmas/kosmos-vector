// Загрузчик PHP функций, классов, traits и интерфейсов
// routes/loaders/phpFunctionLoader.js

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
        const nextChar = i < text.length - 1 ? text[i + 1] : '';

        // Обработка строк
        if (!inString && (char === '"' || char === "'")) {
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
 * Извлечение PHPDoc комментария перед функцией/классом
 */
function extractPhpDocComment(lines, startLineIndex) {
    const commentLines = [];
    let i = startLineIndex - 1;

    // Ищем комментарии вверх от начала функции
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
 * Парсинг PHP сущностей из контента
 */
function parsePhpEntitiesFromContent(phpContent, filePath) {
    const entities = [];
    const lines = phpContent.split('\n');
    let processedRanges = [];

    // 1. Парсинг интерфейсов
    const interfaceRegex = /(?:abstract\s+)?interface\s+([a-zA-Z0-9_$]+)\s*(?:extends\s+[^{]+)?\{/g;
    let interfaceMatch;

    while ((interfaceMatch = interfaceRegex.exec(phpContent)) !== null) {
        const interfaceName = interfaceMatch[1];
        const interfaceStart = interfaceMatch.index;
        const interfaceEnd = findBlockEnd(phpContent, interfaceStart);

        if (interfaceEnd === -1) {
            console.warn(`[PHP-Loader] Не найден конец интерфейса ${interfaceName}`);
            continue;
        }

        const interfaceBody = phpContent.substring(interfaceStart, interfaceEnd);
        const interfaceStartLine = phpContent.substring(0, interfaceStart).split('\n').length - 1;
        const comment = extractPhpDocComment(lines, interfaceStartLine);

        const signatureMatch = interfaceBody.match(/interface\s+([a-zA-Z0-9_$]+)/);
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

    // 2. Парсинг traits
    const traitRegex = /trait\s+([a-zA-Z0-9_$]+)\s*\{/g;
    let traitMatch;

    while ((traitMatch = traitRegex.exec(phpContent)) !== null) {
        const traitName = traitMatch[1];
        const traitStart = traitMatch.index;
        const traitEnd = findBlockEnd(phpContent, traitStart);

        if (traitEnd === -1) {
            console.warn(`[PHP-Loader] Не найден конец trait ${traitName}`);
            continue;
        }

        const traitBody = phpContent.substring(traitStart, traitEnd);
        const traitStartLine = phpContent.substring(0, traitStart).split('\n').length - 1;
        const comment = extractPhpDocComment(lines, traitStartLine);

        entities.push({
            full_name: traitName,
            sname: traitName,
            type: 'trait',
            comment: comment,
            signature: `trait ${traitName}`,
            body: traitBody
        });

        processedRanges.push({ start: traitStart, end: traitEnd });
    }

    // 3. Парсинг классов (включая abstract и final)
    const classRegex = /(?:abstract\s+|final\s+)?class\s+([a-zA-Z0-9_$]+)(?:\s+extends\s+[a-zA-Z0-9_$\\]+)?(?:\s+implements\s+[^{]+)?\s*\{/g;
    let classMatch;

    while ((classMatch = classRegex.exec(phpContent)) !== null) {
        const className = classMatch[1];
        const classStart = classMatch.index;
        const classEnd = findBlockEnd(phpContent, classStart);

        if (classEnd === -1) {
            console.warn(`[PHP-Loader] Не найден конец класса ${className}`);
            continue;
        }

        const classBody = phpContent.substring(classStart, classEnd);
        const classStartLine = phpContent.substring(0, classStart).split('\n').length - 1;
        const comment = extractPhpDocComment(lines, classStartLine);

        // Извлекаем полную сигнатуру
        const signatureMatch = classBody.match(/(?:abstract\s+|final\s+)?class\s+([a-zA-Z0-9_$]+)/);
        const isAbstract = classBody.match(/abstract\s+class/) ? 'abstract ' : '';
        const isFinal = classBody.match(/final\s+class/) ? 'final ' : '';
        const signature = signatureMatch ? `${isAbstract}${isFinal}class ${signatureMatch[1]}` : `class ${className}`;

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

    // 4. Парсинг обычных функций (вне классов)
    const functionRegex = /function\s+([a-zA-Z0-9_$]+)\s*\(/g;
    let funcMatch;

    while ((funcMatch = functionRegex.exec(phpContent)) !== null) {
        const funcName = funcMatch[1];
        const funcStart = funcMatch.index;
        
        // Пропускаем если функция внутри уже обработанного класса/trait/interface
        const isProcessed = processedRanges.some(range => funcStart >= range.start && funcStart < range.end);
        if (isProcessed) {
            continue;
        }

        const funcEnd = findBlockEnd(phpContent, funcStart);
        if (funcEnd === -1) {
            console.warn(`[PHP-Loader] Не найден конец функции ${funcName}`);
            continue;
        }

        const funcBody = phpContent.substring(funcStart, funcEnd);
        const funcStartLine = phpContent.substring(0, funcStart).split('\n').length - 1;
        const comment = extractPhpDocComment(lines, funcStartLine);

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

        processedRanges.push({ start: funcStart, end: funcEnd });
    }

    // 5. Парсинг методов классов и traits
    for (const classEntity of entities.filter(e => e.type === 'class' || e.type === 'trait')) {
        const classBody = classEntity.body;
        const className = classEntity.full_name;

        // Методы класса: (public|protected|private)? (static)? function methodName(...)
        // Поддержка различных порядков модификаторов
        const methodRegex = /(?:(?:public|protected|private|static|abstract|final)\s+)*(?:public|protected|private)?\s*(?:static\s+)?(?:abstract\s+)?(?:final\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)/g;
        let methodMatch;

        while ((methodMatch = methodRegex.exec(classBody)) !== null) {
            const methodName = methodMatch[1];
            
            // Пропускаем магические методы (но можно оставить __construct)
            if (methodName.startsWith('__') && methodName !== '__construct') {
                continue;
            }

            const params = methodMatch[2] || '';
            const methodStart = classBody.indexOf(methodMatch[0], methodMatch.index);
            const methodEnd = findBlockEnd(classBody, methodStart);

            if (methodEnd === -1) {
                continue;
            }

            const methodBody = classBody.substring(methodStart, methodEnd);
            const methodStartLine = classBody.substring(0, methodStart).split('\n').length - 1;
            const classLines = classBody.split('\n');
            const comment = extractPhpDocComment(classLines, methodStartLine);

            // Определяем модификаторы доступа из полного совпадения
            const fullMatch = methodMatch[0];
            const isPublic = fullMatch.includes('public') || (!fullMatch.includes('protected') && !fullMatch.includes('private'));
            const isProtected = fullMatch.includes('protected');
            const isPrivate = fullMatch.includes('private');
            const isStatic = fullMatch.includes('static');
            const isAbstract = fullMatch.includes('abstract');
            const isFinal = fullMatch.includes('final');
            
            let visibility = 'public';
            if (isPrivate) visibility = 'private';
            else if (isProtected) visibility = 'protected';
            
            const modifiers = [];
            if (isAbstract) modifiers.push('abstract');
            if (isFinal) modifiers.push('final');
            if (isStatic) modifiers.push('static');
            
            const modifierStr = modifiers.length > 0 ? ` [${visibility}${modifiers.length > 0 ? ' ' + modifiers.join(' ') : ''}]` : ` [${visibility}]`;
            const signature = `${className}.${methodName}(${params})${modifierStr}`;

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
 * Извлечение связей L1 из PHP кода
 */
async function parsePhpFunctionL1(code) {
    // Удаление комментариев
    let cleaned = code
        .replace(/\/\*[\s\S]*?\*\//g, '')   // /* ... */
        .replace(/\/\/.*$/gm, '')           // // ...
        .replace(/#.*$/gm, '');             // # ...

    // Множества для результатов
    const calledFunctions = new Set();
    const useStatements = new Set();
    const requireInclude = new Set();
    const instantiations = new Set();

    // Чёрный список встроенных функций/методов PHP
    const blacklist = new Set([
        'echo', 'print', 'var_dump', 'print_r', 'var_export', 'debug_print_backtrace',
        'isset', 'empty', 'unset', 'die', 'exit',
        'array', 'array_key_exists', 'array_merge', 'array_push', 'array_pop', 'array_shift', 'array_unshift',
        'array_slice', 'array_splice', 'array_keys', 'array_values', 'array_search', 'array_reverse',
        'array_unique', 'array_filter', 'array_map', 'array_reduce', 'array_walk', 'array_count_values',
        'strlen', 'strpos', 'strrpos', 'substr', 'str_replace', 'strtolower', 'strtoupper', 'trim',
        'ltrim', 'rtrim', 'explode', 'implode', 'join', 'split', 'preg_match', 'preg_replace',
        'count', 'sizeof', 'is_array', 'is_string', 'is_int', 'is_float', 'is_bool', 'is_object',
        'is_null', 'is_numeric', 'is_callable', 'gettype', 'settype',
        'json_encode', 'json_decode', 'serialize', 'unserialize',
        'file_get_contents', 'file_put_contents', 'fopen', 'fclose', 'fread', 'fwrite',
        'date', 'time', 'strtotime', 'mktime', 'date_create', 'date_format',
        'mysql_connect', 'mysqli_connect', 'pdo', 'query', 'execute',
        'header', 'session_start', 'session_destroy', 'cookie', 'setcookie',
        'include', 'require', 'include_once', 'require_once', // но мы их извлекаем отдельно
        'class_exists', 'method_exists', 'function_exists', 'property_exists',
        'get_class', 'get_parent_class', 'is_subclass_of',
        'spl_autoload_register', 'spl_autoload',
        '__construct', '__destruct', '__get', '__set', '__isset', '__unset',
        '__call', '__callStatic', '__toString', '__invoke', '__clone',
        '__sleep', '__wakeup', '__serialize', '__unserialize'
    ]);

    // 1. Use statements: use Namespace\ClassName; или use Namespace\ClassName as Alias;
    const useRegex = /use\s+([a-zA-Z0-9_$\\]+(?:\s+as\s+[a-zA-Z0-9_$]+)?)\s*;/g;
    let useMatch;
    while ((useMatch = useRegex.exec(cleaned)) !== null) {
        const useStatement = useMatch[1].trim();
        // Извлекаем только имя класса без alias
        const className = useStatement.split(/\s+as\s+/)[0].trim();
        if (className) {
            useStatements.add(className);
        }
    }

    // 2. Require/include: require 'file.php'; или include_once "file.php";
    const requireRegex = /(?:require|include)(?:_once)?\s*['"]([^'"]+)['"]/g;
    let requireMatch;
    while ((requireMatch = requireRegex.exec(cleaned)) !== null) {
        requireInclude.add(requireMatch[1]);
    }

    // 3. Вызовы функций: functionName(...) или $obj->method(...) или ClassName::staticMethod(...)
    const funcCallRegex = /(?:^|[^a-zA-Z0-9_$->\\])([a-zA-Z_$][a-zA-Z0-9_$]*(?:::[a-zA-Z0-9_$]+|->[a-zA-Z0-9_$]+)?)\s*\(/g;
    let funcMatch;
    while ((funcMatch = funcCallRegex.exec(cleaned)) !== null) {
        const fullName = funcMatch[1];
        
        // Пропускаем вызовы через $obj-> или ClassName::
        if (fullName.includes('->') || fullName.includes('::')) {
            // Извлекаем только имя метода
            const methodName = fullName.split(/->|::/).pop();
            if (methodName && !blacklist.has(methodName.toLowerCase())) {
                calledFunctions.add(fullName);
            }
        } else {
            // Обычный вызов функции
            const simpleName = fullName.toLowerCase();
            if (!blacklist.has(simpleName)) {
                calledFunctions.add(fullName);
            }
        }
    }

    // 4. Instantiations: new ClassName(...) или new Namespace\ClassName(...)
    const newRegex = /new\s+([a-zA-Z0-9_$\\]+)\s*\(/g;
    let newMatch;
    while ((newMatch = newRegex.exec(cleaned)) !== null) {
        const className = newMatch[1].trim();
        if (className && !blacklist.has(className.toLowerCase())) {
            instantiations.add(className);
        }
    }

    return {
        called_functions: Array.from(calledFunctions).sort(),
        use_statements: Array.from(useStatements).sort(),
        require_include: Array.from(requireInclude).sort(),
        instantiations: Array.from(instantiations).sort()
    };
}

/**
 * Загрузка PHP функций и классов из файла
 */
async function loadPhpFunctionsFromFile(filePath, contextCode, dbService, pipelineState = null) {
    const filename = path.basename(filePath);
    console.log(`[PHP-Loader] Обработка файла: ${filename}`);

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

    let phpContent;
    try {
        phpContent = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        const errorMsg = `Не удалось прочитать файл ${filename}: ${err.message}`;
        console.error(`[PHP-Loader] ${errorMsg}`);
        report.errors.push(errorMsg);
        return report;
    }

    const entities = parsePhpEntitiesFromContent(phpContent, filePath);
    report.functionsFound = entities.length;

    if (entities.length === 0) {
        console.log(`[PHP-Loader] Нет функций или классов в ${filename}`);
        return report;
    }

    console.log(`[PHP-Loader] Найдено сущностей: ${entities.length}`);

    // Регистрация файла
    try {
        const { id: fileId, isNew } = await dbService.saveFileInfo(filename, phpContent, filePath, contextCode);
        report.fileId = fileId;
        report.isNew = isNew;
        console.log(`[PHP-Loader] Файл зарегистрирован: fileId = ${fileId}, isNew = ${isNew}`);
    } catch (err) {
        const errorMsg = `Не удалось зарегистрировать файл ${filename}: ${err.message}`;
        console.error(`[PHP-Loader] ${errorMsg}`);
        report.errors.push(errorMsg);
        return report;
    }

    // === Кэшируем id типов связей один раз на весь файл ===
    const linkTypeMap = {
        called_functions: 'calls',
        use_statements: 'imports',
        require_include: 'depends_on',
        instantiations: 'depends_on'
    };
    const linkTypeIds = {};
    for (const code of Object.values(linkTypeMap)) {
        try {
            const res = await dbService.pgClient.query(
                'SELECT id FROM public.link_type WHERE code = $1',
                [code]
            );
            if (res.rows.length > 0) {
                linkTypeIds[code] = res.rows[0].id;
            } else {
                console.warn(`[PHP-Loader] Тип связи '${code}' не найден в link_type`);
            }
        } catch (err) {
            console.error(`[PHP-Loader] Ошибка при получении link_type '${code}':`, err.message);
        }
    }

    // Загрузка каждой сущности
    for (const entity of entities) {
        console.log(`[PHP-Loader] → Сущность: ${entity.full_name} (${entity.sname}, тип: ${entity.type})`);

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
                console.error(`[PHP-Loader] ${errorMsg}`);
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

                console.log(`[PHP-Loader] Чанк 0 сохранён: chunkId = ${chunkIdL0}`);

                // Парсинг L1 (связи) только для функций, методов и классов
                if (['function', 'method', 'class', 'trait'].includes(entity.type)) {
                    try {
                        const l1Result = await parsePhpFunctionL1(entity.body);
                        entityReport.l1Parsed = true;
                        entityReport.l1CalledFunctions = l1Result.called_functions || [];
                        console.log(`[PHP-Loader] Успешно построен L1 для ${entity.full_name}`);

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

                        // === Дублирование связей в таблицу link ===
                        if (l1Result && entityReport.aiItemId) {
                            let linksCount = 0;

                            for (const [key, code] of Object.entries(linkTypeMap)) {
                                const typeId = linkTypeIds[code];
                                if (!typeId) {
                                    continue;
                                }

                                const targets = (l1Result[key] || [])
                                    .filter(t => typeof t === 'string' && t.trim().length > 0);

                                for (const target of targets) {
                                    try {
                                        await dbService.pgClient.query(
                                            `INSERT INTO public.link 
                                             (context_code, source, target, link_type_id, file_id)
                                             VALUES ($1, $2, $3, $4, $5)
                                             ON CONFLICT (context_code, source, target, link_type_id) DO NOTHING`,
                                            [contextCode, entity.full_name, target, typeId, report.fileId || null]
                                        );
                                        linksCount++;
                                    } catch (err) {
                                        console.error(`[PHP-Loader] Ошибка link ${entity.full_name} -> ${target} (${code}):`, err.message);
                                        entityReport.errors.push(`Link error: ${code} -> ${target}`);
                                    }
                                }
                            }

                            if (linksCount > 0) {
                                console.log(`[PHP-Loader] Сохранено ${linksCount} связей для ${entity.full_name}`);
                            }
                        }
                        // === КОНЕЦ дублирования связей ===

                        console.log(`[PHP-Loader] Чанк 1 (связи) сохранён: chunkId = ${chunkIdL1}`);
                    } catch (err) {
                        const errorMsg = `Ошибка парсинга L1 для ${entity.full_name}: ${err.message}`;
                        console.error(`[PHP-Loader] ${errorMsg}`);
                        entityReport.errors.push(errorMsg);
                    }
                }
            } catch (err) {
                const errorMsg = `Ошибка сохранения чанка L0 для ${entity.full_name}: ${err.message}`;
                console.error(`[PHP-Loader] ${errorMsg}`);
                entityReport.errors.push(errorMsg);
            }
        } catch (err) {
            const errorMsg = `Ошибка при обработке сущности ${entity.full_name}: ${err.message}`;
            console.error(`[PHP-Loader] ${errorMsg}`);
            entityReport.errors.push(errorMsg);
        }

        // Если сущность обработана успешно (есть aiItemId и chunkL0Id), увеличиваем счетчик
        if (entityReport.aiItemId && entityReport.chunkL0Id) {
            report.functionsProcessed++;
        }

        report.functions.push(entityReport);
    }

    console.log(`[PHP-Loader] Файл ${filename} успешно обработан`);
    return report;
}

module.exports = {
    parsePhpFunctionL1,
    parsePhpEntitiesFromContent,
    loadPhpFunctionsFromFile
};
