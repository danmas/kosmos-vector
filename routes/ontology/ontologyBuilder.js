// Ontology Builder: suggest draft concepts from vectorized reality → materialize MD → apply loop
// routes/ontology/ontologyBuilder.js

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const kbConfigService = require('../../packages/core/kbConfigService');
const { callLLM } = require('../../packages/core/llmClient');
const {
  resolveGroundingTarget,
  loadOntologyFromDir,
  RELATION_TYPES
} = require('../loaders/ontoLoader');
const { runStep4 } = require('../pipeline/step4Vectorize');

const ALLOWED_RELATIONS = Object.keys(RELATION_TYPES);
const GROUNDING_ROLES = ['implemented_in', 'stored_in', 'documented_in', 'configured_in'];

const TYPE_TO_ROLE = {
  function: 'implemented_in',
  method: 'implemented_in',
  class: 'implemented_in',
  interface: 'implemented_in',
  table: 'stored_in',
  md_doc: 'documented_in'
};

/**
 * Gate: context has vectorized non-concept reality (Step4 done for content).
 */
async function assertVectorizedReality(dbService, contextCode) {
  const rows = (await dbService.pgClient.query(
    `SELECT count(*)::int AS n
     FROM kosmos.chunk_vector cv
     JOIN kosmos.ai_item ai ON ai.id = cv.ai_item_id
     WHERE ai.context_code = $1
       AND cv.embedding IS NOT NULL
       AND ai.type IS DISTINCT FROM 'concept'`,
    [contextCode]
  )).rows;
  const n = rows[0]?.n || 0;
  if (n === 0) {
    const err = new Error(
      'Требуется Step4: нет векторизованных ai_item (кроме concept). Сначала выполните Step1–2 и Step4.'
    );
    err.code = 'STEP4_REQUIRED';
    err.status = 409;
    throw err;
  }
  return n;
}

/**
 * Parse onto_loading section from kb-config custom_settings YAML.
 * @returns {{ enabled: boolean, dirs: string[] }}
 */
function parseOntoLoading(customSettingsYaml) {
  if (!customSettingsYaml || typeof customSettingsYaml !== 'string') {
    return { enabled: false, dirs: [] };
  }
  try {
    const parsed = yaml.load(customSettingsYaml);
    const onto = parsed?.onto_loading;
    if (!onto || typeof onto !== 'object') return { enabled: false, dirs: [] };
    const dirs = Array.isArray(onto.dirs)
      ? onto.dirs.filter((d) => typeof d === 'string' && d.trim()).map((d) => d.trim())
      : [];
    return { enabled: onto.enabled === true, dirs };
  } catch {
    return { enabled: false, dirs: [] };
  }
}

function parseOntoDirs(customSettingsYaml) {
  return parseOntoLoading(customSettingsYaml).dirs;
}

/**
 * Resolve relative dir paths against first rootPath; leave absolute as-is.
 */
function resolveOntoDirs(dirs, rootPaths) {
  const firstRoot = rootPaths[0] || process.cwd();
  return dirs.map((d) => {
    if (path.isAbsolute(d)) return path.normalize(d);
    return path.normalize(path.join(firstRoot, d));
  });
}

/** Suggested path for the error message (not used automatically). */
function defaultConceptsDir(contextCode, rootPaths) {
  if (rootPaths.length > 0) {
    return path.join(rootPaths[0], 'ontology', 'concepts').replace(/\\/g, '/');
  }
  return path.join(process.cwd(), 'data', 'ontology', contextCode, 'concepts').replace(/\\/g, '/');
}

/**
 * User-facing config error: onto_loading missing or incomplete.
 * Not a crash — caller should respond 400 and show message in UI.
 */
function makeOntoLoadingNotConfiguredError(contextCode, rootPaths = [], reason = 'missing') {
  const exampleDir = defaultConceptsDir(contextCode, rootPaths);
  const reasonText =
    reason === 'disabled'
      ? `onto_loading.enabled не true (или секция отсутствует).`
      : reason === 'empty_dirs'
        ? `onto_loading.dirs пуст или не задан.`
        : `секция onto_loading отсутствует или неполная.`;

  const message =
    `Онтология не настроена для context-code «${contextCode}»: ${reasonText}\n\n` +
    `Добавьте в kb-config → custom_settings:\n\n` +
    `onto_loading:\n` +
    `  enabled: true\n` +
    `  dirs:\n` +
    `    - ${exampleDir}\n\n` +
    `Затем повторите «Записать MD» / «Применить». ` +
    `Без этого builder не пишет файлы и не загружает понятия.`;

  const err = new Error(message);
  err.status = 400;
  err.code = 'ONTO_LOADING_NOT_CONFIGURED';
  err.userFacing = true;
  err.hint = {
    contextCode,
    example: {
      onto_loading: {
        enabled: true,
        dirs: [exampleDir]
      }
    }
  };
  return err;
}

