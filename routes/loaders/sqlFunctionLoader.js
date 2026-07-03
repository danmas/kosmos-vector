// Загрузчик SQL-функций
// routes/loaders/sqlFunctionLoader.js

const fs = require('fs');
const path = require('path');
const { checkFileChanged } = require('../../packages/core/fileChangeDetector');
const { processEntitiesIncremental } = require('../../packages/core/entityProcessor');

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

    // 3. Извлечение имени функции (регистронезависимо, OR REPLACE опционально)
    const createRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+|[a-zA-Z0-9_]+)\s*\(/i;
    const match = originalForName.match(createRegex);
    if (!match) {
        throw new Error("Не удалось найти CREATE FUNCTION");
    }
    const functionName = match[1].trim();

    // 4. Поиск начала тела функции: AS $$, AS $tag$ (например $function$, $body$), или AS '
    const asRegex = /\bAS\s*('|\$\w*\$)/i;
    const asMatch = cleaned.match(asRegex);
    if (!asMatch) {
        throw new Error("Не найден блок AS $$ / AS $tag$ / AS '");
    }

    const delimiter = asMatch[1]; // ' или $$ или $function$ и т.д.
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
        // Для AS $$ ... $$ или AS $function$ ... $function$
        const dollarParts = cleaned.substring(bodyStart).split(delimiter);
        if (dollarParts.length < 2) {
            throw new Error(`Не найден закрывающий ${delimiter}`);
        }
        // Берём всё до последнего вхождения тега (тело функции)
        body = dollarParts.slice(0, -1).join(delimiter).trim();
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
        , 'upper', 'lower', 'trim', 'ltrim', 'rtrim', 'substring', 'length', 'concat', 'replace', 'split_part'
        , 'to_char', 'to_date', 'to_number', 'to_timestamp', 'to_timestamp_tz', 'regexp_split_to_table'
        , 'region', 'to_timestamp'
        , 'ARRAY_LENGTH', 'ARRAY_AGG', 'ARRAY_TO_STRING', 'ARRAY_POSITION', 'ARRAY_UPPER', 'ARRAY_LOWER'
        , 'ARRAY_TRIM', 'ARRAY_SUBSTRING', 'ARRAY_CONCAT', 'ARRAY_REPLACE', 'ARRAY_SPLIT_PART', 'ARRAY_TO_CHAR', 'ARRAY_TO_DATE'
        , 'ARRAY_TO_NUMBER', 'ARRAY_TO_TIMESTAMP', 'ARRAY_TO_TIMESTAMP_TZ', 'ARRAY_TO_TIMESTAMP_ntz', 'ARRAY_LENGTH', 'ARRAY_AGG'
        , 'ARRAY_TO_STRING', 'ARRAY_POSITION', 'ARRAY_UPPER', 'ARRAY_LOWER'
        , 'nextval', 'currval', 'lastval', 'setval', 'pg_advisory_xact_lock', 'pg_advisory_xact_lock_shared', 'pg_advisory_lock'
        , 'pg_advisory_lock_shared', 'pg_advisory_unlock', 'pg_advisory_unlock_shared', 'pg_advisory_lock_clear', 'pg_advisory_lock_clear_shared'
        , 'floor', 'substr', 'substring', 'length', 'concat', 'replace', 'split_part', 'to_char', 'to_date', 'to_number'
        , 'to_timestamp', 'to_timestamp_tz', 'to_timestamp_ntz', 'to_timestamp_tz', 'to_timestamp_ntz', 'regexp_split_to_table'
        , 'jsonb_array_length', 'jsonb_path_query', 'jsonb_path_query_first', 'jsonb_path_query_array', 'jsonb_path_query_first_array'
        , 'sum', 'avg', 'min', 'max', 'count', 'bool_and', 'bool_or', 'bool_xor', 'bool_not', 'bool_any', 'bool_all'
        , 'bool_exists', 'bool_in', 'bool_not_in', 'bool_like', 'bool_not_like', 'bool_ilike', 'bool_not_ilike'
        , 'bool_similar', 'bool_not_similar', 'bool_similar_to', 'bool_not_similar_to', 'bool_regex', 'bool_not_regex'
        , 'bool_iregex', 'bool_not_iregex'
        , 'pg_sequences', 'pg_sequence_last_value', 'pg_sequence_next_value', 'pg_sequence_set_last_value'
        , 'pg_sequence_set_next_value', 'array_to_json',  'array_agg', 'json_strip_nulls'
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
            
            if (currentFunctionComment) {
                console.log(`[SQL-Parser] 📝 Извлечен комментарий (${currentFunctionComment.length} символов) для следующей функции`);
            }
            
            pendingCommentLines = []; // сбрасываем для следующей функции
            currentFunction = 'header';
            bodyLines.push(originalLine);
            continue;
        }

        // Мы внутри функции
        if (currentFunction) {
            // Сначала проверяем, не ждём ли мы LANGUAGE
            if (waitingForLanguage) {
                if (trimmed.match(/^LANGUAGE\s+\w+\s*;?/i)) {
                    // Нашли LANGUAGE — добавляем строку и завершаем функцию
                    bodyLines.push(originalLine);
                    saveFunction();
                    continue;
                } else {
                    // Получили что-то другое — завершаем без добавления этой строки
                    saveFunction();
                    // Эта строка может быть началом комментария для следующей функции
                    pendingCommentLines.push(originalLine);
                    continue;
                }
            }

            // Добавляем строку в body
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

            // Проверяем закрывающий $$; (с точкой с запятой) — функция завершена (LANGUAGE был до AS $$)
            if (trimmed === closingTag + ';' || trimmed.startsWith(closingTag + '; ')) {
                saveFunction();
                continue;
            }

            // Проверяем только закрывающий $$ (без точки с запятой) — ждём LANGUAGE
            if (trimmed === closingTag || trimmed.startsWith(closingTag + ' ') || trimmed.startsWith(closingTag + '\t')) {
                // Закрывающий $$ — теперь ждём LANGUAGE на следующей строке
                waitingForLanguage = true;
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
async function loadSqlFunctionsFromFile(filePath, contextCode, dbService, pipelineState = null, mode = 'incremental') {
    const filename = path.basename(filePath);
    console.log(`[SQL-Loader] Обработка файла: ${filename} (mode=${mode})`);

    // Инициализация отчета
    const report = {
        filename: filename,
        fileId: null,
        isNew: false,
        functionsFound: 0,
        functionsProcessed: 0,
        functions: [],
        errors: [],
        skipped: false,
        skipReason: null,
        entityReport: null
    };

    // === Инкрементальная проверка файла ===
    let sqlContent;
    let fileHash = null;

    if (mode === 'incremental') {
        try {
            const changeResult = await checkFileChanged(filePath, contextCode, dbService);
            if (!changeResult.changed) {
                console.log(`[SQL-Loader] Файл ${filename} не изменился (${changeResult.status}), пропускаем`);
                report.skipped = true;
                report.skipReason = changeResult.status;
                report.fileId = changeResult.fileId;
                return report;
            }
            sqlContent = changeResult.content;
            fileHash = changeResult.newHash;
            report.fileId = changeResult.fileId;
        } catch (err) {
            console.warn(`[SQL-Loader] Ошибка инкрементальной проверки ${filename}, читаем полностью: ${err.message}`);
            // Fallback к полному чтению
            sqlContent = null;
        }
    }

    // Если content ещё не получен (mode=full или fallback)
    if (!sqlContent) {
        try {
            sqlContent = fs.readFileSync(filePath, 'utf8');
        } catch (err) {
            const errorMsg = `Не удалось прочитать файл ${filename}: ${err.message}`;
            console.error(`[SQL-Loader] ${errorMsg}`);
            report.errors.push(errorMsg);
            return report;
        }
    }

    const functions = parseFunctionsFromContent(sqlContent, filePath);
    report.functionsFound = functions.length;

    if (functions.length === 0) {
        console.log(`[SQL-Loader] Нет функций с блоками комментариев в ${filename}`);
        return report;
    }

    console.log(`[SQL-Loader] Найдено функций: ${functions.length}`);

    // Регистрация файла (с хешем)
    try {
        const { id: fileId, isNew } = await dbService.saveFileInfo(filename, sqlContent, filePath, contextCode, fileHash);
        report.fileId = fileId;
        report.isNew = isNew;
        console.log(`[SQL-Loader] Файл зарегистрирован: fileId = ${fileId}, isNew = ${isNew}`);
    } catch (err) {
        const errorMsg = `Не удалось зарегистрировать файл ${filename}: ${err.message}`;
        console.error(`[SQL-Loader] ${errorMsg}`);
        report.errors.push(errorMsg);
        return report;
    }

    // === Кэшируем id типов связей один раз на весь файл ===
    const linkTypeMap = {
        called_functions: 'calls',
        select_from: 'reads_from',
        update_tables: 'updates',
        insert_tables: 'inserts_into'
    };
    const linkTypeIds = {};
    for (const code of Object.values(linkTypeMap)) {
        try {
            const res = await dbService.pgClient.query(
                'SELECT id FROM kosmos.link_type WHERE code = $1',
                [code]
            );
            linkTypeIds[code] = res.rows[0]?.id || null;
        } catch (err) {
            console.warn(`[SQL-Loader] Не удалось получить link_type для '${code}': ${err.message}`);
            linkTypeIds[code] = null;
        }
    }

    // === Инкрементальная обработка сущностей ===
    if (mode === 'incremental' && report.fileId) {
        try {
            const entityReport = await processEntitiesIncremental(functions, report.fileId, contextCode, dbService, {
                loaderTag: '[SQL-Loader]',
                createChunksAndLinks: async (entity, aiItem, fId) => {
                    // L0 чанк
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

                    const chunkIdL0 = await dbService.saveChunkVector(
                        fId, chunkContent, null,
                        { type: 'function', level: '0-исходник', full_name: entity.full_name, s_name: entity.sname },
                        null, contextCode
                    );
                    await dbService.pgClient.query(
                        'UPDATE kosmos.chunk_vector SET ai_item_id = $1 WHERE id = $2',
                        [aiItem.id, chunkIdL0]
                    );

                    // L1 чанк (связи)
                    try {
                        const l1Result = await parsePlpgsqlFunctionL1(entity.body);
                        const chunkIdL1 = await dbService.saveChunkVector(
                            fId, { text: l1Result }, null,
                            { type: 'json', level: '1-связи', full_name: entity.full_name, s_name: entity.sname },
                            chunkIdL0, contextCode
                        );
                        await dbService.pgClient.query(
                            'UPDATE kosmos.chunk_vector SET ai_item_id = $1 WHERE id = $2',
                            [aiItem.id, chunkIdL1]
                        );

                        // Дублирование связей в таблицу link
                        for (const [key, code] of Object.entries(linkTypeMap)) {
                            const typeId = linkTypeIds[code];
                            if (!typeId) continue;
                            const targets = (l1Result[key] || []).filter(t => typeof t === 'string' && t.trim().length > 0);
                            for (const target of targets) {
                                try {
                                    await dbService.pgClient.query(
                                        `INSERT INTO kosmos.link (context_code, source, target, link_type_id, file_id)
                                         VALUES ($1, $2, $3, $4, $5)
                                         ON CONFLICT (context_code, source, target, link_type_id) DO NOTHING`,
                                        [contextCode, entity.full_name, target, typeId, fId || null]
                                    );
                                } catch (err) {
                                    console.error(`[SQL-Loader] Ошибка link ${entity.full_name} -> ${target} (${code}):`, err.message);
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`[SQL-Loader] Ошибка парсинга L1 для ${entity.full_name}: ${err.message}`);
                    }
                }
            });
            report.entityReport = entityReport;
            report.functionsProcessed = entityReport.created + entityReport.updated;
            console.log(`[SQL-Loader] Инкрементальный итог: created=${entityReport.created}, updated=${entityReport.updated}, unchanged=${entityReport.unchanged}, deleted=${entityReport.deleted}`);
            return report;
        } catch (err) {
            console.error(`[SQL-Loader] Ошибка инкрементальной обработки: ${err.message}, переходим к полному режиму`);
        }
    }

    // === Полный режим (mode=full или fallback) ===
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

            const chunkContentL0 = {
                full_name: func.full_name,
                s_name: func.sname,
                signature: func.signature,
                body: func.body
            };
            const chunkContent = { text: chunkContentL0 };
            if (func.comment && typeof func.comment === 'string' && func.comment.trim()) {
                chunkContent.comment = func.comment.trim();
            }

            try {
                const chunkIdL0 = await dbService.saveChunkVector(
                    report.fileId, chunkContent, null,
                    { type: 'function', level: '0-исходник', full_name: func.full_name, s_name: func.sname },
                    null, contextCode
                );
                functionReport.chunkL0Id = chunkIdL0;
                await dbService.pgClient.query(
                    'UPDATE kosmos.chunk_vector SET ai_item_id = $1 WHERE id = $2',
                    [functionReport.aiItemId, chunkIdL0]
                );

                try {
                    const l1Result = await parsePlpgsqlFunctionL1(func.body);
                    functionReport.l1Parsed = true;
                    functionReport.l1CalledFunctions = l1Result.called_functions || [];

                    const chunkIdL1 = await dbService.saveChunkVector(
                        report.fileId, { text: l1Result }, null,
                        { type: 'json', level: '1-связи', full_name: func.full_name, s_name: func.sname },
                        chunkIdL0, contextCode
                    );
                    functionReport.chunkL1Id = chunkIdL1;
                    await dbService.pgClient.query(
                        'UPDATE kosmos.chunk_vector SET ai_item_id = $1 WHERE id = $2',
                        [functionReport.aiItemId, chunkIdL1]
                    );

                    if (l1Result && functionReport.aiItemId) {
                        for (const [key, code] of Object.entries(linkTypeMap)) {
                            const typeId = linkTypeIds[code];
                            if (!typeId) continue;
                            const targets = (l1Result[key] || []).filter(t => typeof t === 'string' && t.trim().length > 0);
                            for (const target of targets) {
                                try {
                                    await dbService.pgClient.query(
                                        `INSERT INTO kosmos.link (context_code, source, target, link_type_id, file_id)
                                         VALUES ($1, $2, $3, $4, $5)
                                         ON CONFLICT (context_code, source, target, link_type_id) DO NOTHING`,
                                        [contextCode, func.full_name, target, typeId, report.fileId || null]
                                    );
                                } catch (err) {
                                    console.error(`[SQL-Loader] Ошибка link ${func.full_name} -> ${target} (${code}):`, err.message);
                                    functionReport.errors.push(`Link error: ${code} -> ${target}`);
                                }
                            }
                        }
                    }
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

