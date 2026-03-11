// Пересборка L1-связей из клиентской БД (pg_proc / information_schema)
// routes/loaders/rebuildSqlLinks.js

const { parsePlpgsqlFunctionL1 } = require('./sqlFunctionLoader');

let pgMcp = null;
async function getPgMcp() {
  if (!pgMcp) {
    const pgMcpModule = await import('../../src/pg-mcp.ts');
    pgMcp = pgMcpModule.pgMcp;
  }
  return pgMcp;
}

function escapeSqlString(str) {
  return "'" + str.replace(/'/g, "''") + "'";
}

const FUNCTION_LINK_TYPE_MAP = {
  called_functions: 'calls',
  select_from: 'reads_from',
  update_tables: 'updates',
  insert_tables: 'inserts_into'
};

const TABLE_LINK_TYPE_MAP = {
  referenced_tables: 'reads_from'
};

/**
 * Резолв link_type_id по коду
 */
async function getLinkTypeIds(dbService, codes) {
  const ids = {};
  for (const code of codes) {
    const res = await dbService.pgClient.query(
      'SELECT id FROM kosmos.link_type WHERE code = $1',
      [code]
    );
    ids[code] = res.rows[0]?.id || null;
  }
  return ids;
}

/**
 * Пересборка L1-связей для одного ai_item по full_name:
 * лезет в клиентскую БД (POSTGRES_URL), достаёт тело функции или FK таблицы,
 * парсит L1, перезаписывает link и L1-чанк в chunk_vector.
 *
 * @param {string} fullName - full_name ai_item (например carl_inspect._getCityFromReport)
 * @param {string} contextCode - код контекста
 * @param {object} dbService - DbService
 * @returns {Promise<object>} { fullName, type, linksDeleted, linksCreated, l1Result, chunkUpdated }
 */
async function rebuildSqlLinksFromDb(fullName, contextCode, dbService) {
  const report = {
    fullName,
    type: null,
    linksDeleted: 0,
    linksCreated: 0,
    l1Result: null,
    chunkUpdated: false,
    errors: []
  };

  const parts = fullName.split('.');
  const schema = (parts.length > 1 ? parts[0] : 'public').toLowerCase();
  const name = (parts.length > 1 ? parts[1] : parts[0]).toLowerCase();

  const aiResult = await dbService.pgClient.query(
    `SELECT id, type, file_id FROM kosmos.ai_item WHERE full_name = $1 AND context_code = $2`,
    [fullName, contextCode]
  );
  if (aiResult.rows.length === 0) {
    throw new Error(`AiItem with full_name '${fullName}' not found`);
  }
  const aiItem = aiResult.rows[0];
  const aiItemId = aiItem.id;
  const fileId = aiItem.file_id;
  report.type = aiItem.type;

  let l1Result;

  if (aiItem.type === 'function') {
    const pgMcpInstance = await getPgMcp();
    const escapedSchema = escapeSqlString(schema);
    const escapedName = escapeSqlString(name);
    const q = `SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ${escapedSchema} AND p.proname = ${escapedName}`;
    const pgResult = await pgMcpInstance.executeQuery(q);
    if (!pgResult.rows || pgResult.rows.length === 0) {
      throw new Error(`Function ${fullName} not found in client database`);
    }
    const colIdx = pgResult.columns && pgResult.columns.indexOf('prosrc') >= 0 ? pgResult.columns.indexOf('prosrc') : 0;
    const body = pgResult.rows[0][colIdx];
    if (body == null || String(body).trim() === '') {
      throw new Error(`Function ${fullName} has empty body in client database`);
    }
    const wrappedCode = `CREATE FUNCTION ${fullName}() RETURNS void AS $$ ${body} $$ LANGUAGE plpgsql;`;
    l1Result = await parsePlpgsqlFunctionL1(wrappedCode);
  } else if (aiItem.type === 'table') {
    const pgMcpInstance = await getPgMcp();
    const escapedSchema = escapeSqlString(schema);
    const escapedName = escapeSqlString(name);
    const q = `
      SELECT kcu.column_name, (ccu.table_schema || '.' || ccu.table_name) AS referenced_table, ccu.column_name AS referenced_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = ${escapedSchema} AND tc.table_name = ${escapedName}
    `;
    const pgResult = await pgMcpInstance.executeQuery(q);
    const refTableIdx = pgResult.columns && pgResult.columns.indexOf('referenced_table') >= 0 ? pgResult.columns.indexOf('referenced_table') : 1;
    const foreign_keys = (pgResult.rows || []).map(row => ({
      column: row[0],
      referencedTable: row[refTableIdx],
      referencedColumn: row[2]
    }));
    const referenced_tables = [...new Set(foreign_keys.map(r => r.referencedTable).filter(Boolean))];
    l1Result = { foreign_keys, referenced_tables };
  } else {
    throw new Error(`Unsupported ai_item type for rebuild-sql-links: ${aiItem.type}. Use function or table.`);
  }

  // Резолвим неквалифицированные имена (без точки):
  // 1) пробуем schema источника, 2) ищем по s_name среди всех ai_item контекста
  if (aiItem.type === 'function') {
    for (const key of Object.keys(FUNCTION_LINK_TYPE_MAP)) {
      if (!Array.isArray(l1Result[key])) continue;
      const resolved = [];
      for (const t of l1Result[key]) {
        if (typeof t !== 'string') { resolved.push(t); continue; }
        const trimmed = t.trim();
        if (trimmed.includes('.')) { resolved.push(trimmed); continue; }
        // Сначала пробуем ту же схему, что и у источника
        const sameSchema = `${schema}.${trimmed}`;
        const sameRes = await dbService.pgClient.query(
          `SELECT full_name FROM kosmos.ai_item WHERE lower(full_name) = lower($1) AND context_code = $2 LIMIT 1`,
          [sameSchema, contextCode]
        );
        if (sameRes.rows.length > 0) {
          resolved.push(sameRes.rows[0].full_name);
          continue;
        }
        // Ищем по короткому имени (s_name) среди всех ai_item контекста
        const anyRes = await dbService.pgClient.query(
          `SELECT full_name FROM kosmos.ai_item WHERE lower(s_name) = lower($1) AND context_code = $2 LIMIT 1`,
          [trimmed, contextCode]
        );
        if (anyRes.rows.length > 0) {
          resolved.push(anyRes.rows[0].full_name);
        } else {
          resolved.push(trimmed);
        }
      }
      l1Result[key] = resolved;
    }
  }

  report.l1Result = l1Result;

  const linkTypeMap = aiItem.type === 'function' ? FUNCTION_LINK_TYPE_MAP : TABLE_LINK_TYPE_MAP;
  const allCodes = [...new Set(Object.values(linkTypeMap))];
  const linkTypeIds = await getLinkTypeIds(dbService, allCodes);

  const delResult = await dbService.pgClient.query(
    'DELETE FROM kosmos.link WHERE source = $1 AND context_code = $2',
    [fullName, contextCode]
  );
  report.linksDeleted = delResult.rowCount || 0;

  let linksCreated = 0;
  for (const [key, code] of Object.entries(linkTypeMap)) {
    const typeId = linkTypeIds[code];
    if (!typeId) continue;
    const targets = (l1Result[key] || []).filter(t => typeof t === 'string' && String(t).trim().length > 0);
    for (const target of targets) {
      try {
        const ins = await dbService.pgClient.query(
          `INSERT INTO kosmos.link (context_code, source, target, link_type_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (context_code, source, target, link_type_id) DO NOTHING`,
          [contextCode, fullName, target.trim(), typeId]
        );
        if (ins.rowCount > 0) linksCreated++;
      } catch (err) {
        console.error(`[rebuildSqlLinks] Link ${fullName} -> ${target} (${code}):`, err.message);
        report.errors.push(`Link ${target}: ${err.message}`);
      }
    }
  }
  report.linksCreated = linksCreated;

  const sName = fullName.includes('.') ? fullName.split('.').pop() : fullName;
  const chunkRes = await dbService.pgClient.query(
    `SELECT id FROM kosmos.chunk_vector WHERE ai_item_id = $1 AND level LIKE '1-%' LIMIT 1`,
    [aiItemId]
  );
  if (chunkRes.rows.length > 0) {
    const chunkId = chunkRes.rows[0].id;
    await dbService.pgClient.query(
      `UPDATE kosmos.chunk_vector SET chunk_content = ($1::json->'text')::jsonb WHERE id = $2`,
      [JSON.stringify({ text: l1Result }), chunkId]
    );
    report.chunkUpdated = true;
  } else {
    const parentRes = await dbService.pgClient.query(
      `SELECT id FROM kosmos.chunk_vector WHERE ai_item_id = $1 AND level LIKE '0-%' ORDER BY chunk_index LIMIT 1`,
      [aiItemId]
    );
    const parentChunkId = parentRes.rows.length > 0 ? parentRes.rows[0].id : null;
    const chunkId = await dbService.saveChunkVector(
      fileId,
      { text: l1Result },
      null,
      { type: 'json', level: '1-связи', full_name: fullName, s_name: sName },
      parentChunkId,
      contextCode
    );
    await dbService.pgClient.query(
      'UPDATE kosmos.chunk_vector SET ai_item_id = $1 WHERE id = $2',
      [aiItemId, chunkId]
    );
    report.chunkUpdated = true;
  }

  return report;
}

/**
 * Пакетная пересборка L1-связей для всех SQL-функций контекста.
 * Для каждой функции вызывает rebuildSqlLinksFromDb, собирает суммарный отчёт.
 *
 * @param {string} contextCode
 * @param {object} dbService
 * @returns {Promise<object>}
 */
async function rebuildAllSqlLinks(contextCode, dbService) {
  const allItems = await dbService.pgClient.query(
    `SELECT ai.full_name, ai.type, f.filename
     FROM kosmos.ai_item ai
     JOIN kosmos.files f ON ai.file_id = f.id
     WHERE ai.context_code = $1
       AND ai.type = 'function'
       AND lower(f.filename) LIKE '%.sql'
     ORDER BY ai.full_name`,
    [contextCode]
  );

  const summary = {
    totalFunctions: allItems.rows.length,
    processed: 0,
    skipped: 0,
    totalLinksDeleted: 0,
    totalLinksCreated: 0,
    errors: [],
    reports: []
  };

  for (const row of allItems.rows) {
    try {
      const report = await rebuildSqlLinksFromDb(row.full_name, contextCode, dbService);
      summary.processed++;
      summary.totalLinksDeleted += report.linksDeleted;
      summary.totalLinksCreated += report.linksCreated;
      summary.reports.push({
        fullName: report.fullName,
        linksDeleted: report.linksDeleted,
        linksCreated: report.linksCreated,
        hasErrors: report.errors.length > 0
      });
    } catch (err) {
      summary.skipped++;
      summary.errors.push(`${row.full_name}: ${err.message}`);
      summary.reports.push({
        fullName: row.full_name,
        linksDeleted: 0,
        linksCreated: 0,
        hasErrors: true
      });
    }
  }

  return summary;
}

module.exports = {
  rebuildSqlLinksFromDb,
  rebuildAllSqlLinks
};