/**
 * Soft check (no throw) — for status / UI gate.
 * @returns {Promise<{ ok: boolean, enabled: boolean, dirs: string[], reason?: string, exampleDir?: string }>}
 */
async function checkOntoLoadingConfig(contextCode) {
  const config = await kbConfigService.getConfig(contextCode);
  const rootPaths = kbConfigService.parseRootPaths(config.rootPath || '');
  const onto = parseOntoLoading(config.metadata?.custom_settings);
  const exampleDir = defaultConceptsDir(contextCode, rootPaths);

  if (!onto.enabled && onto.dirs.length === 0) {
    return { ok: false, enabled: false, dirs: [], reason: 'missing', exampleDir };
  }
  if (!onto.enabled) {
    return {
      ok: false,
      enabled: false,
      dirs: resolveOntoDirs(onto.dirs, rootPaths),
      reason: 'disabled',
      exampleDir
    };
  }
  if (onto.dirs.length === 0) {
    return { ok: false, enabled: true, dirs: [], reason: 'empty_dirs', exampleDir };
  }
  return {
    ok: true,
    enabled: true,
    dirs: resolveOntoDirs(onto.dirs, rootPaths),
    exampleDir
  };
}

/**
 * Resolve concepts output/load dirs for context.
 * Priority: request options.dirs|outDir → kb-config onto_loading (enabled + dirs).
 * If config incomplete and no request override → controlled 400 (not a crash).
 *
 * @param {string} contextCode
 * @param {object} [options]
 * @param {string[]} [options.dirs]
 * @param {string} [options.outDir]
 * @param {boolean} [options.createIfMissing=true]
 * @returns {Promise<{ dirs: string[], source: 'request'|'config', configUpdated: boolean }>}
 */
async function getOntoDirs(contextCode, options = {}) {
  const createIfMissing = options.createIfMissing !== false;
  const config = await kbConfigService.getConfig(contextCode);
  const rootPaths = kbConfigService.parseRootPaths(config.rootPath || '');

  let dirs = [];
  let source = 'config';

  if (Array.isArray(options.dirs) && options.dirs.length > 0) {
    dirs = options.dirs.filter((d) => typeof d === 'string' && d.trim()).map((d) => d.trim());
    source = 'request';
  } else if (typeof options.outDir === 'string' && options.outDir.trim()) {
    dirs = [options.outDir.trim()];
    source = 'request';
  } else {
    const check = await checkOntoLoadingConfig(contextCode);
    if (!check.ok) {
      throw makeOntoLoadingNotConfiguredError(contextCode, rootPaths, check.reason || 'missing');
    }
    dirs = check.dirs;
    source = 'config';
  }

  dirs = resolveOntoDirs(dirs, rootPaths);

  if (dirs.length === 0) {
    throw makeOntoLoadingNotConfiguredError(contextCode, rootPaths, 'empty_dirs');
  }

  if (createIfMissing) {
    for (const d of dirs) {
      if (!fs.existsSync(d)) {
        fs.mkdirSync(d, { recursive: true });
        console.log(`[OntologyBuilder] Создан каталог понятий: ${d}`);
      }
    }
  }

  return { dirs, source, configUpdated: false };
}

function toKebabId(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'concept';
}

function uniqueKebab(base, used) {
  let id = base;
  let i = 2;
  while (used.has(id)) {
    id = `${base}-${i++}`;
  }
  used.add(id);
  return id;
}

/**
 * Collect anchor items ranked by importance (L1 degree, type, chunks).
 */
async function collectAnchors(dbService, contextCode, limit = 80) {
  const q = async (sql, params) => (await dbService.pgClient.query(sql, params)).rows;

  const byDegree = await q(
    `SELECT ai.full_name, ai.type, ai.h_name, ai.s_name,
            count(DISTINCT l.id)::int AS degree,
            count(DISTINCT cv.id) FILTER (WHERE cv.embedding IS NOT NULL)::int AS vectorized_chunks
     FROM kosmos.ai_item ai
     LEFT JOIN kosmos.link l ON l.context_code = ai.context_code
       AND (l.source = ai.full_name OR l.target = ai.full_name)
     LEFT JOIN kosmos.chunk_vector cv ON cv.ai_item_id = ai.id
     WHERE ai.context_code = $1
       AND ai.type IN ('function','method','class','table','md_doc','interface')
     GROUP BY ai.full_name, ai.type, ai.h_name, ai.s_name
     HAVING count(DISTINCT cv.id) FILTER (WHERE cv.embedding IS NOT NULL) > 0
     ORDER BY degree DESC, vectorized_chunks DESC, ai.full_name
     LIMIT $2`,
    [contextCode, limit]
  );

  return byDegree;
}

async function loadExistingConceptIds(dbService, contextCode) {
  const rows = (await dbService.pgClient.query(
    `SELECT s_name, full_name FROM kosmos.ai_item
     WHERE context_code = $1 AND type = 'concept'`,
    [contextCode]
  )).rows;
  return new Set(rows.map((r) => r.s_name || String(r.full_name).replace(/^concept:/, '')));
}

