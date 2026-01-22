// Извлечение колонок таблиц из SQL-функций
// routes/loaders/columnExtractor.js

/**
 * Построение map алиасов таблиц из FROM/JOIN
 * @param {string} body - Тело SQL функции
 * @returns {Object} Map alias -> table_name (например, {l: 'label', al: 'auction_label'})
 */
function resolveTableAliases(body) {
  const aliasMap = {};
  
  // Удаляем комментарии для парсинга
  let cleaned = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');

  // Нормализуем пробелы
  cleaned = cleaned.replace(/\s+/g, ' ');

  // Парсим FROM clause: FROM table1 alias1, table2 alias2
  // Ищем FROM и берём всё до WHERE/ORDER/GROUP/HAVING/LIMIT/OFFSET или закрывающей скобки
  const fromClauseRegex = /\bFROM\s+([\w\s,\.]+?)(?=\s+WHERE\b|\s+ORDER\b|\s+GROUP\b|\s+HAVING\b|\s+LIMIT\b|\s+OFFSET\b|\)|\s*$)/gi;
  let fromClauseMatch;
  
  while ((fromClauseMatch = fromClauseRegex.exec(cleaned)) !== null) {
    const tablesList = fromClauseMatch[1].trim();
    
    // Разбиваем по запятым
    const tablePairs = tablesList.split(',').map(s => s.trim());
    
    for (const pair of tablePairs) {
      // Убираем возможные JOIN ключевые слова в начале
      const cleanedPair = pair.replace(/^(LEFT|RIGHT|INNER|FULL|CROSS|NATURAL)\s+(OUTER\s+)?JOIN\s+/i, '').trim();
      
      // Разбиваем на части: table_name alias
      // Паттерн: table_name или schema.table_name, затем опционально alias
      const tableAliasMatch = cleanedPair.match(/^([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)(?:\s+([a-z_][a-z0-9_]*))?$/i);
      
      if (tableAliasMatch) {
        const tableName = tableAliasMatch[1].toLowerCase();
        const alias = tableAliasMatch[2] ? tableAliasMatch[2].toLowerCase() : null;
        
        // Проверяем, что alias не является ключевым словом
        if (alias && !/^(on|where|and|or|order|group|having|limit|offset|join|left|right|inner|outer|cross|natural)$/i.test(alias)) {
          aliasMap[alias] = tableName;
        }
        
        // Если нет алиаса, используем короткое имя таблицы как ключ
        if (!alias) {
          const shortName = tableName.includes('.') ? tableName.split('.').pop() : tableName;
          aliasMap[shortName] = tableName;
        }
      }
    }
  }

  // Парсим JOIN table alias ON
  const joinRegex = /\b(?:LEFT|RIGHT|INNER|FULL|CROSS|NATURAL)?\s*(?:OUTER\s+)?JOIN\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)\s+([a-z_][a-z0-9_]*)\s+ON\b/gi;
  let joinMatch;
  while ((joinMatch = joinRegex.exec(cleaned)) !== null) {
    const tableName = joinMatch[1].toLowerCase();
    const alias = joinMatch[2].toLowerCase();
    if (!/^(on|where|and|or|order|group|having|limit|offset)$/i.test(alias)) {
      aliasMap[alias] = tableName;
    }
  }

  return aliasMap;
}

/**
 * Парсинг колонок из SQL тела функции
 * @param {string} body - Тело SQL функции
 * @returns {Array} Массив объектов {column, tableAlias, operation: 'select'|'update'|'insert'}
 */
