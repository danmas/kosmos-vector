// Загрузчик SQL-функций
// routes/loaders/sqlFunctionLoader.js

const fs = require('fs');
const path = require('path');

/**
 * Извлечение связей L1 из кода функции
 */
async function parsePlpgsqlFunctionL1(code) {
    // 1. Удаление комментариев
    let cleaned = code
        .replace(/\/\*[\s\S]*?\*\//g, '')   // /* ... */
        .replace(/--.*$/gm, '');            // -- ...

    // Сохраняем оригинал для точного извлечения имени функции
    const originalForName = cleaned;

    // 2. Нормализация только для поиска тела (много пробелов → один)
    cleaned = cleaned.replace(/\s+/g, ' ');

    // 3. Извлечение имени функции (регистронезависимо)
    const createRegex = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+|[a-zA-Z0-9_]+)\s*\(/i;
    const match = originalForName.match(createRegex);
    if (!match) {
        throw new Error("Не удалось найти CREATE OR REPLACE FUNCTION");
    }
    const functionName = match[1].trim();

    // 4. Поиск начала тела функции: AS $$ или as $$ или As $$ и т.д., а также AS '
    const asRegex = /\bAS\s*('|\$\$)/i;
    const asMatch = cleaned.match(asRegex);
    if (!asMatch) {
        throw new Error("Не найден блок AS $$ или AS '");
    }

    const delimiter = asMatch[1]; // ' или $$
    const asIndex = cleaned.indexOf(asMatch[0]);

    let bodyStart = asIndex + asMatch[0].length;
    let body = '';

    if (delimiter === "'") {
        // Для AS '...' – ищем закрывающую одинарную кавычку с точкой с запятой
        const endQuoteIndex = cleaned.indexOf("';", bodyStart);
        if (endQuoteIndex === -1) {
            throw new Error("Не найден конец блока AS ' ... ';");
        }
        body = cleaned.substring(bodyStart, endQuoteIndex);
    } else {
        // Для AS $$ ... $$
        // Ищем последнее вхождение $$ (но не внутри строк, упрощённо)
        const dollarParts = cleaned.substring(bodyStart).split('$$');
        if (dollarParts.length < 2) {
            throw new Error("Не найден закрывающий $$");
        }
        // Берём всё до последнего $$ (тело функции)
        body = dollarParts.slice(0, -1).join('$$').trim();
    }

    // 5. Удаляем динамический SQL (EXECUTE ...)
    body = body.replace(/EXECUTE\s+[^;]*;/gi, ' ');

    // Множества для результатов
    const calledFunctions = new Set();
    const selectFrom = new Set();
    const updateTables = new Set();
    const insertTables = new Set();

    // Чёрный список (в нижнем регистре)
    const blacklist = new Set([
        'select', 'from', 'join', 'left', 'right', 'inner', 'outer', 'on', 'where', 'and', 'or',
        'update', 'insert', 'into', 'delete', 'set', 'values', 'returning', 'as', 'is', 'null',
        'case', 'when', 'then', 'else', 'end', 'coalesce', 'nullif', 'greatest', 'least',
        'extract', 'date_part', 'now', 'current_timestamp', 'current_date',
        'perform', 'raise', 'return', 'declare', 'begin', 'if', 'elsif',
        'loop', 'while', 'for', 'in', 'by', 'reverse', 'continue', 'exit', 'language'
        , 'json_build_object', 'count', 'jsonb_agg', 'jsonb_set', 'string_to_array', 'to_jsonb'
        , 'jsonb_build_object', 'position', 'random', 'replace', 'trunc', 'format', 'max'
        , 'row_to_json', 'json_agg', 'json_build_array', 'json_object_agg', 'json_object_keys'
        , 'json_object_values', 'jsonb_build_object', 'jsonb_agg', 'jsonb_set', 'string_to_array'
        , 'to_jsonb', 'position', 'random', 'replace', 'trunc', 'format', 'max', 'row_to_json'
        , 'json_agg', 'json_build_array', 'json_object_agg', 'json_object_keys', 'json_object_values'
    ]);

    // 6. Вызовы функций: schema.func( или func(
    // const funcCallRegex = /\b([a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?)\s*\(/gi;
    // Ловим вызовы: PERFORM func(...), SELECT func(...), var := func(...), просто func(...)
    const funcCallRegex = /(?:PERFORM|SELECT|\w+\s*:=|\b)\s*([a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?)\s*\(/gi;
    let funcMatch;
    while ((funcMatch = funcCallRegex.exec(body)) !== null) {
        const fullName = funcMatch[1];
        const nameLower = fullName.toLowerCase();
        const simpleName = nameLower.includes('.') ? nameLower.split('.').pop() : nameLower;

        if (!blacklist.has(simpleName)) {
            calledFunctions.add(fullName);
        }
    }

    // 7. Таблицы в FROM / JOIN
    const fromJoinRegex = /\b(FROM|JOIN)\s+([a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?)\b/gi;
    let fromMatch;
    while ((fromMatch = fromJoinRegex.exec(body)) !== null) {
        const table = fromMatch[2];
        if (!blacklist.has(table.toLowerCase())) {
            selectFrom.add(table);
        }
    }

    // 8. UPDATE table
    const updateRegex = /\bUPDATE\s+([a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?)\b/gi;
    let updateMatch;
    while ((updateMatch = updateRegex.exec(body)) !== null) {
        updateTables.add(updateMatch[1]);
    }

    // 9. INSERT INTO table
    const insertRegex = /\bINSERT\s+INTO\s+([a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?)\b/gi;
    let insertMatch;
    while ((insertMatch = insertRegex.exec(body)) !== null) {
        insertTables.add(insertMatch[1]);
    }

    // 10. Результат
    return {
        called_functions: Array.from(calledFunctions).sort(),
        select_from: Array.from(selectFrom).sort(),
        update_tables: Array.from(updateTables).sort(),
        insert_tables: Array.from(insertTables).sort()
    };
}

/**
 * Парсинг одной функции из блока
 */
// function parseFunctionsFromContent(sqlContent, filePath) {
//     const functionRegex = new RegExp(
//         '(={10,}|-{10,})\\s*\\n' +
//         '((?:--[^\\n]*\\n)*?)' +
//         '(={10,}|-{10,})\\s*\\n' +
//         '(create\\s+or\\s+replace\\s+function\\s+' +
//         '(?:[\\w]+\\.)?[\\w]+\\s*\\([^\\)]*\\)' +
//         '[\\s\\S]*?' +
//         'language\\s+\\w+\\s*;?' +
//         '\\s*(?:--.*)?\\s*$)',
//         'gim'
//     );

//     const functions = [];
//     let match;
//     let index = 0;

//     while ((match = functionRegex.exec(sqlContent)) !== null) {
//         index++;
//         const rawCommentBlock = match[2];
//         const functionDefinition = match[4].trim();

//         // Комментарий
//         const commentLines = rawCommentBlock
//             .split('\n')
//             .map(line => line.replace(/^--\s?/, '').trimEnd());
//         const comment = commentLines.join('\n').trim();

//         // Тело
//         let body = functionDefinition;
//         if (!body.endsWith(';')) body += ';';

//         // Полное имя
//         const fullNameMatch = body.match(/create\s+or\s+replace\s+function\s+((?:[\w]+\.)?[\w]+)\s*\(/i);
//         const full_name = fullNameMatch ? fullNameMatch[1].trim() : `unknown_function_${path.basename(filePath)}_${index}`;

//         // Короткое имя
//         const sname = full_name.split('.').pop();

//         // Сигнатура
//         const signatureMatch = body.match(/create\s+or\s+replace\s+function\s+((?:[\w]+\.)?[\w]+\s*\([^\)]*\))/i);
//         const signature = signatureMatch ? signatureMatch[1].trim() : full_name;

//         functions.push({
//             full_name: full_name,
//             sname: sname,
//             comment: comment || null,
//             signature: signature,
//             body: body
//         });
//     }

//     return functions;
// }

/**
 * Надёжный парсинг всех PL/pgSQL функций из SQL-контента
 * Работает без требований к разделителям
 */
// function parseFunctionsFromContent(sqlContent, filePath) {
//     const lines = sqlContent.split('\n');
//     const functions = [];
//     let currentFunction = null;
//     let bodyLines = [];
//     let commentLines = [];

//     const resetCurrent = () => {
//         if (currentFunction) {
//             // Собираем тело
//             let body = bodyLines.join('\n').trim();
//             if (!body.endsWith(';')) body += ';';

//             // Полное имя и сигнатура
//             const fullNameMatch = body.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+((?:[\w]+\.)?[\w]+)\s*\(/i) ||
//                                    body.match(/CREATE\s+FUNCTION\s+((?:[\w]+\.)?[\w]+)\s*\(/i);
//             const full_name = fullNameMatch ? fullNameMatch[1].trim() : `unknown_function_${path.basename(filePath)}_${functions.length + 1}`;
//             const sname = full_name.split('.').pop();

//             const signatureMatch = body.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:[\w]+\.)?[\w]+\s*\([^\)]*\))/i);
//             const signature = signatureMatch ? signatureMatch[1].trim() : full_name;

//             // Комментарий из собранных строк
//             const comment = commentLines
//                 .map(l => l.replace(/^--\s?/, '').trimEnd())
//                 .filter(l => l.length > 0)
//                 .join('\n')
//                 .trim() || null;

//             functions.push({
//                 full_name,
//                 sname,
//                 comment,
//                 signature,
//                 body
//             });
//         }

//         currentFunction = null;
//         bodyLines = [];
//         commentLines = [];
//     };

//     for (let line of lines) {
//         const trimmed = line.trim();

//         // Пропускаем пустые строки
//         if (trimmed === '') {
//             if (currentFunction === null) continue; // ещё не начали функцию
//             bodyLines.push(line); // сохраняем пустые строки внутри тела
//             continue;
//         }

//         // Собираем комментарии -- перед функцией
//         if (trimmed.startsWith('--')) {
//             if (currentFunction === null) {
//                 commentLines.push(line);
//             } else {
//                 bodyLines.push(line);
//             }
//             continue;
//         }

//         // Многострочный /* */ комментарий перед функцией
//         if (trimmed.startsWith('/*') && currentFunction === null) {
//             // Можно добавить простую логику извлечения, но пока просто пропустим как комментарий
//             commentLines.push(line);
//             continue;
//         }

//         // Начало новой функции
//         if (trimmed.match(/^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i)) {
//             resetCurrent(); // сохраняем предыдущую, если была
//             currentFunction = 'in_progress';
//             bodyLines.push(line);
//             continue;
//         }

//         // Если мы внутри функции — просто добавляем строку
//         if (currentFunction === 'in_progress') {
//             bodyLines.push(line);
        
//             // Универсальный конец функции
//             if (trimmed.match(/^LANGUAGE\s+\w+/i) ||
//                 (trimmed === '$$' && bodyLines.some(l => l.trim().startsWith('$$') || l.trim().endsWith('$$')))) {  // улучшил проверку на пару $$
                
//                 resetCurrent();  // сохраняем сразу
//                 currentFunction = null;
//                 commentLines = [];  // сбрасываем комментарии для следующей
//                 continue;
//             }
//         }    }

//     // Не забыть последнюю функцию
//     resetCurrent();

//     return functions;
// }
/**
 * Надёжный парсинг всех PL/pgSQL функций из SQL-контента
 * Поддержка любых dollar-quoting тегов: $$, $F$, $body$ и т.д.
 * Поддержка LANGUAGE любого_языка
 * 
 * Комментарий = всё что перед CREATE до пустой строки (включая DROP FUNCTION, --, и т.д.)
 * Body включает LANGUAGE <lang>; в конце
 */
function parseFunctionsFromContent(sqlContent, filePath) {
    const lines = sqlContent.split('\n');
    const functions = [];
    let currentFunction = null;
    let bodyLines = [];
    let currentFunctionComment = null; // комментарий текущей функции
    let pendingCommentLines = [];      // накапливаем комментарии для следующей функции
    let dollarTag = null;              // запоминаем тег типа 'F' или 'body' или null для $$
    let waitingForLanguage = false;    // ждём строку LANGUAGE после закрывающего $$

    const saveFunction = () => {
        if (currentFunction && bodyLines.length > 0) {
            let body = bodyLines.join('\n').trim();

            // Добавляем ; если его нет в конце
            if (!body.endsWith(';')) {
                body += ';';
            }

            const fullNameMatch = body.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:[\w]+\.)?[\w]+)\s*\(/i);
            const full_name = fullNameMatch ? fullNameMatch[1].trim() : `unknown_function_${path.basename(filePath)}_${functions.length + 1}`;
            const sname = full_name.split('.').pop();

            const signatureMatch = body.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:[\w]+\.)?[\w]+\s*\([^\)]*\))/i);
            const signature = signatureMatch ? signatureMatch[1].trim() : full_name;

            functions.push({
                full_name,
                sname,
                comment: currentFunctionComment,
                signature,
                body
            });
        }

        currentFunction = null;
        bodyLines = [];
        currentFunctionComment = null;
        dollarTag = null;
        waitingForLanguage = false;
    };

    for (let line of lines) {
        const trimmed = line.trim();
        const originalLine = line; // сохраняем оригинал с отступами

        // Пустая строка
        if (trimmed === '') {
            if (currentFunction) {
                bodyLines.push(originalLine);
            } else {
                // Пустая строка вне функции — сбрасываем накопленные комментарии
                pendingCommentLines = [];
            }
            continue;
        }

        // Начало функции
        if (trimmed.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i)) {
            saveFunction(); // сохраняем предыдущую функцию
            
            // Формируем комментарий из накопленных строк
            currentFunctionComment = pendingCommentLines
                .map(l => l.replace(/^--\s?/, '').trimEnd())
                .filter(l => l.length > 0)
                .join('\n')
                .trim() || null;
            
            pendingCommentLines = []; // сбрасываем для следующей функции
            currentFunction = 'header';
            bodyLines.push(originalLine);
            continue;
        }

        // Мы внутри функции
        if (currentFunction) {
            bodyLines.push(originalLine);

            // Ищем AS $тег$ или AS $$
            if (currentFunction === 'header' && trimmed.match(/AS\s*\$/i)) {
                const asMatch = trimmed.match(/AS\s*(\$[^\$]*\$|\$\$)/i);
                if (asMatch) {
                    if (asMatch[1] === '$$') {
                        dollarTag = null;
                    } else {
                        dollarTag = asMatch[1].slice(1, -1); // вырезаем тег без $
                    }
                    currentFunction = 'body';
                }
                continue;
            }

            // Проверяем конец функции: закрывающий $$ с LANGUAGE на той же строке
            const closingTag = dollarTag !== null ? `$${dollarTag}$` : '$$';
            const closingWithLanguageRegex = new RegExp(
                closingTag.replace(/\$/g, '\\$') + '\\s*LANGUAGE\\s+\\w+\\s*;?', 'i'
            );
            
            if (trimmed.match(closingWithLanguageRegex)) {
                // Всё на одной строке: $$ LANGUAGE plpgsql;
                saveFunction();
                continue;
            }

            // Проверяем только закрывающий $$
            if (trimmed === closingTag || trimmed.startsWith(closingTag + ' ') || trimmed.startsWith(closingTag + '\t')) {
                // Закрывающий $$ — теперь ждём LANGUAGE на следующей строке
                waitingForLanguage = true;
                continue;
            }

            // Ждём LANGUAGE после закрывающего $$
            if (waitingForLanguage && trimmed.match(/^LANGUAGE\s+\w+\s*;?/i)) {
                // Нашли LANGUAGE — завершаем функцию
                saveFunction();
                continue;
            }

            // Если ждали LANGUAGE, но получили что-то другое — всё равно завершаем
            if (waitingForLanguage && !trimmed.match(/^LANGUAGE/i)) {
                saveFunction();
                // Эта строка может быть началом комментария для следующей функции
                pendingCommentLines.push(originalLine);
                continue;
            }

            continue;
        }

        // Вне функции — собираем всё как комментарий до пустой строки
        pendingCommentLines.push(originalLine);
    }

    // Последняя функция
    saveFunction();

    return functions;
}



