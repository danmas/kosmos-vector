// Загрузчик DDL схем (CREATE TABLE) из SQL файлов
// routes/loaders/ddlSchemaLoader.js

const fs = require('fs');
const path = require('path');

/**
 * Парсинг CREATE TABLE из SQL контента
 * @param {string} sqlContent - содержимое SQL файла
 * @param {string} filePath - путь к файлу (для отладки)
 * @returns {Array} массив таблиц с их структурой
 */
function parseTablesFromContent(sqlContent, filePath) {
    const tables = [];
    
    // Regex для поиска CREATE TABLE
    // Поддерживает: create table, CREATE TABLE, create table if not exists
    const tableRegex = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)?)\s*\(/gi;
    
    let tableMatch;
    while ((tableMatch = tableRegex.exec(sqlContent)) !== null) {
        const tableName = tableMatch[1];
        const tableStart = tableMatch.index;
        
        // Найти конец определения таблицы (закрывающая скобка + ;)
        let tableEnd = findTableEnd(sqlContent, tableStart + tableMatch[0].length);
        if (tableEnd === -1) {
            console.warn(`[DDL-Loader] Не найден конец таблицы ${tableName}`);
            continue;
        }
        
        const tableDefinition = sqlContent.substring(tableStart, tableEnd);
        
        // Извлечь колонки
        const columns = parseColumns(tableDefinition);
        
        // Извлечь constraints
        const constraints = parseConstraints(tableDefinition);
        
        // Найти комментарий к таблице (comment on table)
        const tableComment = findTableComment(sqlContent, tableName);
        
        // Найти комментарии к колонкам
        const columnComments = findColumnComments(sqlContent, tableName);
        
        // Разбор имени на schema.table
        const parts = tableName.split('.');
        const schema = parts.length > 1 ? parts[0] : 'public';
        const shortName = parts.length > 1 ? parts[1] : parts[0];
        
        tables.push({
            full_name: tableName,
            schema: schema,
            sname: shortName,
            type: 'table',
            comment: tableComment,
            columns: columns.map(col => ({
                ...col,
                comment: columnComments[col.name] || null
            })),
            constraints: constraints,
            body: tableDefinition
        });
    }
    
    return tables;
}

/**
 * Найти конец определения таблицы
 */
function findTableEnd(text, startPos) {
    let parenLevel = 1; // Уже внутри первой открывающей скобки
    let inString = false;
    let stringChar = null;
    
    for (let i = startPos; i < text.length; i++) {
        const char = text[i];
        const prevChar = i > 0 ? text[i - 1] : '';
        
        // Обработка строк
        if (!inString && (char === "'" || char === '"')) {
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
        if (char === '(') {
            parenLevel++;
        } else if (char === ')') {
            parenLevel--;
            if (parenLevel === 0) {
                // Ищем ; после закрывающей скобки
                const afterParen = text.substring(i + 1, i + 50);
                const semicolonMatch = afterParen.match(/^\s*;/);
                if (semicolonMatch) {
                    return i + 1 + semicolonMatch[0].length;
                }
                return i + 1;
            }
        }
    }
    
    return -1;
}

/**
 * Парсинг колонок из определения таблицы
 */
function parseColumns(tableDefinition) {
    const columns = [];
    
    // Извлекаем содержимое между ( и )
    const bodyMatch = tableDefinition.match(/\(\s*([\s\S]*)\s*\)/);
    if (!bodyMatch) return columns;
    
    const body = bodyMatch[1];
    
    // Разбиваем по запятым, но учитываем вложенные скобки
    const parts = splitByComma(body);
    
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        
        // Пропускаем constraints (PRIMARY KEY, FOREIGN KEY, CONSTRAINT, UNIQUE, CHECK)
        if (trimmed.match(/^(primary\s+key|foreign\s+key|constraint|unique|check)\b/i)) {
            continue;
        }
        
        // Парсим колонку: name type [constraints...]
        const columnMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(.+)/i);
        if (columnMatch) {
            const columnName = columnMatch[1];
            const rest = columnMatch[2];
            
            // Извлекаем тип данных (до первого constraint keyword или конца)
            const typeMatch = rest.match(/^([a-zA-Z0-9_]+(?:\s*\([^)]*\))?(?:\s*\[\s*\])?)/i);
            const dataType = typeMatch ? typeMatch[1].trim() : rest.split(/\s+/)[0];
            
            // Проверяем nullable
            const notNull = /\bnot\s+null\b/i.test(rest);
            const nullable = !notNull;
            
            // Проверяем primary key
            const isPrimaryKey = /\bprimary\s+key\b/i.test(rest);
            
            // Проверяем unique
            const isUnique = /\bunique\b/i.test(rest);
            
            // Извлекаем default
            const defaultMatch = rest.match(/\bdefault\s+([^,\n]+?)(?:\s+(?:not\s+null|null|primary|unique|references|check|constraint)|\s*$)/i);
            const defaultValue = defaultMatch ? defaultMatch[1].trim() : null;
            
            // Извлекаем references (foreign key)
            const refMatch = rest.match(/\breferences\s+([a-zA-Z0-9_.]+)\s*(?:\(([^)]+)\))?/i);
            const references = refMatch ? {
                table: refMatch[1],
                column: refMatch[2] || 'id'
            } : null;
            
            columns.push({
                name: columnName,
                type: dataType,
                nullable: nullable,
                primaryKey: isPrimaryKey,
                unique: isUnique,
                default: defaultValue,
                references: references
            });
        }
    }
    
    return columns;
}