function parseColumnsFromSqlBody(body) {
  const columns = [];
  
  // Удаляем комментарии
  let cleaned = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');

  // Удаляем динамический SQL
  cleaned = cleaned.replace(/EXECUTE\s+[^;]*;/gi, ' ');

  // Строим map алиасов
  const aliasMap = resolveTableAliases(cleaned);

  // Нормализуем пробелы для парсинга
  const normalized = cleaned.replace(/\s+/g, ' ');

  // 1. Парсим SELECT: ищем alias.column или просто column
  const selectRegex = /\bSELECT\s+([^F]+?)(?:\s+FROM|\s+WHERE|\s+ORDER|\s+GROUP|\s+HAVING|\s+LIMIT|\s+OFFSET|$)/gi;
  let selectMatch;
  while ((selectMatch = selectRegex.exec(normalized)) !== null) {
    const selectList = selectMatch[1];
    
    // Разбиваем SELECT список по запятым для более точного парсинга
    const selectItems = selectList.split(',').map(s => s.trim());
    const processedColumns = new Set();
    const keywords = new Set(['select', 'distinct', 'as', 'from', 'where', 'and', 'or', 'order', 'by', 'group', 'having', 'limit', 'offset', 'row_to_json', 'json_agg', 'json_strip_nulls']);
    
    for (const item of selectItems) {
      // Пропускаем пустые элементы
      if (!item || item.length === 0) continue;
      
      // Пропускаем функции типа row_to_json(r), json_agg(...), COUNT(*)
      if (/\w+\s*\(/.test(item)) {
        // Это функция, но можем извлечь колонки из аргументов
        // Ищем паттерн alias.column внутри функции
        const funcColumnRegex = /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi;
        let funcColMatch;
        while ((funcColMatch = funcColumnRegex.exec(item)) !== null) {
          const alias = funcColMatch[1].toLowerCase();
          const column = funcColMatch[2].toLowerCase();
          const key = `${alias}.${column}`;
          if (!processedColumns.has(key)) {
            processedColumns.add(key);
            columns.push({
              column: column,
              tableAlias: alias,
              operation: 'select'
            });
          }
        }
        continue;
      }
      
      // Ищем паттерн alias.column
      const aliasColumnRegex = /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/i;
      const aliasMatch = item.match(aliasColumnRegex);
      if (aliasMatch) {
        const alias = aliasMatch[1].toLowerCase();
        const column = aliasMatch[2].toLowerCase();
        const key = `${alias}.${column}`;
        if (!processedColumns.has(key)) {
          processedColumns.add(key);
          columns.push({
            column: column,
            tableAlias: alias,
            operation: 'select'
          });
        }
        continue;
      }
      
      // Ищем просто column без алиаса (только если это не ключевое слово)
      const simpleColumnRegex = /^\s*([a-z_][a-z0-9_]+)\s*$/i;
      const simpleMatch = item.match(simpleColumnRegex);
      if (simpleMatch) {
        const column = simpleMatch[1].toLowerCase();
        if (!keywords.has(column)) {
          const key = `noalias.${column}`;
          if (!processedColumns.has(key)) {
            processedColumns.add(key);
            columns.push({
              column: column,
              tableAlias: null,
              operation: 'select'
            });
          }
        }
      }
    }
  }

  // 2. Парсим UPDATE SET: ищем column = value
  const updateRegex = /\bUPDATE\s+([a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?)\s+SET\s+([^W]+?)(?:\s+WHERE|\s+RETURNING|$)/gi;
  let updateMatch;
  while ((updateMatch = updateRegex.exec(normalized)) !== null) {
    const setClause = updateMatch[3];
    // Парсим column = value
    const setColumnRegex = /\b([a-z_][a-z0-9_]+)\s*=/gi;
    let setColMatch;
    while ((setColMatch = setColumnRegex.exec(setClause)) !== null) {
      const column = setColMatch[1].toLowerCase();
      // Пропускаем ключевые слова
      if (!/^(set|where|and|or|returning)$/i.test(column)) {
        columns.push({
          column: column,
          tableAlias: null, // В UPDATE обычно нет алиасов
          operation: 'update'
        });
      }
    }
  }

  // 3. Парсим INSERT: ищем (col1, col2, col3)
  const insertRegex = /\bINSERT\s+INTO\s+([a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?)\s*\(([^)]+)\)/gi;
  let insertMatch;
  while ((insertMatch = insertRegex.exec(normalized)) !== null) {
    const columnsList = insertMatch[3];
    // Разбиваем по запятым
    const columnNames = columnsList.split(',').map(s => s.trim().toLowerCase());
    for (const colName of columnNames) {
      if (colName && /^[a-z_][a-z0-9_]*$/i.test(colName)) {
        columns.push({
          column: colName,
          tableAlias: null,
          operation: 'insert'
        });
      }
    }
  }

  return columns;
}

/**
 * Поиск таблицы по короткому имени среди загруженных ai_item
 * @param {string} tableName - Короткое имя таблицы (например, 'label')
 * @param {string} contextCode - Код контекста
 * @param {DbService} dbService - Экземпляр DbService
 * @returns {Promise<Object|null>} ai_item таблицы или null
 */
async function findTableByName(tableName, contextCode, dbService) {
  try {
    return await dbService.findAiItemByName(tableName, contextCode);
  } catch (error) {
    console.error(`[ColumnExtractor] Ошибка поиска таблицы ${tableName}:`, error);
    return null;
  }
}

/**
 * Главная функция: извлечение колонок из функции и создание ai_item + link
 * @param {number} aiItemId - ID ai_item функции
 * @param {string} contextCode - Код контекста
 * @param {DbService} dbService - Экземпляр DbService
 * @returns {Promise<Object>} Отчет о выполнении
 */
async function extractColumnsFromFunction(aiItemId, contextCode, dbService) {
  const report = {
    functionFullName: null,
    functionAiItemId: aiItemId,
    columnsFound: 0,
    columnsResolved: 0,
    columnsUnresolved: 0,
    columnsAmbiguous: 0,
    linksCreated: 0,
    columns: [],
    errors: []
  };

  try {
    // 1. Получаем информацию о функции
    const functionItemResult = await dbService.pgClient.query(
      `SELECT full_name, file_id FROM public.ai_item WHERE id = $1`,
      [aiItemId]
    );

    if (functionItemResult.rows.length === 0) {
      report.errors.push(`AI Item с id ${aiItemId} не найден`);
      return report;
    }

    report.functionFullName = functionItemResult.rows[0].full_name;
    const functionFileId = functionItemResult.rows[0].file_id;

    // 2. Получаем тело функции
    const functionBody = await dbService.getFunctionBodyByAiItemId(aiItemId);
    if (!functionBody) {
      report.errors.push(`Не удалось получить тело функции для ai_item_id ${aiItemId}`);
      return report;
    }

    // 3. Парсим колонки из тела
    const parsedColumns = parseColumnsFromSqlBody(functionBody);
    report.columnsFound = parsedColumns.length;

    // 4. Получаем ID типов связей для колонок
    const linkTypeMap = {
      'select': 'reads_column',
      'update': 'updates_column',
      'insert': 'inserts_column'
    };

    const linkTypeIds = {};
    for (const code of Object.values(linkTypeMap)) {
      try {
        const res = await dbService.pgClient.query(
          'SELECT id FROM public.link_type WHERE code = $1',
          [code]
        );
        linkTypeIds[code] = res.rows[0]?.id || null;
      } catch (err) {
        console.warn(`[ColumnExtractor] Не удалось получить link_type для '${code}': ${err.message}`);
        linkTypeIds[code] = null;
      }
    }

    // 5. Удаляем старые связи function -> column
    const columnLinkTypeIds = Object.values(linkTypeIds).filter(id => id !== null);
    if (columnLinkTypeIds.length > 0) {
      await dbService.pgClient.query(
        `DELETE FROM public.link 
         WHERE source = $1 AND context_code = $2 AND link_type_id = ANY($3)`,
        [report.functionFullName, contextCode, columnLinkTypeIds]
      );
    }

    // 6. Резолвим колонки и создаём ai_item + link
    const aliasMap = resolveTableAliases(functionBody);
    const processedColumns = new Map(); // full_name -> column info

    for (const colInfo of parsedColumns) {
      try {
        let tableFullName = null;
        let resolved = false;
        let ambiguous = false;

        // Резолвим таблицу
        if (colInfo.tableAlias) {
          // Есть алиас - берём из map
          const tableName = aliasMap[colInfo.tableAlias.toLowerCase()];
          if (tableName) {
            // Ищем полное имя таблицы
            const tableItem = await findTableByName(tableName, contextCode, dbService);
            if (tableItem) {
              tableFullName = tableItem.full_name;
              resolved = true;
            }
          }
        } else {
          // Нет алиаса - ищем во всех таблицах из FROM/JOIN
          const tablesInQuery = Object.values(aliasMap);
          const matchingTables = [];

          for (const tableName of tablesInQuery) {
            const tableItem = await findTableByName(tableName, contextCode, dbService);
            if (tableItem) {
              // Проверяем, есть ли такая колонка в таблице
              const columnMeta = await dbService.getColumnMetadataFromTable(
                tableItem.full_name,
                colInfo.column,
                contextCode
              );
              if (columnMeta) {
                matchingTables.push(tableItem);
              }
            }
          }

          if (matchingTables.length === 1) {
            tableFullName = matchingTables[0].full_name;
            resolved = true;
          } else if (matchingTables.length > 1) {
            ambiguous = true;
            report.columnsAmbiguous++;
          }
        }

        // Формируем full_name колонки
        let columnFullName;
        if (resolved && tableFullName) {
          columnFullName = `${tableFullName}.${colInfo.column}`;
        } else {
          columnFullName = `unknown.${colInfo.column}`;
          report.columnsUnresolved++;
        }

        // Создаём или обновляем ai_item для колонки
        // file_id берём от функции, из которой извлечена колонка
        const columnAiItem = await dbService.createAiItem({
          full_name: columnFullName,
          contextCode: contextCode,
          type: 'table_column',
          sName: colInfo.column,
          fileId: functionFileId
        });

        // Получаем метаданные колонки
        let columnMetadata = null;
        if (resolved && tableFullName) {
          columnMetadata = await dbService.getColumnMetadataFromTable(
            tableFullName,
            colInfo.column,
            contextCode
          );
        }

        // Создаём или обновляем L0 чанк для колонки
        const chunkContent = {
          text: {
            full_name: columnFullName,
            type: 'table_column',
            table_full_name: tableFullName || null,
            column_name: colInfo.column,
            data_type: columnMetadata?.data_type || null,
            is_nullable: columnMetadata?.is_nullable !== false,
            sources: [report.functionFullName]
          }
        };

        // Проверяем, есть ли уже чанк для этой колонки
        const existingChunkResult = await dbService.pgClient.query(
          `SELECT id FROM public.chunk_vector 
           WHERE ai_item_id = $1 AND level = '0-исходник' AND full_name = $2`,
          [columnAiItem.id, columnFullName]
        );

        let chunkId;
        if (existingChunkResult.rows.length > 0) {
          // Обновляем существующий чанк, добавляя источник
          chunkId = existingChunkResult.rows[0].id;
          const existingChunk = await dbService.pgClient.query(
            `SELECT chunk_content FROM public.chunk_vector WHERE id = $1`,
            [chunkId]
          );
          
          let existingContent = existingChunk.rows[0].chunk_content;
          if (typeof existingContent === 'string') {
            existingContent = JSON.parse(existingContent);
          }
          
          const existingText = existingContent.text || existingContent;
          if (existingText.sources && !existingText.sources.includes(report.functionFullName)) {
            existingText.sources.push(report.functionFullName);
          } else if (!existingText.sources) {
            existingText.sources = [report.functionFullName];
          }

          await dbService.pgClient.query(
            `UPDATE public.chunk_vector SET chunk_content = $1 WHERE id = $2`,
            [JSON.stringify({ text: existingText }), chunkId]
          );
        } else {
          // Создаём новый чанк
          chunkId = await dbService.saveChunkVector(
            functionFileId, // fileId берём от функции
            chunkContent,
            null, // embedding
            {
              type: 'table_column',
              level: '0-исходник',
              full_name: columnFullName,
              s_name: colInfo.column
            },
            null, // parentChunkId
            contextCode
          );

          // Привязываем чанк к AI Item
          await dbService.pgClient.query(
            'UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2',
            [columnAiItem.id, chunkId]
          );
        }

        // Создаём связь function -> column
        const linkTypeCode = linkTypeMap[colInfo.operation];
        const linkTypeId = linkTypeIds[linkTypeCode];

        if (linkTypeId) {
          try {
            await dbService.pgClient.query(
              `INSERT INTO public.link 
               (context_code, source, target, link_type_id, file_id)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (context_code, source, target, link_type_id) DO NOTHING`,
              [
                contextCode,
                report.functionFullName,
                columnFullName,
                linkTypeId,
                functionFileId
              ]
            );
            report.linksCreated++;
          } catch (err) {
            console.error(`[ColumnExtractor] Ошибка создания link ${report.functionFullName} -> ${columnFullName}:`, err.message);
            report.errors.push(`Link error: ${linkTypeCode} -> ${columnFullName}`);
          }
        }

        // Сохраняем информацию о колонке
        const columnInfo = {
          fullName: columnFullName,
          operation: colInfo.operation,
          resolved: resolved,
          ambiguous: ambiguous,
          tableFullName: tableFullName
        };

        // Если колонка уже обрабатывалась, обновляем информацию
        if (processedColumns.has(columnFullName)) {
          const existing = processedColumns.get(columnFullName);
          if (!existing.resolved && resolved) {
            existing.resolved = true;
            existing.tableFullName = tableFullName;
          }
        } else {
          processedColumns.set(columnFullName, columnInfo);
          report.columns.push(columnInfo);
          if (resolved) {
            report.columnsResolved++;
          }
        }
      } catch (err) {
        const errorMsg = `Ошибка обработки колонки ${colInfo.column}: ${err.message}`;
        console.error(`[ColumnExtractor] ${errorMsg}`);
        report.errors.push(errorMsg);
      }
    }

    console.log(`[ColumnExtractor] Обработано колонок для ${report.functionFullName}: найдено ${report.columnsFound}, резолвлено ${report.columnsResolved}, нерезолвлено ${report.columnsUnresolved}, создано связей ${report.linksCreated}`);

    return report;
  } catch (error) {
    const errorMsg = `Ошибка извлечения колонок для ai_item_id ${aiItemId}: ${error.message}`;
    console.error(`[ColumnExtractor] ${errorMsg}`);
    report.errors.push(errorMsg);
    return report;
  }
}

/**
 * Пакетное извлечение колонок из всех SQL-функций
 * @param {string} contextCode - Код контекста
 * @param {DbService} dbService - Экземпляр DbService
 * @param {Object} options - Опции
 * @param {Function} options.onProgress - Колбэк прогресса (processed, total, current)
 * @returns {Promise<Object>} Суммарный отчет
 */
async function extractColumnsFromAllFunctions(contextCode, dbService, options = {}) {
  const { onProgress } = options;
  
  const summaryReport = {
    totalFunctions: 0,
    functionsProcessed: 0,
    functionsSkipped: 0,
    totalColumnsFound: 0,
    totalColumnsResolved: 0,
    totalColumnsUnresolved: 0,
    totalLinksCreated: 0,
    errors: [],
    reports: []
  };

  try {
    // 1. Получаем все SQL-функции
    const functionsResult = await dbService.pgClient.query(
      `SELECT ai.id, ai.full_name 
       FROM public.ai_item ai
       JOIN public.files f ON ai.file_id = f.id
       WHERE ai.context_code = $1 
         AND ai.type = 'function'
         AND (f.file_url LIKE '%.sql' OR f.file_url LIKE '%.SQL')
       ORDER BY ai.full_name`,
      [contextCode]
    );

    const functions = functionsResult.rows;
    summaryReport.totalFunctions = functions.length;

    console.log(`[ColumnExtractor] Найдено ${functions.length} SQL-функций для обработки`);

    // 2. Обрабатываем каждую функцию
    for (let i = 0; i < functions.length; i++) {
      const func = functions[i];
      
      try {
        // Вызываем колбэк прогресса
        if (onProgress) {
          onProgress(i, functions.length, func.full_name);
        }

        console.log(`[ColumnExtractor] [${i + 1}/${functions.length}] Обрабатываю: ${func.full_name}`);

        // Извлекаем колонки
        const report = await extractColumnsFromFunction(func.id, contextCode, dbService);

        // Суммируем статистику
        summaryReport.functionsProcessed++;
        summaryReport.totalColumnsFound += report.columnsFound;
        summaryReport.totalColumnsResolved += report.columnsResolved;
        summaryReport.totalColumnsUnresolved += report.columnsUnresolved;
        summaryReport.totalLinksCreated += report.linksCreated;

        // Сохраняем краткий отчет по функции
        summaryReport.reports.push({
          functionFullName: func.full_name,
          columnsFound: report.columnsFound,
          columnsResolved: report.columnsResolved,
          linksCreated: report.linksCreated,
          hasErrors: report.errors.length > 0
        });

        if (report.errors.length > 0) {
          summaryReport.errors.push(...report.errors.map(e => `${func.full_name}: ${e}`));
        }

      } catch (err) {
        const errorMsg = `Ошибка обработки функции ${func.full_name}: ${err.message}`;
        console.error(`[ColumnExtractor] ${errorMsg}`);
        summaryReport.errors.push(errorMsg);
        summaryReport.functionsSkipped++;
      }
    }

    console.log(`[ColumnExtractor] Завершено. Обработано: ${summaryReport.functionsProcessed}/${summaryReport.totalFunctions}, ` +
                `колонок: ${summaryReport.totalColumnsFound}, связей: ${summaryReport.totalLinksCreated}`);

    return summaryReport;

  } catch (error) {
    const errorMsg = `Критическая ошибка пакетной обработки: ${error.message}`;
    console.error(`[ColumnExtractor] ${errorMsg}`);
    summaryReport.errors.push(errorMsg);
    return summaryReport;
  }
}

module.exports = {
  parseColumnsFromSqlBody,
  resolveTableAliases,
  findTableByName,
  extractColumnsFromFunction,
  extractColumnsFromAllFunctions
};