/**
 * Heuristic concept proposals when LLM is unavailable.
 */
function heuristicConcepts(anchors, maxConcepts, seedSet, usedIds) {
  const groups = new Map();

  for (const a of anchors) {
    let key;
    if (a.type === 'table') {
      const parts = String(a.full_name).split('.');
      key = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    } else if (a.type === 'md_doc') {
      key = String(a.s_name || a.h_name || a.full_name).replace(/^doc:/, '').replace(/\.md$/i, '');
    } else {
      // module / schema prefix
      const fn = String(a.full_name);
      const schema = fn.includes('.') ? fn.split('.')[0] : fn.split(/[/\\#]/)[0];
      key = schema;
    }
    const id = toKebabId(key);
    if (seedSet.has(id) || seedSet.has(`concept:${id}`)) continue;
    if (!groups.has(id)) groups.set(id, { id, name: key, items: [] });
    groups.get(id).items.push(a);
  }

  return [...groups.values()]
    .sort((a, b) => b.items.length - a.items.length)
    .slice(0, maxConcepts)
    .map((g) => {
      const id = uniqueKebab(g.id, usedIds);
      return {
        id,
        name: g.name,
        rationale: `Сгруппировано ${g.items.length} якорей (эвристика по имени/схеме)`,
        aspects: ['domain'],
        relations: [],
        _anchors: g.items
      };
    });
}

/**
 * LLM clustering of anchors into concepts.
 */
async function llmProposeConcepts(anchors, maxConcepts, seedConcepts, contextCode) {
  const sample = anchors.slice(0, 60).map((a) => ({
    full_name: a.full_name,
    type: a.type,
    degree: a.degree,
    name: a.h_name || a.s_name || a.full_name
  }));

  const prompt = {
    task: 'Propose domain ontology concepts from vectorized code/db/doc items',
    contextCode,
    maxConcepts,
    seedConceptsToAvoid: seedConcepts || [],
    anchors: sample,
    outputSchema: {
      concepts: [
        {
          id: 'kebab-case-latin',
          name: 'human name',
          rationale: 'why this concept',
          aspects: ['domain'],
          anchorFullNames: ['subset of anchors.full_name']
        }
      ]
    },
    rules: [
      'id must be kebab-case [a-z0-9-]+',
      'do not duplicate seedConcepts',
      'prefer domain/API/table clusters over noise',
      '1- maxConcepts concepts',
      'return JSON only: { "concepts": [...] }'
    ]
  };

  const text = await callLLM(
    [
      {
        role: 'system',
        content:
          'You are an ontology designer. Group code/database/document items into domain concepts. Reply with JSON only.'
      },
      { role: 'user', content: JSON.stringify(prompt) }
    ],
    null,
    { jsonMode: true }
  );

  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed.concepts) ? parsed.concepts : [];
  return list.slice(0, maxConcepts);
}

function roleForType(type) {
  return TYPE_TO_ROLE[type] || 'implemented_in';
}

function targetForItem(item) {
  if (item.type === 'table') return `table:${item.full_name}`;
  if (item.type === 'md_doc') {
    return String(item.full_name).startsWith('doc:') ? item.full_name : `doc:${item.full_name}`;
  }
  return item.full_name;
}

/**
 * Build grounding candidates for a concept from anchors / nearest items.
 */
async function buildGroundingCandidates(dbService, contextCode, concept, anchorsByName, depth) {
  if (depth === 'concepts') return [];

  const candidates = [];
  const seen = new Set();
  const anchorNames = concept.anchorFullNames || (concept._anchors || []).map((a) => a.full_name);

  for (const name of anchorNames) {
    const item = anchorsByName.get(name);
    if (!item) continue;
    const rawTarget = targetForItem(item);
    const role = roleForType(item.type);
    const resolved = await resolveGroundingTarget(rawTarget, contextCode, dbService);
    const key = `${role}|${resolved.target}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let confidence = resolved.resolved ? 0.85 : 0.35;
    let source = resolved.resolved
      ? `anchor+resolveGroundingTarget${resolved.note ? ` (${resolved.note})` : ''}`
      : `anchor unresolved${resolved.note ? `: ${resolved.note}` : ''}`;

    // Ambiguity: if resolve returned note about multiple matches, lower confidence
    if (resolved.note && /неоднозначн/i.test(resolved.note)) {
      confidence = 0.2;
      source = resolved.note;
    }

    candidates.push({
      role,
      target: resolved.target,
      confidence,
      source
    });
  }

  // If LLM gave no anchors, attach top degree items by name substring
  if (candidates.length === 0 && concept.id) {
    const needle = concept.id.replace(/-/g, '');
    for (const item of anchorsByName.values()) {
      const fn = String(item.full_name).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!fn.includes(needle) && !fn.includes(concept.id.replace(/-/g, ''))) continue;
      const rawTarget = targetForItem(item);
      const role = roleForType(item.type);
      const resolved = await resolveGroundingTarget(rawTarget, contextCode, dbService);
      const key = `${role}|${resolved.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        role,
        target: resolved.target,
        confidence: resolved.resolved ? 0.55 : 0.25,
        source: 'name-substring match'
      });
      if (candidates.length >= 5) break;
    }
  }

  return candidates;
}