/**
 * Парсинг constraints из определения таблицы
 */
function parseConstraints(tableDefinition) {
    const constraints = [];
    
    const bodyMatch = tableDefinition.match(/\(\s*([\s\S]*)\s*\)/);
    if (!bodyMatch) return constraints;
    
    const body = bodyMatch[1];
    const parts = splitByComma(body);
    
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        
        // PRIMARY KEY
        if (trimmed.match(/^primary\s+key\s*\(/i)) {
            const colsMatch = trimmed.match(/primary\s+key\s*\(([^)]+)\)/i);
            if (colsMatch) {
                constraints.push({
                    type: 'PRIMARY KEY',
                    columns: colsMatch[1].split(',').map(c => c.trim())
                });
            }
        }
        // CONSTRAINT ... PRIMARY KEY
        else if (trimmed.match(/^constraint\s+\w+\s+primary\s+key/i)) {
            const nameMatch = trimmed.match(/^constraint\s+(\w+)/i);
            const colsMatch = trimmed.match(/primary\s+key\s*\(([^)]+)\)/i);
            if (colsMatch) {
                constraints.push({
                    type: 'PRIMARY KEY',
                    name: nameMatch ? nameMatch[1] : null,
                    columns: colsMatch[1].split(',').map(c => c.trim())
                });
            }
        }
        // FOREIGN KEY
        else if (trimmed.match(/^(?:constraint\s+\w+\s+)?foreign\s+key/i)) {
            const nameMatch = trimmed.match(/^constraint\s+(\w+)/i);
            const fkMatch = trimmed.match(/foreign\s+key\s*\(([^)]+)\)\s*references\s+([a-zA-Z0-9_.]+)\s*(?:\(([^)]+)\))?/i);
            if (fkMatch) {
                constraints.push({
                    type: 'FOREIGN KEY',
                    name: nameMatch ? nameMatch[1] : null,
                    columns: fkMatch[1].split(',').map(c => c.trim()),
                    references: {
                        table: fkMatch[2],
                        columns: fkMatch[3] ? fkMatch[3].split(',').map(c => c.trim()) : ['id']
                    }
                });
            }
        }
        // UNIQUE
        else if (trimmed.match(/^(?:constraint\s+\w+\s+)?unique\s*\(/i)) {
            const nameMatch = trimmed.match(/^constraint\s+(\w+)/i);
            const colsMatch = trimmed.match(/unique\s*\(([^)]+)\)/i);
            if (colsMatch) {
                constraints.push({
                    type: 'UNIQUE',
                    name: nameMatch ? nameMatch[1] : null,
                    columns: colsMatch[1].split(',').map(c => c.trim())
                });
            }
        }
        // CHECK
        else if (trimmed.match(/^(?:constraint\s+\w+\s+)?check\s*\(/i)) {
            const nameMatch = trimmed.match(/^constraint\s+(\w+)/i);
            const checkMatch = trimmed.match(/check\s*\((.+)\)/i);
            if (checkMatch) {
                constraints.push({
                    type: 'CHECK',
                    name: nameMatch ? nameMatch[1] : null,
                    expression: checkMatch[1]
                });
            }
        }
    }
    
    return constraints;
}

