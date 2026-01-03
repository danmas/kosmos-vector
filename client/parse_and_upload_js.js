/*
* Загрузка JavaScript функций и классов в AIAN Vector
* parse_and_upload_js.js

cd ./client
# Автономный режим (прямо с БД, без сервера)
node parse_and_upload_js.js test_file.js -c TEST --standalone
# Режим через API (требует запущенный сервер)
node parse_and_upload_js.js test_file.js -c TEST --api
# Загрузка всех JS файлов в каталоге (автономный режим по умолчанию)
node parse_and_upload_js.js . -c TEST
*/

const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Импорт функций из jsFunctionLoader
const {
    parseJsFunctionL1,
    parseJsEntitiesFromContent,
    loadJsFunctionsFromFile
} = require('../routes/loaders/jsFunctionLoader');

// Импорт для автономного режима
const { Client } = require('pg');
const DbService = require('../packages/core/DbService');

// Импорт fetch для API режима
const fetch = require('node-fetch');

// === Конфигурация API ===
const BASE_URL = 'http://localhost:3200';


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

// === Инициализация DbService для автономного режима ===
async function initDbService() {
    const pgClient = new Client({
        host: process.env.PGHOST || 'localhost',
        port: process.env.PGPORT || 5432,
        database: process.env.PGDATABASE || 'postgres',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres'
    });

    await pgClient.connect();
    console.log('[Standalone] Подключение к PostgreSQL установлено');

    const dbService = new DbService(pgClient);
    await dbService.initializeSchema();
    console.log('[Standalone] Схема БД инициализирована');

    return { dbService, pgClient };
}

// === Обработка одного JS-файла (автономный режим) ===
async function processJsFileStandalone(filePath, contextCode, dbService) {
    const filename = path.basename(filePath);
    console.log(`\n[Standalone] Обработка файла: ${filename}`);

    try {
        const report = await loadJsFunctionsFromFile(filePath, contextCode, dbService);
        
        console.log(`\n[Standalone] Отчет по файлу ${filename}:`);
        console.log(`  - Файл ID: ${report.fileId}`);
        console.log(`  - Новый файл: ${report.isNew}`);
        console.log(`  - Найдено сущностей: ${report.functionsFound}`);
        console.log(`  - Обработано сущностей: ${report.functionsProcessed}`);
        
        if (report.errors.length > 0) {
            console.error(`  - Ошибки (${report.errors.length}):`);
            report.errors.forEach(err => console.error(`    * ${err}`));
        }
        
        if (report.functions.length > 0) {
            console.log(`  - Детали по сущностям:`);
            report.functions.forEach(func => {
                console.log(`    * ${func.full_name} (${func.type}):`);
                console.log(`      - AI Item ID: ${func.aiItemId}`);
                console.log(`      - Chunk L0 ID: ${func.chunkL0Id}`);
                console.log(`      - Chunk L1 ID: ${func.chunkL1Id}`);
                console.log(`      - L1 распарсен: ${func.l1Parsed}`);
                if (func.l1CalledFunctions.length > 0) {
                    console.log(`      - Вызываемые функции: ${func.l1CalledFunctions.join(', ')}`);
                }
                if (func.errors.length > 0) {
                    console.error(`      - Ошибки: ${func.errors.join('; ')}`);
                }
            });
        }
        
        console.log(`\n[Standalone] Файл ${filename} успешно обработан.\n`);
        return report;
    } catch (err) {
        console.error(`[Standalone] Ошибка при обработке файла ${filename}:`, err.message);
        throw err;
    }
}

// === Обработка одного JS-файла (режим через API) ===
async function processJsFileApi(filePath, contextCode) {
    const filename = path.basename(filePath);
    console.log(`\n[API] Обработка файла: ${filename}`);

    let jsContent;
    try {
        jsContent = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        console.error(`Не удалось прочитать файл ${filename}:`, err.message);
        return;
    }

    const entities = parseJsEntitiesFromContent(jsContent, filePath);

    if (entities.length === 0) {
        console.log(`   Нет функций или классов в ${filename}`);
        return;
    }

    console.log(`   Найдено сущностей: ${entities.length}`);

    // Регистрация файла
    const registerRes = await apiPost('/register-file', {
        filename: filename,
        contextCode: contextCode
    });

    if (!registerRes || !registerRes.fileId) {
        console.error(`   Не удалось зарегистрировать файл ${filename}. Пропускаем.`);
        return;
    }

    const fileId = registerRes.fileId;
    console.log(`   Файл зарегистрирован: fileId = ${fileId}`);

    // Загрузка каждой сущности
    for (const entity of entities) {
        console.log(`   → Сущность: ${entity.full_name} (${entity.sname}, тип: ${entity.type})`);

        // Создание AI Item
        const aiItemRes = await apiPost('/create-or-update-ai-item', {
            full_name: entity.full_name,
            contextCode: contextCode,
            type: entity.type,
            sName: entity.sname,
            fileId: fileId
        });

        if (!aiItemRes || !aiItemRes.aiItem?.id) {
            console.error(`     Не удалось создать AI Item для ${entity.full_name}`);
            continue;
        }

        const aiItemId = aiItemRes.aiItem.id;

        // Сохранение чанка уровня 0
        const chunkContentL0 = {
            full_name: entity.full_name,
            s_name: entity.sname,
            signature: entity.signature,
            body: entity.body
        };

        const chunkContent = {
            text: chunkContentL0
        };
        if (entity.comment && typeof entity.comment === 'string' && entity.comment.trim()) {
            chunkContent.comment = entity.comment.trim();
        }

        let chunkRes = await apiPost('/save-chunk', {
            fileId: fileId,
            content: chunkContent,
            chunkIndex: 0,
            level: '0-исходник',
            type: entity.type,
            full_name: entity.full_name,
            s_name: entity.sname,
            aiItemId: aiItemId,
            contextCode: contextCode
        });

        if (chunkRes && chunkRes.chunkId) {
            console.log(`     Чанк 0 сохранён: chunkId = ${chunkRes.chunkId}`);

            let l1Result;
            try {
                l1Result = await parseJsFunctionL1(entity.body);
                console.log(`     Успешно построен L1: ${(l1Result).called_functions.join(', ')}`);
                
                // Сохранение чанка уровня 1 (связи)
                const l1ChunkRes = await apiPost('/save-chunk', {
                    fileId: fileId,
                    content: l1Result,
                    chunkIndex: 0,
                    level: '1-связи',
                    type: 'json',
                    full_name: entity.full_name,
                    s_name: entity.sname,
                    aiItemId: aiItemId
                });

                if (l1ChunkRes && l1ChunkRes.chunkId) {
                    console.log(`     Чанк 1 (связи) сохранён: chunkId = ${l1ChunkRes.chunkId}`);
                } else {
                    console.error(`     Не удалось сохранить чанк L1 для ${entity.full_name}`);
                }

            } catch (err) {
                console.error(`     Ошибка парсинга L1 для ${entity.full_name}:`, err.message);
            }
        }
    }

    console.log(`   Файл ${filename} успешно обработан.\n`);
}