/**
 * Lift L1 links between grounded items to concept-level relations.
 */
async function liftRelations(dbService, contextCode, concepts) {
  // Map full_name/target -> concept id
  const itemToConcept = new Map();
  for (const c of concepts) {
    for (const g of c.groundingCandidates || []) {
      itemToConcept.set(g.target, c.id);
      // also bare name without table:
      if (String(g.target).startsWith('table:')) {
        itemToConcept.set(g.target.slice('table:'.length), c.id);
      }
    }
  }

  if (itemToConcept.size === 0) return;

  const names = [...itemToConcept.keys()];
  const rows = (await dbService.pgClient.query(
    `SELECT l.source, l.target, lt.code
     FROM kosmos.link l
     JOIN kosmos.link_type lt ON lt.id = l.link_type_id
     WHERE l.context_code = $1
       AND l.source = ANY($2) AND l.target = ANY($2)
       AND lt.code NOT LIKE 'onto_%'
     LIMIT 500`,
    [contextCode, names]
  )).rows;

  const codeToRel = {
    calls: 'uses',
    'reads from': 'uses',
    updates: 'uses',
    'writes to': 'uses',
    imports: 'uses',
    extends: 'part_of',
    implements: 'part_of',
    contains: 'part_of',
    precedes: 'precedes',
    follows: 'precedes'
  };

  const relSets = new Map(concepts.map((c) => [c.id, new Set((c.relations || []).map((r) => `${r.type}|${r.target}`))]));

  for (const row of rows) {
    const fromC = itemToConcept.get(row.source);
    const toC = itemToConcept.get(row.target);
    if (!fromC || !toC || fromC === toC) continue;
    const relType = codeToRel[row.code] || 'related_to';
    if (!ALLOWED_RELATIONS.includes(relType)) continue;
    const key = `${relType}|${toC}`;
    const set = relSets.get(fromC);
    if (set.has(key)) continue;
    set.add(key);
    const concept = concepts.find((c) => c.id === fromC);
    if (concept) {
      concept.relations = concept.relations || [];
      concept.relations.push({ type: relType, target: toC, comment: `lifted from L1 ${row.code}` });
    }
  }
}

/**
 * POST suggest — read-only draft.
 */
async function suggestOntology(dbService, contextCode, options = {}) {
  const maxConcepts = Math.min(30, Math.max(1, Number(options.maxConcepts) || 20));
  const depth = options.depth === 'concepts' ? 'concepts' : 'concepts+grounding';
  const aspectsFilter = Array.isArray(options.aspects) ? options.aspects : null;
  const seedConcepts = Array.isArray(options.seedConcepts) ? options.seedConcepts : [];

  await assertVectorizedReality(dbService, contextCode);

  const existingIds = await loadExistingConceptIds(dbService, contextCode);
  const seedSet = new Set([
    ...seedConcepts.map((s) => String(s).replace(/^concept:/, '')),
    ...existingIds
  ]);
  const usedIds = new Set(seedSet);

  const anchors = await collectAnchors(dbService, contextCode, 100);
  const anchorsByName = new Map(anchors.map((a) => [a.full_name, a]));

  let proposed = [];
  let source = 'heuristic';
  try {
    const llmList = await llmProposeConcepts(anchors, maxConcepts, [...seedSet], contextCode);
    source = 'llm';
    for (const raw of llmList) {
      const baseId = toKebabId(raw.id || raw.name);
      if (seedSet.has(baseId)) continue;
      const id = uniqueKebab(baseId, usedIds);
      proposed.push({
        id,
        name: raw.name || id,
        rationale: raw.rationale || 'LLM proposal',
        aspects: Array.isArray(raw.aspects) && raw.aspects.length ? raw.aspects : ['domain'],
        relations: [],
        anchorFullNames: Array.isArray(raw.anchorFullNames) ? raw.anchorFullNames : []
      });
    }
  } catch (e) {
    console.warn('[OntologyBuilder] LLM suggest failed, using heuristic:', e.message);
    proposed = heuristicConcepts(anchors, maxConcepts, seedSet, usedIds);
    source = 'heuristic';
  }

  if (proposed.length === 0) {
    proposed = heuristicConcepts(anchors, maxConcepts, seedSet, usedIds);
    source = 'heuristic';
  }

  // Attach grounding
  for (const c of proposed) {
    if (aspectsFilter && c.aspects && !c.aspects.some((a) => aspectsFilter.includes(a))) {
      c._skip = true;
      continue;
    }
    c.groundingCandidates = await buildGroundingCandidates(dbService, contextCode, c, anchorsByName, depth);
    c.relations = Array.isArray(c.relations) ? c.relations.filter((r) => ALLOWED_RELATIONS.includes(r.type)) : [];
    delete c.anchorFullNames;
    delete c._anchors;
  }

  let concepts = proposed.filter((c) => !c._skip).slice(0, maxConcepts);
  await liftRelations(dbService, contextCode, concepts);

  // Final sanitize relations
  for (const c of concepts) {
    c.relations = (c.relations || []).filter(
      (r) => ALLOWED_RELATIONS.includes(r.type) && concepts.some((x) => x.id === r.target)
    );
    if (depth === 'concepts') c.groundingCandidates = [];
  }

  return {
    contextCode,
    depth,
    maxConcepts,
    source,
    suggestedAt: new Date().toISOString(),
    concepts,
    meta: {
      anchorsConsidered: anchors.length,
      seedExcluded: seedSet.size
    }
  };
}