/**
 * Разбиение строки по запятым с учётом вложенных скобок
 */
function splitByComma(text) {
    const parts = [];
    let current = '';
    let parenLevel = 0;
    let inString = false;
    let stringChar = null;
    
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const prevChar = i > 0 ? text[i - 1] : '';
        
        if (!inString && (char === "'" || char === '"')) {
            inString = true;
            stringChar = char;
            current += char;
            continue;
        }
        if (inString && char === stringChar && prevChar !== '\\') {
            inString = false;
            stringChar = null;
            current += char;
            continue;
        }
        if (inString) {
            current += char;
            continue;
        }
        
        if (char === '(') {
            parenLevel++;
            current += char;
        } else if (char === ')') {
            parenLevel--;
            current += char;
        } else if (char === ',' && parenLevel === 0) {
            parts.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    
    if (current.trim()) {
        parts.push(current.trim());
    }
    
    return parts;
}

/**
 * Найти комментарий к таблице
 */
function findTableComment(sqlContent, tableName) {
    // comment on table tableName is '...'
    const regex = new RegExp(
        `comment\\s+on\\s+table\\s+${tableName.replace('.', '\\.')}\\s+is\\s+'([^']*)'`,
        'i'
    );
    const match = sqlContent.match(regex);
    return match ? match[1] : null;
}

/**
 * Найти комментарии к колонкам
 */
function findColumnComments(sqlContent, tableName) {
    const comments = {};
    // comment on column tableName.columnName is '...'
    const regex = new RegExp(
        `comment\\s+on\\s+column\\s+${tableName.replace('.', '\\.')}\\.([a-zA-Z0-9_]+)\\s+is\\s+'([^']*)'`,
        'gi'
    );
    let match;
    while ((match = regex.exec(sqlContent)) !== null) {
        comments[match[1]] = match[2];
    }
    return comments;
}

/**
 * Парсинг CREATE INDEX из SQL контента
 */
function parseIndexesFromContent(sqlContent, filePath) {
    const indexes = [];
    
    // create [unique] index [if not exists] name on table (columns) [using method]
    const indexRegex = /create\s+(?:(unique)\s+)?index\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_]+)\s+on\s+([a-zA-Z0-9_.]+)\s*(?:using\s+(\w+)\s*)?\(([^)]+)\)/gi;
    
    let match;
    while ((match = indexRegex.exec(sqlContent)) !== null) {
        indexes.push({
            name: match[2],
            table: match[3],
            unique: !!match[1],
            method: match[4] || 'btree',
            columns: match[5].split(',').map(c => c.trim())
        });
    }
    
    return indexes;
}

/**
 * Извлечение L1 связей для таблицы (FK ссылки)
 */
function parseTableL1(tableData) {
    const references = [];
    
    // Из колонок
    for (const col of tableData.columns || []) {
        if (col.references) {
            references.push({
                type: 'column_fk',
                column: col.name,
                referencedTable: col.references.table,
                referencedColumn: col.references.column
            });
        }
    }
    
    // Из constraints
    for (const constraint of tableData.constraints || []) {
        if (constraint.type === 'FOREIGN KEY' && constraint.references) {
            references.push({
                type: 'constraint_fk',
                name: constraint.name,
                columns: constraint.columns,
                referencedTable: constraint.references.table,
                referencedColumns: constraint.references.columns
            });
        }
    }
    
    return {
        foreign_keys: references,
        referenced_tables: [...new Set(references.map(r => r.referencedTable))]
    };
}

/**
 * Загрузка DDL схем из файла
 */
