// Загрузчик схем таблиц
// routes/loaders/tableSchemaLoader.js

const path = require('path');

// Динамический импорт pgMcp (TypeScript модуль)
let pgMcp = null;
async function getPgMcp() {
  if (!pgMcp) {
    // Используем динамический импорт для TypeScript модуля
    const pgMcpModule = await import('../../src/pg-mcp.ts');
    pgMcp = pgMcpModule.pgMcp;
  }
  return pgMcp;
}

/**
 * Экранирование строки для использования в SQL запросе
 * @param {string} str - Строка для экранирования
 * @returns {string} Экранированная строка
 */
function escapeSqlString(str) {
  return "'" + str.replace(/'/g, "''") + "'";
}

/**
 * Получение списка таблиц с фильтрацией
 * Использует клиентскую БД через pg-mcp.ts
 * @param {string} schema - Имя схемы
 * @param {string[]} includePatterns - Паттерны для включения (SQL LIKE, приоритетнее excludePatterns)
 * @param {string[]} excludePatterns - Паттерны для исключения (SQL LIKE)
 * @param {string[]} excludeNames - Точные имена для исключения
 */
async function getFilteredTableNames(schema, includePatterns = [], excludePatterns = [], excludeNames = []) {
  // Получаем экземпляр pgMcp для работы с клиентской БД
  const pgMcpInstance = await getPgMcp();
  
  // Экранируем значения для предотвращения SQL injection
  const escapedSchema = escapeSqlString(schema);
  const escapedPattern = escapeSqlString('\\_%');
  
  // SQL запрос с прямыми значениями (MCP не поддерживает параметризованные запросы)
  let query = `
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = ${escapedSchema} 
      AND NOT (table_name LIKE ${escapedPattern})
  `;
  
  // Логика приоритетов:
  // - include_patterns имеет приоритет над exclude_patterns
  // - Таблицы, соответствующие include_patterns, включаются ВСЕГДА (exclude не применяется)
  // - exclude_patterns применяется только к таблицам, НЕ попавшим в include_patterns
  
  const hasInclude = includePatterns && includePatterns.length > 0;
  const hasExclude = excludePatterns && excludePatterns.length > 0;
  
  if (hasInclude && hasExclude) {
    // Комбинированная логика: include ИЛИ (не exclude)
    const includeConditions = includePatterns.map(p => `table_name LIKE ${escapeSqlString(p)}`).join(' OR ');
    const excludeConditions = excludePatterns.map(p => `NOT (table_name LIKE ${escapeSqlString(p)})`).join(' AND ');
    query += ` AND ((${includeConditions}) OR (${excludeConditions}))`;
  } else if (hasInclude) {
    // Только include — берём только соответствующие
    const includeConditions = includePatterns.map(p => `table_name LIKE ${escapeSqlString(p)}`).join(' OR ');
    query += ` AND (${includeConditions})`;
  } else if (hasExclude) {
    // Только exclude — исключаем соответствующие
    for (const pattern of excludePatterns) {
      query += ` AND NOT (table_name LIKE ${escapeSqlString(pattern)})`;
    }
  }
  
  // Добавляем исключения по точным именам
  if (excludeNames && excludeNames.length > 0) {
    const excludedNamesList = excludeNames.map(name => escapeSqlString(name)).join(', ');
    query += ` AND table_name NOT IN (${excludedNamesList})`;
  }
  
  query += ' ORDER BY table_name';
  
  console.log(`[Table-Loader] SQL запрос: ${query}`);
  
  // Выполняем запрос через клиентскую БД
  const result = await pgMcpInstance.executeQuery(query);
  

  // Извлекаем table_name из результата
  // executeQuery возвращает {columns: string[], rows: any[][]}
  const tableNameIndex = result.columns.findIndex(col => col === 'table_name');
  
  if (tableNameIndex >= 0) {
    // Если нашли колонку table_name, используем её индекс
    return result.rows.map(row => row[tableNameIndex]).filter(Boolean);
  } else if (result.columns.length > 0) {
    // Иначе берём первую колонку
    return result.rows.map(row => row[0]).filter(Boolean);
  }
  
  return [];
}

/**
 * Генерация виртуального имени файла для таблицы
 */
function getVirtualFilename() {
  if (!process.env.POSTGRES_URL) {
    return 'from_db_unknown.ddl';
  }
  
  try {
    const postgresUrl = new URL(process.env.POSTGRES_URL);
    const host = postgresUrl.hostname || 'localhost';
    const port = postgresUrl.port || '5432';
    const dbname = postgresUrl.pathname.slice(1) || 'unknown';
    return `from_db_${host}_${port}_${dbname}.ddl`;
  } catch (err) {
    return 'from_db_unknown.ddl';
  }
}

/**
 * Загрузка схемы таблицы
 * @param {string} fullTableName - Полное имя таблицы (schema.table)
 * @param {string} contextCode - Код контекста
 * @param {DbService} dbService - Экземпляр DbService
 * @param {PipelineStateManager} pipelineState - Менеджер состояния pipeline (опционально)
 * @returns {Promise<Object>} Отчет о загрузке таблицы
 */
async function loadTableSchema(fullTableName, contextCode, dbService, pipelineState = null) {
  console.log(`[Table-Loader] Обработка таблицы: ${fullTableName}`);

  // Инициализация отчета
  const report = {
    fullName: fullTableName,
    fileId: null,
    isNew: false,
    aiItemId: null,
    chunkId: null,
    schemaLines: 0,
    errors: []
  };

  try {
    // 1. Регистрация виртуального файла
    const virtualFilename = getVirtualFilename();
    const { id: fileId, isNew } = await dbService.saveFileInfo(virtualFilename, null, null, contextCode);
    report.fileId = fileId;
    report.isNew = isNew;
    console.log(`[Table-Loader] Файл зарегистрирован: ${virtualFilename} (fileId = ${fileId})`);

    // 2. Получение схемы таблицы через MCP
    const pgMcpInstance = await getPgMcp();
    let schemaText;
    try {
      schemaText = await pgMcpInstance.getTableSchema(fullTableName);
      if (!schemaText || schemaText.trim() === '') {
        const errorMsg = `Пустая схема для таблицы ${fullTableName}`;
        console.error(`[Table-Loader] ${errorMsg}`);
        report.errors.push(errorMsg);
        return report;
      }
    } catch (err) {
      const errorMsg = `Ошибка получения схемы таблицы ${fullTableName}: ${err.message}`;
      console.error(`[Table-Loader] ${errorMsg}`);
      report.errors.push(errorMsg);
      return report;
    }

    report.schemaLines = schemaText.split('\n').length;
    console.log(`[Table-Loader] Схема получена (${report.schemaLines} строк)`);

    // 4. Разбор имени
    const parts = fullTableName.split('.');
    const schema = parts.length > 1 ? parts[0] : 'public';
    const tableName = parts.length > 1 ? parts[1] : parts[0];

    // 3. Формирование контента чанка
    // Пытаемся распарсить schemaText как JSON (может быть JSON-массив объектов колонок)
    let chunkContent;
    
    try {
      const parsedSchema = JSON.parse(schemaText);
      if (Array.isArray(parsedSchema)) {
        // schemaText — это JSON-массив колонок
        // Сохраняем колонки как массив объектов (без экранирования)
        // Формируем ddl_approx как чистый SQL-текст на основе колонок
        const ddlColumns = parsedSchema.map(col => {
          let colDef = `${col.column_name} ${col.data_type}`;
          if (col.is_nullable === 'NO') colDef += ' NOT NULL';
          if (col.column_default) colDef += ` DEFAULT ${col.column_default}`;
          return colDef;
        });
        const ddlApprox = `CREATE TABLE ${fullTableName} (\n  ${ddlColumns.join(',\n  ')}\n);`;
        
        chunkContent = {
          full_name: fullTableName,
          type: 'table',
          schema: schema,
          table_name: tableName,
          ddl_approx: ddlApprox,
          columns: parsedSchema  // массив объектов — чистый JSON без экранирования
        };
      } else {
        // Если это объект, но не массив
        const ddlApprox = `CREATE TABLE ${fullTableName} (\n  ${schemaText.trim()}\n);`;
        chunkContent = {
          full_name: fullTableName,
          type: 'table',
          schema: schema,
          table_name: tableName,
          ddl_approx: ddlApprox,
          schema_text: schemaText.trim()
        };
      }
    } catch (e) {
      // Если не JSON, формируем как обычный текст (DDL-строки)
      const lines = schemaText
        .split('\n')
        .map((line) => `  ${line.trimEnd()}`)
        .join('\n');
      const ddlApprox = `CREATE TABLE ${fullTableName} (\n${lines}\n);`;
      
      chunkContent = {
        full_name: fullTableName,
        type: 'table',
        schema: schema,
        table_name: tableName,
        ddl_approx: ddlApprox,
        schema_text: schemaText.trim()
      };
    }

    // 6. Создание AI Item
    const aiItem = await dbService.createAiItem({
      full_name: fullTableName,
      contextCode: contextCode,
      type: 'table',
      sName: tableName,
      fileId: fileId
    });

    if (!aiItem || !aiItem.id) {
      const errorMsg = `Не удалось создать AI Item для ${fullTableName}`;
      console.error(`[Table-Loader] ${errorMsg}`);
      report.errors.push(errorMsg);
      return report;
    }

    report.aiItemId = aiItem.id;
    console.log(`[Table-Loader] AI Item создан/обновлён: ${fullTableName} (id = ${report.aiItemId})`);

    // 7. Сохранение чанка L0
    try {
      const chunkId = await dbService.saveChunkVector(
        fileId,
        { text: chunkContent },  // передаём объект, а не строку
        null, // без embedding
        {
          type: 'table',
          level: '0-исходник',
          full_name: fullTableName,
          s_name: tableName
        },
        null, // parentChunkId
        contextCode
      );

      report.chunkId = chunkId;

      // Привязываем чанк к AI Item
      await dbService.pgClient.query(
        'UPDATE public.file_vectors SET ai_item_id = $1 WHERE id = $2',
        [report.aiItemId, chunkId]
      );

      console.log(`[Table-Loader] Чанк уровня 0 сохранён: chunkId = ${chunkId}`);
    } catch (err) {
      const errorMsg = `Ошибка сохранения чанка для ${fullTableName}: ${err.message}`;
      console.error(`[Table-Loader] ${errorMsg}`);
      report.errors.push(errorMsg);
    }
  } catch (err) {
    const errorMsg = `Ошибка при обработке таблицы ${fullTableName}: ${err.message}`;
    console.error(`[Table-Loader] ${errorMsg}`);
    report.errors.push(errorMsg);
  }

  return report;
}

module.exports = {
  getFilteredTableNames,
  loadTableSchema,
  getVirtualFilename
};