/**
 * Serialize one concept to ONTOLOGY_SPEC MD.
 */
function serializeConceptToMd(concept, contextCode) {
  const id = concept.id;
  const name = concept.name || id;
  const aspects = Array.isArray(concept.aspects) && concept.aspects.length ? concept.aspects : ['domain'];
  const updated = new Date().toISOString().slice(0, 10);
  const description =
    concept.description ||
    concept.rationale ||
    `Черновик понятия «${name}», сгенерированный Ontology Builder.`;

  const fm = [
    '---',
    `id: ${id}`,
    `name: ${name}`,
    'type: concept',
    `context: ${contextCode}`,
    `aspects: [${aspects.join(', ')}]`,
    'status: draft',
    `updated: ${updated}`,
    '---'
  ].join('\n');

  const relRows = (concept.relations || [])
    .filter((r) => ALLOWED_RELATIONS.includes(r.type))
    .map((r) => {
      const bare = String(r.target).startsWith('concept:')
        ? String(r.target).slice('concept:'.length)
        : r.target;
      const target = `concept:${bare}`;
      const comment = r.comment ? String(r.comment).replace(/\|/g, '/') : '';
      return `| ${r.type} | ${target} | ${comment} |`;
    });

  const groundRows = (concept.groundingCandidates || concept.grounding || [])
    .filter((g) => GROUNDING_ROLES.includes(g.role) && g.target)
    .map((g) => {
      const comment = g.source ? String(g.source).replace(/\|/g, '/') : '';
      return `| ${g.role} | ${g.target} | ${comment} |`;
    });

  const parts = [
    fm,
    '',
    '## Описание',
    '',
    description,
    '',
    '## Отношения',
    '',
    '| Тип | Понятие | Комментарий |',
    '|---|---|---|',
    ...(relRows.length ? relRows : []),
    ''
  ];

  if (groundRows.length) {
    parts.push(
      '## Grounding',
      '',
      '| Роль | Цель | Комментарий |',
      '|---|---|---|',
      ...groundRows,
      ''
    );
  }

  return parts.join('\n');
}

/**
 * Materialize approved draft to concepts/*.md in first onto_loading.dirs entry.
 * @param {object} options
 * @param {boolean} [options.overwrite=false]
 * @param {boolean} [options.allowExisting=false] — if true, existing files are skipped (not error)
 * @param {boolean} [options.dryRun=false]
 */
