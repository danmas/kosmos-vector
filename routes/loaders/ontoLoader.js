// Загрузчик онтологии: MD-файлы понятий -> ai_item (type='concept') + link
// Спецификация формата: Ontology/ONTOLOGY_SPEC.md
// routes/loaders/ontoLoader.js

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// === Словари (контракт со спекой, раздел 4-5) ===

// прямой код (в MD-файле) -> { db: код в link_type, inverse: код обратной связи в link_type }
const RELATION_TYPES = {
  part_of:    { db: 'onto_part_of',    inverse: 'onto_has_part' },
  uses:       { db: 'onto_uses',       inverse: 'onto_used_by' },
  manages:    { db: 'onto_manages',    inverse: 'onto_managed_by' },
  produces:   { db: 'onto_produces',   inverse: 'onto_produced_by' },
  consumes:   { db: 'onto_consumes',   inverse: 'onto_consumed_by' },
  precedes:   { db: 'onto_precedes',   inverse: 'onto_follows' },
  related_to: { db: 'onto_related_to', inverse: 'onto_related_to' }
};

// роль grounding (в MD-файле) -> код в link_type
const GROUNDING_ROLES = {
  implemented_in: 'onto_implemented_in',
  stored_in:      'onto_stored_in',
  documented_in:  'onto_documented_in',
  configured_in:  'onto_configured_in'
};

const REQUIRED_SECTIONS = ['Описание', 'Отношения'];
const KNOWN_SECTIONS = ['Описание', 'Атрибуты', 'Отношения', 'Grounding', 'Активности', 'Утверждения'];

// === Парсинг (чистые функции, без БД) ===

/**
 * Парсинг одного MD-файла понятия.
 * @param {string} content - содержимое файла
 * @param {string} filename - имя файла (для сообщений)
 * @returns {{ concept: object|null, errors: string[], warnings: string[] }}
 */
function parseConceptFile(content, filename) {
  const errors = [];
  const warnings = [];

  // --- Frontmatter ---
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) {
    return { concept: null, errors: [`${filename}: отсутствует frontmatter`], warnings };
  }
  let fm;
  try {
    fm = yaml.load(fmMatch[1]);
  } catch (e) {
    return { concept: null, errors: [`${filename}: ошибка YAML frontmatter: ${e.message}`], warnings };
  }
  for (const field of ['id', 'name', 'type', 'context', 'status']) {
    if (!fm || !fm[field]) errors.push(`${filename}: frontmatter: отсутствует поле '${field}'`);
  }
  if (fm && fm.type && fm.type !== 'concept') {
    errors.push(`${filename}: frontmatter: type должен быть 'concept', получено '${fm.type}'`);
  }
  if (fm && fm.status && !['draft', 'verified'].includes(fm.status)) {
    errors.push(`${filename}: frontmatter: status должен быть draft|verified, получено '${fm.status}'`);
  }
  if (fm && fm.id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(fm.id))) {
    errors.push(`${filename}: id '${fm.id}' не kebab-case латиницей`);
  }
  if (errors.length > 0) return { concept: null, errors, warnings };

  const body = content.slice(fmMatch[0].length);

  // --- Секции по H2 ---
  const sections = {};
  const sectionRegex = /^##\s+(.+)$/gm;
  const found = [];
  let m;
  while ((m = sectionRegex.exec(body)) !== null) {
    found.push({ title: m[1].trim(), start: m.index, contentStart: m.index + m[0].length });
  }
  for (let i = 0; i < found.length; i++) {
    const end = i + 1 < found.length ? found[i + 1].start : body.length;
    sections[found[i].title] = body.slice(found[i].contentStart, end).trim();
  }
  for (const title of Object.keys(sections)) {
    if (!KNOWN_SECTIONS.includes(title)) warnings.push(`${filename}: неизвестная секция '## ${title}'`);
  }
  for (const title of REQUIRED_SECTIONS) {
    if (!(title in sections)) errors.push(`${filename}: отсутствует обязательная секция '## ${title}'`);
  }
  if (sections['Описание'] !== undefined && sections['Описание'] === '') {
    errors.push(`${filename}: секция 'Описание' пуста`);
  }

  // --- Таблицы: Отношения и Grounding ---
  const relations = [];
  for (const row of parseMdTable(sections['Отношения'] || '')) {
    const [type, target, comment] = row;
    if (!RELATION_TYPES[type]) {
      errors.push(`${filename}: Отношения: неизвестный тип '${type}' (допустимы: ${Object.keys(RELATION_TYPES).join(', ')})`);
      continue;
    }
    if (!/^concept:[a-z0-9-]+$/.test(target)) {
      errors.push(`${filename}: Отношения: цель '${target}' не в формате concept:<id>`);
      continue;
    }
    relations.push({ type, target: target.replace(/^concept:/, ''), comment: comment || '' });
  }

  const grounding = [];
  for (const row of parseMdTable(sections['Grounding'] || '')) {
    const [role, target, comment] = row;
    if (!GROUNDING_ROLES[role]) {
      errors.push(`${filename}: Grounding: неизвестная роль '${role}' (допустимы: ${Object.keys(GROUNDING_ROLES).join(', ')})`);
      continue;
    }
    if (!target) {
      errors.push(`${filename}: Grounding: пустая цель в строке с ролью '${role}'`);
      continue;
    }
    grounding.push({ role, target, comment: comment || '' });
  }

  if (errors.length > 0) return { concept: null, errors, warnings };

  const concept = {
    id: String(fm.id),
    name: String(fm.name),
    context: String(fm.context),
    aspects: Array.isArray(fm.aspects) ? fm.aspects.map(String) : [],
    status: fm.status,
    updated: fm.updated ? String(fm.updated) : null,
    filename,
    fullName: `concept:${fm.id}`,
    description: sections['Описание'] || '',
    relations,
    grounding,
    rawContent: content
  };
  return { concept, errors, warnings };
}

