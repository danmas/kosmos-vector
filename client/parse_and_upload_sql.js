/*
* Загрузка SQL-функций в AIAN Vector
* parse_and_upload_sql.js

cd ./client
# Загрузка SQL-функций в AIAN Vector
node parse_and_upload_sql.js api_auct_sort.sql -c CARL
# Загрузка всех SQL-функций в каталоге
node parse_and_upload_sql.js . -c CARL
*/

const fs = require('fs');
const path = require('path');

// === Конфигурация API ===
const BASE_URL = 'http://localhost:3200';


/*
    Извлечение связей L1 из кода функции
*/
async function parsePlpgsqlFunctionL1(code) {
    // console.log(code);

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
    const funcCallRegex = /\b([a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?)\s*\(/gi;
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


async function apiPost(endpoint, body) {
    try {
        const response = await fetch(`${BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error(`Ошибка API ${endpoint}: ${response.status} ${response.statusText}`, data);
            return null; // Не прерываем весь процесс, только этот запрос
        }

        return data;
    } catch (err) {
        console.error(`Сетевая ошибка при вызове ${endpoint}:`, err.message);
        return null;
    }
}

// === Парсинг одной функции из блока ===
function parseFunctionsFromContent(sqlContent, filePath) {
    const functionRegex = new RegExp(
        '(={10,}|-{10,})\\s*\\n' +
        '((?:--[^\\n]*\\n)*?)' +
        '(={10,}|-{10,})\\s*\\n' +
        '(create\\s+or\\s+replace\\s+function\\s+' +
        '(?:[\\w]+\\.)?[\\w]+\\s*\\([^\\)]*\\)' +
        '[\\s\\S]*?' +
        'language\\s+\\w+\\s*;?' +
        '\\s*(?:--.*)?\\s*$)',
        'gim'
    );

    const functions = [];
    let match;
    let index = 0;

    while ((match = functionRegex.exec(sqlContent)) !== null) {
        index++;
        const rawCommentBlock = match[2];
        const functionDefinition = match[4].trim();

        // Комментарий
        const commentLines = rawCommentBlock
            .split('\n')
            .map(line => line.replace(/^--\s?/, '').trimEnd());
        const comment = commentLines.join('\n').trim();

        // Тело
        let body = functionDefinition;
        if (!body.endsWith(';')) body += ';';

        // Полное имя
        const fullNameMatch = body.match(/create\s+or\s+replace\s+function\s+((?:[\w]+\.)?[\w]+)\s*\(/i);
        const full_name = fullNameMatch ? fullNameMatch[1].trim() : `unknown_function_${path.basename(filePath)}_${index}`;

        // Короткое имя
        const sname = full_name.split('.').pop();

        // Сигнатура
        const signatureMatch = body.match(/create\s+or\s+replace\s+function\s+((?:[\w]+\.)?[\w]+\s*\([^\)]*\))/i);
        const signature = signatureMatch ? signatureMatch[1].trim() : full_name;

        functions.push({
            full_name: full_name,
            sname: sname,
            comment: comment || null,
            signature: signature,
            body: body
        });
    }

    return functions;
}

// === Обработка одного SQL-файла ===
async function processSqlFile(filePath) {
    const filename = path.basename(filePath);
    console.log(`\nОбработка файла: ${filename}`);

    let sqlContent;
    let _res;

    try {
        sqlContent = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        console.error(`Не удалось прочитать файл ${filename}:`, err.message);
        return;
    }

    const functions = parseFunctionsFromContent(sqlContent, filePath);

    if (functions.length === 0) {
        console.log(`   Нет функций с блоками комментариев в ${filename}`);
        return;
    }

    console.log(`   Найдено функций: ${functions.length}`);

    // Регистрация файла
    const registerRes = await apiPost('/register-file', {
        filename: filename,
        contextCode: 'CARL'
    });

    if (!registerRes || !registerRes.fileId) {
        console.error(`   Не удалось зарегистрировать файл ${filename}. Пропускаем.`);
        return;
    }

    const fileId = registerRes.fileId;
    console.log(`   Файл зарегистрирован: fileId = ${fileId}`);

    // Загрузка каждой функции
    for (const func of functions) {
        console.log(`   → Функция: ${func.full_name} (${func.sname})`);

        // Создание AI Item
        const aiItemRes = await apiPost('/create-or-update-ai-item', {
            full_name: func.full_name,
            contextCode: 'CARL',
            type: 'function',
            sName: func.sname,
            fileId: fileId
        });

        if (!aiItemRes || !aiItemRes.aiItem?.id) {
            console.error(`     Не удалось создать AI Item для ${func.full_name}`);
            continue;
        }

        const aiItemId = aiItemRes.aiItem.id;

        // Сохранение чанка уровня 0
        const chunkContent = {
            full_name: func.full_name,
            s_name: func.sname,
            comment: func.comment,
            signature: func.signature,
            body: func.body
        };

        let chunkRes = await apiPost('/save-chunk', {
            fileId: fileId,
            content: chunkContent,
            chunkIndex: 0,
            level: '0-исходник',
            type: 'function',
            full_name: func.full_name,
            s_name: func.sname,
            aiItemId: aiItemId
        });

        if (chunkRes && chunkRes.chunkId) {
            console.log(`     Чанк 0 сохранён: chunkId = ${chunkRes.chunkId}`);

            let l1Result;
            try {
                l1Result = await parsePlpgsqlFunctionL1(func.body);  // ← передаём func.body (строку)
                console.log(`     Успешно построен L1  ${(l1Result).called_functions}`);
                // Теперь сохраняем именно результат парсинга как чанк уровня 1
                const l1ChunkRes = await apiPost('/save-chunk', {
                    fileId: fileId,
                    content: l1Result,  // ← вот сюда передаём JSON-объект от парсинга
                    chunkIndex: 0,      // лучше нумеровать последовательно: 0 — исходник, 1 — связи
                    level: '1-связи',
                    type: 'json',
                    full_name: func.full_name,
                    s_name: func.sname,
                    aiItemId: aiItemId
                });

                if (l1ChunkRes && l1ChunkRes.chunkId) {
                    console.log(`     Чанк 1 (связи) сохранён: chunkId = ${l1ChunkRes.chunkId}`);
                } else {
                    console.error(`     Не удалось сохранить чанк L1 для ${func.full_name}`);
                }

            } catch (err) {
                console.error(`     Ошибка парсинга L1 для ${func.full_name}:`, err.message);
                l1Result = {
                    function_name: func.full_name,
                    error: err.message,
                    called_functions: [],
                    select_from: [],
                    update_tables: [],
                    insert_tables: []
                };
            }
        }
    }

    console.log(`   Файл ${filename} успешно обработан.\n`);
}

// === Основная логика ===
(async () => {
    if (process.argv.length < 3) {
        console.error('Ошибка: не указан путь к файлу или каталогу.');
        console.error('Использование: node parse_and_upload_sql.js <путь_к_каталогу_или_файлу>');
        console.error('Примеры:');
        console.error('   node parse_and_upload_sql.js .');
        console.error('   node parse_and_upload_sql.js ./sql_files');
        console.error('   node parse_and_upload_sql.js api_auct_sort.sql');
        process.exit(1);
    }

    const targetPath = process.argv[2];
    const fullPath = path.resolve(targetPath);

    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
        console.log(`Обработка всех *.sql файлов в каталоге: ${fullPath}`);

        const files = fs.readdirSync(fullPath)
            .filter(f => f.toLowerCase().endsWith('.sql'))
            .map(f => path.join(fullPath, f));

        if (files.length === 0) {
            console.log('В каталоге нет .sql файлов.');
            process.exit(0);
        }

        for (const file of files) {
            await processSqlFile(file);
        }
    } else if (stat.isFile() && fullPath.toLowerCase().endsWith('.sql')) {
        await processSqlFile(fullPath);
    } else {
        console.error('Указанный путь не является каталогом или .sql-файлом.');
        process.exit(1);
    }

    console.log('Вся обработка завершена!');
})();