/**
 * Загрузка SQL-функций из файла
 * @param {string} filePath - Полный путь к SQL-файлу
 * @param {string} contextCode - Код контекста
 * @param {DbService} dbService - Экземпляр DbService
 * @param {PipelineStateManager} pipelineState - Менеджер состояния pipeline (опционально)
 * @returns {Promise<Object>} Отчет о загрузке файла
 */
async function loadSqlFunctionsFromFile(filePath, contextCode, dbService, pipelineState = null) {
    const filename = path.basename(filePath);
    console.log(`[SQL-Loader] Обработка файла: ${filename}`);

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

    let sqlContent;
    try {
        sqlContent = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        const errorMsg = `Не удалось прочитать файл ${filename}: ${err.message}`;
        console.error(`[SQL-Loader] ${errorMsg}`);
        report.errors.push(errorMsg);
        return report;
    }

    const functions = parseFunctionsFromContent(sqlContent, filePath);
    report.functionsFound = functions.length;

    if (functions.length === 0) {
        console.log(`[SQL-Loader] Нет функций с блоками комментариев в ${filename}`);
        return report;
    }

    console.log(`[SQL-Loader] Найдено функций: ${functions.length}`);

    // Регистрация файла
    try {
        const { id: fileId, isNew } = await dbService.saveFileInfo(filename, sqlContent, filePath, contextCode);
        report.fileId = fileId;
        report.isNew = isNew;
        console.log(`[SQL-Loader] Файл зарегистрирован: fileId = ${fileId}, isNew = ${isNew}`);
    } catch (err) {
        const errorMsg = `Не удалось зарегистрировать файл ${filename}: ${err.message}`;
        console.error(`[SQL-Loader] ${errorMsg}`);
        report.errors.push(errorMsg);
        return report;
    }

    // Загрузка каждой функции
    for (const func of functions) {
        console.log(`[SQL-Loader] → Функция: ${func.full_name} (${func.sname})`);

        const functionReport = {
            full_name: func.full_name,
            sname: func.sname,
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
                full_name: func.full_name,
                contextCode: contextCode,
                type: 'function',
                sName: func.sname,
                fileId: report.fileId
            });

            if (!aiItem || !aiItem.id) {
                const errorMsg = `Не удалось создать AI Item для ${func.full_name}`;
                console.error(`[SQL-Loader] ${errorMsg}`);
                functionReport.errors.push(errorMsg);
                report.functions.push(functionReport);
                continue;
            }

            functionReport.aiItemId = aiItem.id;

            // Сохранение чанка уровня 0
            const chunkContentL0 = {
                full_name: func.full_name,
                s_name: func.sname,
                comment: func.comment,
                signature: func.signature,
                body: func.body
            };

            try {
                const chunkIdL0 = await dbService.saveChunkVector(
                    report.fileId,
                    { text: chunkContentL0 },  // передаём объект, а не строку
                    null, // без embedding
                    {
                        type: 'function',
                        level: '0-исходник',
                        full_name: func.full_name,
                        s_name: func.sname
                    },
                    null, // parentChunkId
                    contextCode
                );

                functionReport.chunkL0Id = chunkIdL0;

                // Привязываем чанк к AI Item
                await dbService.pgClient.query(
                    'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
                    [functionReport.aiItemId, chunkIdL0]
                );

                console.log(`[SQL-Loader] Чанк 0 сохранён: chunkId = ${chunkIdL0}`);

                // Парсинг L1 (связи)
                try {
                    const l1Result = await parsePlpgsqlFunctionL1(func.body);
                    functionReport.l1Parsed = true;
                    functionReport.l1CalledFunctions = l1Result.called_functions || [];
                    console.log(`[SQL-Loader] Успешно построен L1 для ${func.full_name}`);

                    // Сохранение чанка уровня 1 (связи)
                    const chunkIdL1 = await dbService.saveChunkVector(
                        report.fileId,
                        { text: l1Result },  // передаём объект, а не строку
                        null, // без embedding
                        {
                            type: 'json',
                            level: '1-связи',
                            full_name: func.full_name,
                            s_name: func.sname
                        },
                        chunkIdL0, // parentChunkId
                        contextCode
                    );

                    functionReport.chunkL1Id = chunkIdL1;

                    // Привязываем чанк L1 к AI Item
                    await dbService.pgClient.query(
                        'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
                        [functionReport.aiItemId, chunkIdL1]
                    );

                    console.log(`[SQL-Loader] Чанк 1 (связи) сохранён: chunkId = ${chunkIdL1}`);
                } catch (err) {
                    const errorMsg = `Ошибка парсинга L1 для ${func.full_name}: ${err.message}`;
                    console.error(`[SQL-Loader] ${errorMsg}`);
                    functionReport.errors.push(errorMsg);
                }
            } catch (err) {
                const errorMsg = `Ошибка сохранения чанка L0 для ${func.full_name}: ${err.message}`;
                console.error(`[SQL-Loader] ${errorMsg}`);
                functionReport.errors.push(errorMsg);
            }
        } catch (err) {
            const errorMsg = `Ошибка при обработке функции ${func.full_name}: ${err.message}`;
            console.error(`[SQL-Loader] ${errorMsg}`);
            functionReport.errors.push(errorMsg);
        }

        // Если функция обработана успешно (есть aiItemId и chunkL0Id), увеличиваем счетчик
        if (functionReport.aiItemId && functionReport.chunkL0Id) {
            report.functionsProcessed++;
        }

        report.functions.push(functionReport);
    }

    console.log(`[SQL-Loader] Файл ${filename} успешно обработан`);
    return report;
}

module.exports = {
    parsePlpgsqlFunctionL1,
    parseFunctionsFromContent,
    loadSqlFunctionsFromFile
};