async function loadDdlFromFile(filePath, contextCode, dbService, pipelineState = null) {
    const filename = path.basename(filePath);
    console.log(`[DDL-Loader] Обработка файла: ${filename}`);
    
    const report = {
        filename: filename,
        fileId: null,
        isNew: false,
        tablesFound: 0,
        tablesProcessed: 0,
        indexesFound: 0,
        tables: [],
        indexes: [],
        errors: []
    };
    
    let sqlContent;
    try {
        sqlContent = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        const errorMsg = `Не удалось прочитать файл ${filename}: ${err.message}`;
        console.error(`[DDL-Loader] ${errorMsg}`);
        report.errors.push(errorMsg);
        return report;
    }
    
    // Парсинг таблиц
    const tables = parseTablesFromContent(sqlContent, filePath);
    report.tablesFound = tables.length;
    
    // Парсинг индексов
    const indexes = parseIndexesFromContent(sqlContent, filePath);
    report.indexesFound = indexes.length;
    report.indexes = indexes;
    
    if (tables.length === 0) {
        console.log(`[DDL-Loader] Нет таблиц в ${filename}`);
        return report;
    }
    
    console.log(`[DDL-Loader] Найдено таблиц: ${tables.length}, индексов: ${indexes.length}`);
    
    // Регистрация файла
    try {
        const { id: fileId, isNew } = await dbService.saveFileInfo(filename, sqlContent, filePath, contextCode);
        report.fileId = fileId;
        report.isNew = isNew;
        console.log(`[DDL-Loader] Файл зарегистрирован: fileId = ${fileId}, isNew = ${isNew}`);
    } catch (err) {
        const errorMsg = `Не удалось зарегистрировать файл ${filename}: ${err.message}`;
        console.error(`[DDL-Loader] ${errorMsg}`);
        report.errors.push(errorMsg);
        return report;
    }
    
    // Обработка каждой таблицы
    for (const table of tables) {
        console.log(`[DDL-Loader] → Таблица: ${table.full_name}`);
        
        const tableReport = {
            full_name: table.full_name,
            sname: table.sname,
            schema: table.schema,
            columnsCount: table.columns.length,
            constraintsCount: table.constraints.length,
            aiItemId: null,
            chunkL0Id: null,
            chunkL1Id: null,
            errors: []
        };
        
        try {
            // Создание AI Item
            const aiItem = await dbService.createAiItem({
                full_name: table.full_name,
                contextCode: contextCode,
                type: 'table',
                sName: table.sname,
                fileId: report.fileId
            });
            
            if (!aiItem || !aiItem.id) {
                const errorMsg = `Не удалось создать AI Item для ${table.full_name}`;
                console.error(`[DDL-Loader] ${errorMsg}`);
                tableReport.errors.push(errorMsg);
                report.tables.push(tableReport);
                continue;
            }
            
            tableReport.aiItemId = aiItem.id;
            
            // Сохранение чанка L0 (DDL)
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
            
            try {
                const chunkIdL0 = await dbService.saveChunkVector(
                    report.fileId,
                    chunkContent,
                    null,
                    {
                        type: 'table',
                        level: '0-исходник',
                        full_name: table.full_name,
                        s_name: table.sname
                    },
                    null,
                    contextCode
                );
                
                tableReport.chunkL0Id = chunkIdL0;
                
                await dbService.pgClient.query(
                    'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
                    [tableReport.aiItemId, chunkIdL0]
                );
                
                console.log(`[DDL-Loader] Чанк 0 сохранён: chunkId = ${chunkIdL0}`);
                
                // L1 связи (FK)
                const l1Result = parseTableL1(table);
                
                if (l1Result.foreign_keys.length > 0) {
                    const chunkIdL1 = await dbService.saveChunkVector(
                        report.fileId,
                        { text: l1Result },
                        null,
                        {
                            type: 'json',
                            level: '1-связи',
                            full_name: table.full_name,
                            s_name: table.sname
                        },
                        chunkIdL0,
                        contextCode
                    );
                    
                    tableReport.chunkL1Id = chunkIdL1;
                    
                    await dbService.pgClient.query(
                        'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
                        [tableReport.aiItemId, chunkIdL1]
                    );
                    
                    console.log(`[DDL-Loader] Чанк 1 (связи) сохранён: chunkId = ${chunkIdL1}, FK: ${l1Result.foreign_keys.length}`);
                }
                
                report.tablesProcessed++;
            } catch (err) {
                const errorMsg = `Ошибка сохранения чанка для ${table.full_name}: ${err.message}`;
                console.error(`[DDL-Loader] ${errorMsg}`);
                tableReport.errors.push(errorMsg);
            }
        } catch (err) {
            const errorMsg = `Ошибка обработки таблицы ${table.full_name}: ${err.message}`;
            console.error(`[DDL-Loader] ${errorMsg}`);
            tableReport.errors.push(errorMsg);
        }
        
        report.tables.push(tableReport);
    }
    
    console.log(`[DDL-Loader] Файл ${filename} обработан: ${report.tablesProcessed}/${report.tablesFound} таблиц`);
    return report;
}

module.exports = {
    parseTablesFromContent,
    parseIndexesFromContent,
    parseTableL1,
    loadDdlFromFile
};
