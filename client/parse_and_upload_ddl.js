/*
* Загрузка DDL схем (CREATE TABLE) из SQL файлов
* parse_and_upload_ddl.js

cd ./client
# Автономный режим (прямо с БД, без сервера)
node parse_and_upload_ddl.js schema.sql -c TEST --standalone
# Режим через API (требует запущенный сервер)
node parse_and_upload_ddl.js schema.sql -c TEST --api
# Загрузка всех SQL файлов в каталоге
node parse_and_upload_ddl.js . -c TEST
*/

const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Импорт функций из ddlSchemaLoader
const {
    parseTablesFromContent,
    parseIndexesFromContent,
    parseTableL1,
    loadDdlFromFile
} = require('../routes/loaders/ddlSchemaLoader');

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

// === Обработка одного SQL-файла (автономный режим) ===
async function processDdlFileStandalone(filePath, contextCode, dbService) {
    const filename = path.basename(filePath);
    console.log(`\n[Standalone] Обработка файла: ${filename}`);

    try {
        const report = await loadDdlFromFile(filePath, contextCode, dbService);
        
        console.log(`\n[Standalone] Отчет по файлу ${filename}:`);
        console.log(`  - Файл ID: ${report.fileId}`);
        console.log(`  - Новый файл: ${report.isNew}`);
        console.log(`  - Найдено таблиц: ${report.tablesFound}`);
        console.log(`  - Обработано таблиц: ${report.tablesProcessed}`);
        console.log(`  - Найдено индексов: ${report.indexesFound}`);
        
        if (report.errors.length > 0) {
            console.error(`  - Ошибки (${report.errors.length}):`);
            report.errors.forEach(err => console.error(`    * ${err}`));
        }
        
        if (report.tables.length > 0) {
            console.log(`  - Детали по таблицам:`);
            report.tables.forEach(table => {
                console.log(`    * ${table.full_name} (${table.schema}):`);
                console.log(`      - Колонок: ${table.columnsCount}`);
                console.log(`      - Constraints: ${table.constraintsCount}`);
                console.log(`      - AI Item ID: ${table.aiItemId}`);
                console.log(`      - Chunk L0 ID: ${table.chunkL0Id}`);
                if (table.chunkL1Id) {
                    console.log(`      - Chunk L1 ID: ${table.chunkL1Id}`);
                }
                if (table.errors.length > 0) {
                    console.error(`      - Ошибки: ${table.errors.join('; ')}`);
                }
            });
        }
        
        if (report.indexes.length > 0) {
            console.log(`  - Индексы:`);
            report.indexes.forEach(idx => {
                console.log(`    * ${idx.name} ON ${idx.table} (${idx.columns.join(', ')}) [${idx.method}]${idx.unique ? ' UNIQUE' : ''}`);
            });
        }
        
        console.log(`\n[Standalone] Файл ${filename} успешно обработан.\n`);
        return report;
    } catch (err) {
        console.error(`[Standalone] Ошибка при обработке файла ${filename}:`, err.message);
        throw err;
    }
}

// === Обработка одного SQL-файла (режим через API) ===
async function processDdlFileApi(filePath, contextCode) {
    const filename = path.basename(filePath);
    console.log(`\n[API] Обработка файла: ${filename}`);

    let sqlContent;
    try {
        sqlContent = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        console.error(`Не удалось прочитать файл ${filename}:`, err.message);
        return;
    }

    const tables = parseTablesFromContent(sqlContent, filePath);
    const indexes = parseIndexesFromContent(sqlContent, filePath);

    if (tables.length === 0) {
        console.log(`   Нет таблиц в ${filename}`);
        return;
    }

    console.log(`   Найдено таблиц: ${tables.length}, индексов: ${indexes.length}`);

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

    // Загрузка каждой таблицы
    for (const table of tables) {
        console.log(`   → Таблица: ${table.full_name} (${table.columns.length} колонок)`);

        // Создание AI Item
        const aiItemRes = await apiPost('/create-or-update-ai-item', {
            full_name: table.full_name,
            contextCode: contextCode,
            type: 'table',
            sName: table.sname,
            fileId: fileId
        });

        if (!aiItemRes || !aiItemRes.aiItem?.id) {
            console.error(`     Не удалось создать AI Item для ${table.full_name}`);
            continue;
        }

        const aiItemId = aiItemRes.aiItem.id;

        // Сохранение чанка уровня 0
        const chunkContentL0 = {
            full_name: table.full_name,
            schema: table.schema,
            s_name: table.sname,
            columns: table.columns,
            constraints: table.constraints,
            body: table.body
        };

        const chunkContent = { text: chunkContentL0 };
        if (table.comment) {
            chunkContent.comment = table.comment;
        }

        let chunkRes = await apiPost('/save-chunk', {
            fileId: fileId,
            content: chunkContent,
            chunkIndex: 0,
            level: '0-исходник',
            type: 'table',
            full_name: table.full_name,
            s_name: table.sname,
            aiItemId: aiItemId,
            contextCode: contextCode
        });

        if (chunkRes && chunkRes.chunkId) {
            console.log(`     Чанк 0 сохранён: chunkId = ${chunkRes.chunkId}`);

            // L1 связи
            const l1Result = parseTableL1(table);
            
            if (l1Result.foreign_keys.length > 0) {
                const l1ChunkRes = await apiPost('/save-chunk', {
                    fileId: fileId,
                    content: l1Result,
                    chunkIndex: 0,
                    level: '1-связи',
                    type: 'json',
                    full_name: table.full_name,
                    s_name: table.sname,
                    aiItemId: aiItemId
                });

                if (l1ChunkRes && l1ChunkRes.chunkId) {
                    console.log(`     Чанк 1 (связи) сохранён: chunkId = ${l1ChunkRes.chunkId}, FK: ${l1Result.foreign_keys.length}`);
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
        console.error('Использование: node parse_and_upload_ddl.js <путь_к_каталогу_или_файлу> [опции]');
        console.error('Опции:');
        console.error('  -c, --context <код>    Код контекста (по умолчанию: TEST)');
        console.error('  --standalone          Автономный режим (прямо с БД, по умолчанию)');
        console.error('  --api                 Режим через API (требует запущенный сервер)');
        console.error('Примеры:');
        console.error('  node parse_and_upload_ddl.js schema.sql -c TEST --standalone');
        console.error('  node parse_and_upload_ddl.js ../KB/current_DB_schema.sql -c KOSMOS');
        console.error('  node parse_and_upload_ddl.js . -c TEST');
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
            console.log(`Обработка всех *.sql файлов в каталоге: ${fullPath}`);

            files = fs.readdirSync(fullPath)
                .filter(f => f.toLowerCase().endsWith('.sql'))
                .map(f => path.join(fullPath, f));

            if (files.length === 0) {
                console.log('В каталоге нет .sql файлов.');
                process.exit(0);
            }
        } else if (stat.isFile() && fullPath.toLowerCase().endsWith('.sql')) {
            files = [fullPath];
        } else {
            console.error('Указанный путь не является каталогом или .sql-файлом.');
            process.exit(1);
        }

        // Обработка файлов
        for (const file of files) {
            if (mode === 'standalone') {
                await processDdlFileStandalone(file, contextCode, dbService);
            } else {
                await processDdlFileApi(file, contextCode);
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