async function materializeConcepts(contextCode, concepts, options = {}) {
  const overwrite = !!options.overwrite;
  const allowExisting = !!options.allowExisting;
  const resolved = await getOntoDirs(contextCode, {
    dirs: options.dirs,
    outDir: options.outDir,
    createIfMissing: true
  });
  const dirs = resolved.dirs;
  const outDir = dirs[0];

  const conflicts = [];
  const skippedExisting = [];
  const written = [];
  const previews = [];

  for (const c of concepts || []) {
    if (!c || !c.id) continue;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id)) {
      conflicts.push({ id: c.id, reason: 'id must be kebab-case latin' });
      continue;
    }
    const filePath = path.join(outDir, `${c.id}.md`);
    if (fs.existsSync(filePath) && !overwrite) {
      if (allowExisting) {
        skippedExisting.push({ id: c.id, path: filePath, reason: 'file exists (kept)' });
        continue;
      }
      conflicts.push({ id: c.id, path: filePath, reason: 'file exists' });
      continue;
    }
    const content = serializeConceptToMd(c, contextCode);
    previews.push({ id: c.id, path: filePath, preview: content.slice(0, 500) });
    if (options.dryRun) continue;
    fs.writeFileSync(filePath, content, 'utf8');
    written.push({ id: c.id, path: filePath });
  }

  const onlyFileExistsConflicts =
    conflicts.length > 0 &&
    written.length === 0 &&
    skippedExisting.length === 0 &&
    conflicts.every((c) => c.reason === 'file exists');

  if (conflicts.length > 0 && written.length === 0 && skippedExisting.length === 0 && !options.dryRun) {
    const ids = conflicts.map((c) => c.id).join(', ');
    const err = new Error(
      onlyFileExistsConflicts
        ? `Файлы понятий уже существуют (${conflicts.length}): ${ids}.\n\n` +
          `Варианты:\n` +
          `• «Применить» — подхватит уже записанные MD (без перезаписи)\n` +
          `• materialize с overwrite: true — перезаписать файлы\n` +
          `• смените id понятий`
        : `Конфликт id: ${ids}`
    );
    err.status = 409;
    err.code = onlyFileExistsConflicts ? 'CONCEPT_FILES_EXIST' : 'MATERIALIZE_CONFLICT';
    err.userFacing = true;
    err.conflicts = conflicts;
    err.outDir = outDir;
    throw err;
  }

  let warning = resolved.warning || null;
  if (skippedExisting.length > 0) {
    const skipMsg =
      `Уже на диске (не перезаписывались): ${skippedExisting.map((s) => s.id).join(', ')}. ` +
      `Для перезаписи передайте overwrite: true.`;
    warning = warning ? `${warning}\n${skipMsg}` : skipMsg;
  }

  return {
    contextCode,
    outDir,
    dirs,
    dirsSource: resolved.source,
    configUpdated: resolved.configUpdated,
    warning,
    written,
    skippedExisting,
    conflicts,
    previews,
    dryRun: !!options.dryRun
  };
}

/**
 * Run validate logic (shared shape with GET /validate).
 */
async function runValidateReport(dbService, contextCode) {
  const GROUNDING_CODES = [
    'onto_implemented_in',
    'onto_stored_in',
    'onto_documented_in',
    'onto_configured_in'
  ];
  const RELATION_CODES = [
    'onto_part_of',
    'onto_has_part',
    'onto_uses',
    'onto_used_by',
    'onto_manages',
    'onto_managed_by',
    'onto_produces',
    'onto_produced_by',
    'onto_consumes',
    'onto_consumed_by',
    'onto_precedes',
    'onto_follows',
    'onto_related_to'
  ];
  const q = async (sql, params) => (await dbService.pgClient.query(sql, params)).rows;

  const brokenGrounding = await q(
    `SELECT lt.code AS role, l.source AS concept, l.target
     FROM kosmos.link l JOIN kosmos.link_type lt ON lt.id = l.link_type_id
     WHERE l.context_code = $1 AND lt.code = ANY($2)
       AND NOT EXISTS (SELECT 1 FROM kosmos.ai_item ai
                       WHERE ai.full_name = l.target OR ai.full_name LIKE l.target || '#%')
     ORDER BY l.source, l.target`,
    [contextCode, GROUNDING_CODES]
  );
  const staleGrounding = await q(
    `SELECT l.source AS concept, l.target, lt.code AS role
     FROM kosmos.link l
     JOIN kosmos.link_type lt ON lt.id = l.link_type_id
     JOIN kosmos.ai_item ai ON ai.context_code = l.context_code
       AND (ai.full_name = l.target OR ai.full_name LIKE l.target || '#%')
     WHERE l.context_code = $1 AND lt.code = ANY($2) AND ai.needs_rebuild = true
     GROUP BY l.source, l.target, lt.code`,
    [contextCode, GROUNDING_CODES]
  );
  const conceptsWithoutGrounding = (
    await q(
      `SELECT c.full_name FROM kosmos.ai_item c
       WHERE c.type = 'concept' AND c.context_code = $1
         AND NOT EXISTS (SELECT 1 FROM kosmos.link l JOIN kosmos.link_type lt ON lt.id = l.link_type_id
                         WHERE l.source = c.full_name AND l.context_code = $1 AND lt.code = ANY($2))
       ORDER BY 1`,
      [contextCode, GROUNDING_CODES]
    )
  ).map((r) => r.full_name);
  const danglingRelations = await q(
    `SELECT lt.code AS relation, l.source, l.target
     FROM kosmos.link l JOIN kosmos.link_type lt ON lt.id = l.link_type_id
     WHERE l.context_code = $1 AND lt.code = ANY($2) AND l.target LIKE 'concept:%'
       AND NOT EXISTS (SELECT 1 FROM kosmos.ai_item ai
                       WHERE ai.full_name = l.target AND ai.context_code = $1)
     ORDER BY l.source`,
    [contextCode, RELATION_CODES]
  );
  const coverageByType = await q(
    `SELECT ai.type, count(*)::int AS total,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM kosmos.link l JOIN kosmos.link_type lt ON lt.id = l.link_type_id
         WHERE lt.code = ANY($2) AND l.context_code = ai.context_code
           AND (l.target = ai.full_name OR ai.full_name LIKE l.target || '#%')
       ))::int AS covered
     FROM kosmos.ai_item ai
     WHERE ai.context_code = $1 AND ai.type IN ('class','function','method','table','md_doc','interface')
     GROUP BY ai.type ORDER BY total DESC`,
    [contextCode, GROUNDING_CODES]
  );
  const uncoveredSamples = await q(
    `SELECT ai.full_name, ai.type, count(cv.id)::int AS chunks
     FROM kosmos.ai_item ai LEFT JOIN kosmos.chunk_vector cv ON cv.ai_item_id = ai.id
     WHERE ai.context_code = $1 AND ai.type IN ('class','table','md_doc')
       AND NOT EXISTS (
         SELECT 1 FROM kosmos.link l JOIN kosmos.link_type lt ON lt.id = l.link_type_id
         WHERE lt.code = ANY($2) AND l.context_code = ai.context_code
           AND (l.target = ai.full_name OR ai.full_name LIKE l.target || '#%'))
     GROUP BY ai.full_name, ai.type ORDER BY chunks DESC, ai.full_name LIMIT 20`,
    [contextCode, GROUNDING_CODES]
  );

  const summary = {
    brokenGrounding: brokenGrounding.length,
    staleGroundingTargets: staleGrounding.length,
    conceptsWithoutGrounding: conceptsWithoutGrounding.length,
    danglingRelations: danglingRelations.length,
    coverage: coverageByType.map((r) => `${r.type}: ${r.covered}/${r.total}`).join(', '),
    ok:
      brokenGrounding.length === 0 &&
      danglingRelations.length === 0
  };

  return {
    contextCode,
    checkedAt: new Date().toISOString(),
    summary,
    details: {
      brokenGrounding,
      staleGrounding,
      conceptsWithoutGrounding,
      danglingRelations,
      coverageByType,
      uncoveredSamples
    }
  };
}