// === Парсинг аргументов командной строки ===
function parseArgs() {
    const args = {
        targetPath: null,
        contextCode: 'TEST',
        mode: 'standalone' // по умолчанию автономный режим
    };

    for (let i = 2; i < process.argv.length; i++) {
        const arg = process.argv[i];
        
        if (arg === '-c' || arg === '--context') {
            args.contextCode = process.argv[++i] || 'TEST';
        } else if (arg === '--standalone') {
            args.mode = 'standalone';
        } else if (arg === '--api') {
            args.mode = 'api';
        } else if (!args.targetPath) {
            args.targetPath = arg;
        }
    }

    return args;
}

// === Основная логика ===
(async () => {
    const args = parseArgs();

    if (!args.targetPath) {
        console.error('Ошибка: не указан путь к файлу или каталогу.');
        console.error('Использование: node parse_and_upload_js.js <путь_к_каталогу_или_файлу> [опции]');
        console.error('Опции:');
        console.error('  -c, --context <код>    Код контекста (по умолчанию: TEST)');
        console.error('  --standalone          Автономный режим (прямо с БД, по умолчанию)');
        console.error('  --api                 Режим через API (требует запущенный сервер)');
        console.error('Примеры:');
        console.error('  node parse_and_upload_js.js test_file.js -c TEST --standalone');
        console.error('  node parse_and_upload_js.js test_file.js -c TEST --api');
        console.error('  node parse_and_upload_js.js . -c TEST');
        process.exit(1);
    }

    const targetPath = args.targetPath;
    const fullPath = path.resolve(targetPath);
    const contextCode = args.contextCode;
    const mode = args.mode;

    console.log(`Режим работы: ${mode === 'standalone' ? 'Автономный (прямо с БД)' : 'Через API'}`);
    console.log(`Код контекста: ${contextCode}`);

    let dbService = null;
    let pgClient = null;

    // Инициализация для автономного режима
    if (mode === 'standalone') {
        try {
            const db = await initDbService();
            dbService = db.dbService;
            pgClient = db.pgClient;
        } catch (err) {
            console.error('[Standalone] Ошибка инициализации БД:', err.message);
            process.exit(1);
        }
    }

    try {
        // Проверка существования пути
        if (!fs.existsSync(fullPath)) {
            console.error(`Ошибка: путь не существует: ${fullPath}`);
            console.error('Убедитесь, что файл или каталог существует.');
            process.exit(1);
        }

        const stat = fs.statSync(fullPath);
        let files = [];

        if (stat.isDirectory()) {
            console.log(`Обработка всех *.js файлов в каталоге: ${fullPath}`);

            files = fs.readdirSync(fullPath)
                .filter(f => f.toLowerCase().endsWith('.js') && !f.toLowerCase().endsWith('.test.js'))
                .map(f => path.join(fullPath, f));

            if (files.length === 0) {
                console.log('В каталоге нет .js файлов.');
                process.exit(0);
            }
        } else if (stat.isFile()) {
            if (!fullPath.toLowerCase().endsWith('.js')) {
                console.error(`Ошибка: файл должен иметь расширение .js: ${fullPath}`);
                process.exit(1);
            }
            files = [fullPath];
        } else {
            console.error('Указанный путь не является каталогом или файлом.');
            process.exit(1);
        }

        // Обработка файлов
        for (const file of files) {
            if (mode === 'standalone') {
                await processJsFileStandalone(file, contextCode, dbService);
            } else {
                await processJsFileApi(file, contextCode);
            }
        }

        console.log('Вся обработка завершена!');
    } catch (err) {
        console.error('Критическая ошибка:', err.message);
        process.exit(1);
    } finally {
        // Закрытие соединения с БД в автономном режиме
        if (pgClient) {
            await pgClient.end();
            console.log('[Standalone] Соединение с БД закрыто');
        }
    }
})();

