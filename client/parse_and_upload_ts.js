/*
* Загрузка TypeScript функций, классов, типов и интерфейсов в AIAN Vector
* parse_and_upload_ts.js

cd ./client
# Автономный режим (прямо с БД, без сервера)
node parse_and_upload_ts.js test_file.ts -c TEST --standalone
# Режим через API (требует запущенный сервер)
node parse_and_upload_ts.js test_file.ts -c TEST --api
# Загрузка всех TS файлов в каталоге (автономный режим по умолчанию)
node parse_and_upload_ts.js . -c TEST
*/

const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Импорт функций из tsFunctionLoader
const {
    parseTsFunctionL1,
    parseTsEntitiesFromContent,
    loadTsFunctionsFromFile
} = require('../routes/loaders/tsFunctionLoader');

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
            return null;
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

// === Обработка одного TS-файла (автономный режим) ===
async function processTsFileStandalone(filePath, contextCode, dbService) {
    const filename = path.basename(filePath);
    console.log(`\n[Standalone] Обработка файла: ${filename}`);

    try {
        const report = await loadTsFunctionsFromFile(filePath, contextCode, dbService);
        
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
                if (func.l1CalledFunctions && func.l1CalledFunctions.length > 0) {
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

// === Обработка одного TS-файла (режим через API) ===
async function processTsFileApi(filePath, contextCode) {
    const filename = path.basename(filePath);
    console.log(`\n[API] Обработка файла: ${filename}`);

    let tsContent;
    try {
        tsContent = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        console.error(`Не удалось прочитать файл ${filename}:`, err.message);
        return;
    }

    const entities = parseTsEntitiesFromContent(tsContent, filePath);

    if (entities.length === 0) {
        console.log(`   Нет сущностей в ${filename}`);
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

        const chunkContent = { text: chunkContentL0 };
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

            // Парсинг L1 только для функций, методов и классов
            if (['function', 'method', 'arrow', 'class'].includes(entity.type)) {
                try {
                    const l1Result = await parseTsFunctionL1(entity.body);
                    console.log(`     Успешно построен L1: ${l1Result.called_functions.join(', ')}`);
                    
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
        console.error('Использование: node parse_and_upload_ts.js <путь_к_каталогу_или_файлу> [опции]');
        console.error('Опции:');
        console.error('  -c, --context <код>    Код контекста (по умолчанию: TEST)');
        console.error('  --standalone          Автономный режим (прямо с БД, по умолчанию)');
        console.error('  --api                 Режим через API (требует запущенный сервер)');
        console.error('Примеры:');
        console.error('  node parse_and_upload_ts.js test_file.ts -c TEST --standalone');
        console.error('  node parse_and_upload_ts.js test_file.ts -c TEST --api');
        console.error('  node parse_and_upload_ts.js . -c TEST');
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
            console.log(`Обработка всех *.ts файлов в каталоге: ${fullPath}`);

            files = fs.readdirSync(fullPath)
                .filter(f => {
                    const lower = f.toLowerCase();
                    return (lower.endsWith('.ts') || lower.endsWith('.tsx')) && 
                           !lower.endsWith('.d.ts') && 
                           !lower.endsWith('.test.ts') &&
                           !lower.endsWith('.spec.ts');
                })
                .map(f => path.join(fullPath, f));

            if (files.length === 0) {
                console.log('В каталоге нет .ts/.tsx файлов.');
                process.exit(0);
            }
        } else if (stat.isFile() && (fullPath.toLowerCase().endsWith('.ts') || fullPath.toLowerCase().endsWith('.tsx'))) {
            files = [fullPath];
        } else {
            console.error('Указанный путь не является каталогом или .ts/.tsx-файлом.');
            process.exit(1);
        }

        // Обработка файлов
        for (const file of files) {
            if (mode === 'standalone') {
                await processTsFileStandalone(file, contextCode, dbService);
            } else {
                await processTsFileApi(file, contextCode);
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