/**
 * Парсинг markdown-таблицы: возвращает массив строк-данных (без заголовка и разделителя).
 * Каждая строка — массив значений ячеек (trim).
 */
function parseMdTable(sectionText) {
  const rows = [];
  const lines = sectionText.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
  for (const line of lines) {
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length === 0) continue;
    if (cells.every(c => /^:?-{3,}:?$/.test(c))) {
      // разделитель |---|---|: всё, что накопили до него, — заголовок, отбрасываем
      rows.length = 0;
      continue;
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * Кросс-файловая валидация набора понятий (спека, раздел 8, правила 1-2, 4-5).
 * @param {object[]} concepts
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateOntology(concepts) {
  const errors = [];
  const warnings = [];

  // 1. Уникальность id в пределах context
  const seen = new Map();
  for (const c of concepts) {
    const key = `${c.context}:${c.id}`;
    if (seen.has(key)) errors.push(`Дубликат id '${c.id}' в контексте ${c.context}: ${seen.get(key)} и ${c.filename}`);
    else seen.set(key, c.filename);
  }

  // 2. Резолв ссылок concept:<id> внутри набора (в пределах контекста)
  const byContext = new Map();
  for (const c of concepts) {
    if (!byContext.has(c.context)) byContext.set(c.context, new Set());
    byContext.get(c.context).add(c.id);
  }
  for (const c of concepts) {
    for (const r of c.relations) {
      if (!byContext.get(c.context).has(r.target)) {
        errors.push(`${c.filename}: отношение '${r.type}' указывает на несуществующее понятие concept:${r.target}`);
      }
    }
  }

  // 4. Циклы part_of (DFS по контекстам)
  for (const [context, ids] of byContext) {
    const edges = new Map();
    for (const c of concepts.filter(x => x.context === context)) {
      edges.set(c.id, c.relations.filter(r => r.type === 'part_of').map(r => r.target));
    }
    const state = new Map(); // 0=white 1=grey 2=black
    const dfs = (id, trail) => {
      state.set(id, 1);
      for (const next of edges.get(id) || []) {
        if (!ids.has(next)) continue;
        if (state.get(next) === 1) {
          errors.push(`Цикл part_of в контексте ${context}: ${[...trail, id, next].join(' -> ')}`);
        } else if (!state.get(next)) {
          dfs(next, [...trail, id]);
        }
      }
      state.set(id, 2);
    };
    for (const id of ids) if (!state.get(id)) dfs(id, []);
  }

  // 5. verified => grounding непуст
  for (const c of concepts) {
    if (c.status === 'verified' && c.grounding.length === 0) {
      errors.push(`${c.filename}: status verified, но Grounding пуст`);
    }
    if (c.status === 'draft' && c.grounding.length === 0) {
      warnings.push(`${c.filename}: понятие без grounding — гипотеза`);
    }
  }

  return { errors, warnings };
}

// === Загрузка в БД ===

/**
 * Резолв цели grounding в full_name существующего ai_item.
 * Возвращает { target: string, resolved: boolean, note?: string }.
 */
async function resolveGroundingTarget(target, contextCode, dbService) {
  const q = async (sql, params) => (await dbService.pgClient.query(sql, params)).rows;

  // doc:<file> -> документ или любая его секция (mdLoader создаёт doc:<file> только при наличии пролога,
  // если документ начинается с H1 — существуют лишь doc:<file>#H1:... / ##H2:...)
  if (target.startsWith('doc:')) {
    const rows = await q(
      `SELECT full_name FROM kosmos.ai_item WHERE full_name = $1 OR full_name LIKE $1 || '#%' LIMIT 1`,
      [target]
    );
    return { target, resolved: rows.length > 0 };
  }
  if (target.startsWith('table:')) {
    const name = target.slice('table:'.length);
    const rows = await q('SELECT full_name FROM kosmos.ai_item WHERE full_name = $1 LIMIT 1', [name]);
    return { target: name, resolved: rows.length > 0 };
  }
  if (target.startsWith('file:')) {
    const hashIdx = target.indexOf('#');
    if (hashIdx !== -1) {
      const symbol = target.slice(hashIdx + 1);
      // точное имя или суффикс full_name (schema.func, path/file#symbol и т.п.)
      const rows = await q(
        `SELECT full_name FROM kosmos.ai_item
         WHERE context_code = $1 AND (full_name = $2 OR full_name LIKE '%' || $2)
         ORDER BY length(full_name) LIMIT 3`,
        [contextCode, symbol]
      );
      if (rows.length === 1) return { target: rows[0].full_name, resolved: true };
      if (rows.length > 1) return { target, resolved: false, note: `неоднозначный символ '${symbol}': ${rows.map(r => r.full_name).join(', ')}` };
      return { target, resolved: false };
    }
    // файл без символа: пробуем item по имени файла без расширения (класс/модуль, e.g. EmbeddingsFactory.js -> EmbeddingsFactory)
    const base = path.basename(target.slice('file:'.length));
    const moduleName = base.replace(/\.[^.]+$/, '');
    if (moduleName && moduleName !== base) {
      const rows = await q(
        'SELECT full_name FROM kosmos.ai_item WHERE context_code = $1 AND full_name = $2 LIMIT 2',
        [contextCode, moduleName]
      );
      if (rows.length === 1) return { target: rows[0].full_name, resolved: true, note: `файл сопоставлен модулю '${moduleName}'` };
    }
    // иначе: существует ли файл в kosmos.files
    const fileRows = await q(
      'SELECT id FROM kosmos.files WHERE filename = $1 AND context_code = $2 LIMIT 1',
      [base, contextCode]
    );
    if (fileRows.length > 0) return { target, resolved: true, note: 'зарезолвлен на уровне файла (kosmos.files)' };
    return { target, resolved: false, note: 'ссылка на файл без символа — хранится как есть' };
  }
  // голый full_name
  const rows = await q('SELECT full_name FROM kosmos.ai_item WHERE full_name = $1 AND context_code = $2 LIMIT 1', [target, contextCode]);
  return { target, resolved: rows.length > 0 };
}

/**
 * Загрузка онтологии из директории с MD-файлами понятий.
 * @param {string} dirPath - директория с файлами понятий
 * @param {string} contextCode - контекст
 * @param {object} dbService
 * @returns {object} отчёт
 */
async function loadOntologyFromDir(dirPath, contextCode, dbService) {
  const report = {
    dirPath, contextCode,
    filesFound: 0, conceptsLoaded: 0, linksCreated: 0, groundingResolved: 0, groundingUnresolved: 0,
    concepts: [], errors: [], warnings: []
  };

  // --- 1. Парсинг всех файлов ---
  let files;
  try {
    files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
  } catch (e) {
    report.errors.push(`Не удалось прочитать директорию ${dirPath}: ${e.message}`);
    return report;
  }
  report.filesFound = files.length;

  const concepts = [];
  for (const f of files) {
    const content = fs.readFileSync(path.join(dirPath, f), 'utf8');
    const { concept, errors, warnings } = parseConceptFile(content, f);
    report.errors.push(...errors);
    report.warnings.push(...warnings);
    if (concept) concepts.push(concept);
  }

  // --- 2. Кросс-валидация ---
  const v = validateOntology(concepts);
  report.errors.push(...v.errors);
  report.warnings.push(...v.warnings);
  if (report.errors.length > 0) {
    console.error(`[Onto-Loader] Валидация не пройдена (${report.errors.length} ошибок), загрузка отменена`);
    return report;
  }

  // --- 3. Кэш link_type ---
  const neededCodes = new Set();
  for (const r of Object.values(RELATION_TYPES)) { neededCodes.add(r.db); neededCodes.add(r.inverse); }
  for (const code of Object.values(GROUNDING_ROLES)) neededCodes.add(code);
  const linkTypeIds = {};
  const ltRows = (await dbService.pgClient.query(
    'SELECT id, code FROM kosmos.link_type WHERE code = ANY($1)', [[...neededCodes]]
  )).rows;
  for (const row of ltRows) linkTypeIds[row.code] = row.id;
  const missing = [...neededCodes].filter(c => !linkTypeIds[c]);
  if (missing.length > 0) {
    report.errors.push(`В link_type нет кодов: ${missing.join(', ')}. Выполните миграцию tmp/add_onto_link_types.sql`);
    return report;
  }

  // --- 4. Запись понятий ---
  for (const c of concepts) {
    const conceptReport = { fullName: c.fullName, aiItemId: null, links: 0, groundingIssues: [] };
    try {
      // файл понятия регистрируем в files (ai_item.file_id NOT NULL)
      const { id: fileId } = await dbService.saveFileInfo(c.filename, c.rawContent, path.join(dirPath, c.filename), contextCode, null);

      const res = await dbService.pgClient.query(
        `INSERT INTO kosmos.ai_item (full_name, context_code, type, s_name, h_name, file_id, created_at, updated_at)
         VALUES ($1, $2, 'concept', $3, $4, $5, NOW(), NOW())
         ON CONFLICT (full_name, context_code)
         DO UPDATE SET s_name = EXCLUDED.s_name, h_name = EXCLUDED.h_name, file_id = EXCLUDED.file_id, updated_at = NOW()
         RETURNING id`,
        [c.fullName, contextCode, c.id, c.name, fileId]
      );
      conceptReport.aiItemId = res.rows[0].id;

      // L0-чанк: весь файл понятия (для семантического поиска)
      const chunkId = await dbService.saveChunkVector(
        fileId,
        { text: c.rawContent },
        null,
        { type: 'concept', level: '0-исходник', s_name: c.id, h_name: c.name, full_name: c.fullName },
        null,
        contextCode
      );
      await dbService.pgClient.query('UPDATE kosmos.chunk_vector SET ai_item_id = $1 WHERE id = $2', [conceptReport.aiItemId, chunkId]);
      report.conceptsLoaded++;
    } catch (e) {
      report.errors.push(`${c.filename}: ошибка записи понятия: ${e.message}`);
      continue;
    }
    report.concepts.push(conceptReport);
  }

  // --- 4.5. Удаление старых onto-связей загружаемых понятий (перезагрузка без дублей) ---
  try {
    const conceptNames = concepts.map(c => c.fullName);
    await dbService.pgClient.query(
      `DELETE FROM kosmos.link l USING kosmos.link_type lt
       WHERE l.link_type_id = lt.id AND lt.code LIKE 'onto_%'
         AND l.context_code = $1 AND (l.source = ANY($2) OR l.target = ANY($2))`,
      [contextCode, conceptNames]
    );
  } catch (e) {
    report.warnings.push(`Не удалось удалить старые onto-связи: ${e.message}`);
  }

  // --- 5. Связи понятие -> понятие (прямая + обратная) ---
  for (const c of concepts) {
    for (const r of c.relations) {
      const targetFullName = `concept:${r.target}`;
      const spec = RELATION_TYPES[r.type];
      await createLink(dbService, contextCode, c.fullName, targetFullName, linkTypeIds[spec.db]);
      await createLink(dbService, contextCode, targetFullName, c.fullName, linkTypeIds[spec.inverse]);
      report.linksCreated += 2;
    }
  }

  // --- 6. Grounding ---
  for (const c of concepts) {
    const conceptReport = report.concepts.find(x => x.fullName === c.fullName);
    for (const g of c.grounding) {
      const { target, resolved, note } = await resolveGroundingTarget(g.target, contextCode, dbService);
      if (resolved) report.groundingResolved++;
      else {
        report.groundingUnresolved++;
        const msg = `${c.filename}: grounding '${g.target}' не резолвится в ai_item${note ? ` (${note})` : ''}`;
        if (c.status === 'verified') report.errors.push(msg);
        else report.warnings.push(msg);
        if (conceptReport) conceptReport.groundingIssues.push(g.target);
      }
      // Связь пишем в любом случае: цель — текстовый full_name, протухание ловится валидатором (Этап 3)
      await createLink(dbService, contextCode, c.fullName, target, linkTypeIds[GROUNDING_ROLES[g.role]]);
      report.linksCreated++;
    }
  }

  console.log(`[Onto-Loader] Итог: понятий=${report.conceptsLoaded}, связей=${report.linksCreated}, grounding ok/не ok=${report.groundingResolved}/${report.groundingUnresolved}, ошибок=${report.errors.length}, предупреждений=${report.warnings.length}`);
  return report;
}

async function createLink(dbService, contextCode, source, target, linkTypeId) {
  if (!linkTypeId) return;
  try {
    await dbService.pgClient.query(
      `INSERT INTO kosmos.link (context_code, source, target, link_type_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (context_code, source, target, link_type_id) DO NOTHING`,
      [contextCode, source, target, linkTypeId]
    );
  } catch (err) {
    console.warn(`[Onto-Loader] Не удалось создать связь ${source} -> ${target}: ${err.message}`);
  }
}

module.exports = {
  parseConceptFile,
  parseMdTable,
  validateOntology,
  resolveGroundingTarget,
  loadOntologyFromDir,
  RELATION_TYPES,
  GROUNDING_ROLES
};