/**
 * Apply loop: materialize → onto_loading → vectorize concept:* → validate.
 */
async function applyOntologyBuild(dbService, embeddings, contextCode, options = {}, pipelineState = null) {
  await assertVectorizedReality(dbService, contextCode);

  const result = {
    contextCode,
    startedAt: new Date().toISOString(),
    materialize: null,
    load: null,
    vectorize: null,
    validate: null,
    success: false,
    abortedAt: null,
    error: null
  };

  if (pipelineState) {
    try {
      pipelineState.updateStep(6, {
        status: 'running',
        progress: 0,
        error: null,
        startedAt: result.startedAt
      });
    } catch (_) {
      /* step may be missing in old state managers */
    }
  }

  try {
    // Resolve dirs once for materialize + load
    const resolvedDirs = await getOntoDirs(contextCode, {
      dirs: options.dirs,
      outDir: options.outDir,
      createIfMissing: true
    });
    result.dirs = resolvedDirs.dirs;
    result.dirsSource = resolvedDirs.source;

    // 1. Materialize (if draft provided).
    // After a prior «Записать MD», files already exist — apply must not fail:
    // allowExisting keeps them; overwrite:true rewrites when user asks.
    if (Array.isArray(options.concepts) && options.concepts.length > 0) {
      result.materialize = await materializeConcepts(contextCode, options.concepts, {
        overwrite: !!options.overwrite,
        allowExisting: options.allowExisting !== false && !options.overwrite,
        dirs: resolvedDirs.dirs
      });
      // Hard stop only on non-existence conflicts (e.g. bad id), not "file exists"
      const hardConflicts = (result.materialize.conflicts || []).filter(
        (c) => c.reason !== 'file exists'
      );
      if (
        hardConflicts.length > 0 &&
        result.materialize.written.length === 0 &&
        (result.materialize.skippedExisting || []).length === 0
      ) {
        const err = new Error(
          `Materialize: не удалось записать понятия (${hardConflicts.map((c) => c.id).join(', ')})`
        );
        err.status = 409;
        err.code = 'MATERIALIZE_CONFLICT';
        err.userFacing = true;
        err.conflicts = hardConflicts;
        throw err;
      }
    }

    if (pipelineState) {
      try {
        pipelineState.updateStep(6, { progress: 25 });
      } catch (_) {}
    }

    // 2. onto_loading (all dirs)
    const dirs = resolvedDirs.dirs;
    const loadReports = [];
    for (const dir of dirs) {
      const report = await loadOntologyFromDir(dir, contextCode, dbService);
      loadReports.push(report);
      if (report.errors && report.errors.length > 0) {
        result.load = { dirs: loadReports, success: false };
        result.abortedAt = 'load';
        result.error = {
          message: 'onto_loading failed validation/load',
          errors: report.errors
        };
        if (pipelineState) {
          try {
            pipelineState.updateStep(6, {
              status: 'failed',
              error: result.error.message,
              report: result,
              completedAt: new Date().toISOString()
            });
          } catch (_) {}
        }
        return result;
      }
    }
    result.load = {
      dirs: loadReports,
      success: true,
      conceptsLoaded: loadReports.reduce((s, r) => s + (r.conceptsLoaded || 0), 0)
    };

    if (pipelineState) {
      try {
        pipelineState.updateStep(6, { progress: 55 });
      } catch (_) {}
    }

    // 3. Re-vectorize concept:* (force)
    if (!embeddings) {
      result.error = { message: 'Embeddings не сконфигурированы — векторизация concept:* пропущена' };
      result.abortedAt = 'vectorize';
      if (pipelineState) {
        try {
          pipelineState.updateStep(6, {
            status: 'failed',
            error: result.error.message,
            report: result
          });
        } catch (_) {}
      }
      return result;
    }

    const sessionId = `${contextCode}-ontology-apply-${Date.now()}`;
    // Do not touch real Step4 status while re-vectorizing concepts inside apply
    const step4StateShim = {
      updateStep() {},
      getStep() {
        return { status: 'pending' };
      }
    };

    result.vectorize = await runStep4(
      contextCode,
      sessionId,
      dbService,
      embeddings,
      step4StateShim,
      null,
      { force: true, types: ['concept'], fullNamePrefix: 'concept:', batchSize: 20 }
    );

    if (pipelineState) {
      try {
        pipelineState.updateStep(6, { progress: 85 });
      } catch (_) {}
    }

    // 4. Validate
    result.validate = await runValidateReport(dbService, contextCode);
    result.success = true;
    result.finishedAt = new Date().toISOString();

    if (pipelineState) {
      try {
        pipelineState.updateStep(6, {
          status: 'completed',
          progress: 100,
          completedAt: result.finishedAt,
          report: {
            conceptsLoaded: result.load.conceptsLoaded,
            vectorized: result.vectorize?.vectorized,
            validateSummary: result.validate.summary,
            success: true
          }
        });
      } catch (_) {}
    }

    return result;
  } catch (e) {
    result.error = { message: e.message, conflicts: e.conflicts };
    result.abortedAt = result.abortedAt || 'apply';
    if (pipelineState) {
      try {
        pipelineState.updateStep(6, {
          status: 'failed',
          error: e.message,
          report: result,
          completedAt: new Date().toISOString()
        });
      } catch (_) {}
    }
    if (e.status) result.httpStatus = e.status;
    throw Object.assign(e, { applyResult: result });
  }
}

/**
 * Live status snapshot for Step 6 card.
 */
async function getBuilderStatus(dbService, contextCode) {
  const q = async (sql, params) => (await dbService.pgClient.query(sql, params)).rows;
  const counts = await q(
    `SELECT
       count(*) FILTER (WHERE true)::int AS total,
       count(*) FILTER (WHERE coalesce(h_name,'') <> '')::int AS named
     FROM kosmos.ai_item WHERE context_code = $1 AND type = 'concept'`,
    [contextCode]
  );

  let draft = 0;
  let verified = 0;
  let conceptsDir = null;
  let dirsSource = null;
  const ontoCheck = await checkOntoLoadingConfig(contextCode);
  if (ontoCheck.ok) {
    conceptsDir = ontoCheck.dirs[0] || null;
    dirsSource = 'config';
    for (const dir of ontoCheck.dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        if (/status:\s*verified/.test(text)) verified++;
        else if (/status:\s*draft/.test(text)) draft++;
      }
    }
  }

  let vectorizedReality = 0;
  try {
    vectorizedReality = await assertVectorizedReality(dbService, contextCode);
  } catch {
    vectorizedReality = 0;
  }

  const needsOntoConfig = !ontoCheck.ok;
  const needsStep4 = vectorizedReality === 0;
  let gateReason = null;
  if (needsStep4) {
    gateReason = 'Заблокировано: нет векторизации (нужен Step4)';
  } else if (needsOntoConfig) {
    gateReason =
      `Заблокировано: настройте onto_loading (enabled + dirs) в kb-config для «${contextCode}». ` +
      `Пример dirs: ${ontoCheck.exampleDir}`;
  }

  return {
    conceptsInDb: counts[0]?.total || 0,
    draftFiles: draft,
    verifiedFiles: verified,
    vectorizedReality,
    conceptsDir,
    dirsSource,
    ontoLoadingOk: ontoCheck.ok,
    ontoLoadingReason: ontoCheck.reason || null,
    ontoLoadingExampleDir: ontoCheck.exampleDir || null,
    gated: needsStep4 || needsOntoConfig,
    gateReason
  };
}

module.exports = {
  assertVectorizedReality,
  suggestOntology,
  materializeConcepts,
  serializeConceptToMd,
  applyOntologyBuild,
  getBuilderStatus,
  getOntoDirs,
  checkOntoLoadingConfig,
  parseOntoLoading,
  defaultConceptsDir,
  makeOntoLoadingNotConfiguredError,
  runValidateReport,
  toKebabId
};
