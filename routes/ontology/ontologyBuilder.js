// Ontology Builder: suggest draft concepts from vectorized reality → materialize MD → apply loop
// routes/ontology/ontologyBuilder.js

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const kbConfigService = require('../../packages/core/kbConfigService');
const appConfigService = require('../../packages/core/appConfigService');
const {
  getDefaultOntologyBuilderConfig,
  renderPromptTemplate
} = require('../../packages/core/ontologyBuilderDefaults');
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
 * Collect anchor items for ontology suggest.
 * Priority: tables → class/interface → functions → methods (methods deprioritized for prompts).
 */
async function collectAnchors(dbService, contextCode, limit = 80) {
  const q = async (sql, params) => (await dbService.pgClient.query(sql, params)).rows;

  const byPriority = await q(
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
     ORDER BY
       CASE ai.type
         WHEN 'table' THEN 0
         WHEN 'class' THEN 1
         WHEN 'interface' THEN 2
         WHEN 'function' THEN 3
         WHEN 'md_doc' THEN 4
         WHEN 'method' THEN 5
         ELSE 6
       END,
       degree DESC,
       vectorized_chunks DESC,
       ai.full_name
     LIMIT $2`,
    [contextCode, limit]
  );

  return byPriority;
}

/**
 * All tables for context (even low degree) — must be coverable in ontology.
 */
async function collectTableAnchors(dbService, contextCode) {
  const q = async (sql, params) => (await dbService.pgClient.query(sql, params)).rows;
  return q(
    `SELECT ai.full_name, ai.type, ai.h_name, ai.s_name,
            count(DISTINCT l.id)::int AS degree,
            count(DISTINCT cv.id) FILTER (WHERE cv.embedding IS NOT NULL)::int AS vectorized_chunks
     FROM kosmos.ai_item ai
     LEFT JOIN kosmos.link l ON l.context_code = ai.context_code
       AND (l.source = ai.full_name OR l.target = ai.full_name)
     LEFT JOIN kosmos.chunk_vector cv ON cv.ai_item_id = ai.id
     WHERE ai.context_code = $1 AND ai.type = 'table'
     GROUP BY ai.full_name, ai.type, ai.h_name, ai.s_name
     ORDER BY ai.full_name`,
    [contextCode]
  );
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
 * Build seed avoid-list for the LLM prompt.
 * user-only (default): only explicit UI/API seedConcepts — do NOT dump every concept in DB
 *   (that forced models to invent employee-ops-service instead of reusing employee).
 * all-existing: legacy — all concept ids in context.
 */
function buildPromptSeedList(userSeeds, existingIds, seedMode) {
  const user = (userSeeds || []).map((s) => String(s).replace(/^concept:/, '').trim()).filter(Boolean);
  if (seedMode === 'all-existing') {
    return [...new Set([...user, ...existingIds])];
  }
  return user;
}

/**
 * Merge anchors: tables always first, drop most methods from the prompt sample.
 */
function selectAnchorsForPrompt(anchors, tables, cap) {
  const byName = new Map();
  for (const a of tables || []) byName.set(a.full_name, a);
  for (const a of anchors || []) {
    if (!byName.has(a.full_name)) byName.set(a.full_name, a);
  }
  const all = [...byName.values()];
  const tablesList = all.filter((a) => a.type === 'table');
  const classes = all.filter((a) => a.type === 'class' || a.type === 'interface');
  const functions = all.filter((a) => a.type === 'function');
  // methods only if room — high degree, few
  const methods = all
    .filter((a) => a.type === 'method')
    .sort((a, b) => (b.degree || 0) - (a.degree || 0))
    .slice(0, 6);
  const docs = all.filter((a) => a.type === 'md_doc');

  const ordered = [...tablesList, ...classes, ...functions, ...docs, ...methods];
  return ordered.slice(0, cap);
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
 * Load ontology_builder section from app config (with defaults).
 */
/**
 * Runtime settings: ONLY from app config (System Settings → ontology_builder).
 * Factory text lives in ontologyBuilderDefaults and is merged via appConfigService.normalize
 * into GET/PATCH /api/config — never re-hardcode prompt bodies in the builder path.
 */
function getOntologyBuilderSettings() {
  try {
    const cfg = appConfigService.getConfig();
    if (!cfg.ontology_builder || typeof cfg.ontology_builder !== 'object') {
      throw new Error('ontology_builder missing from app config');
    }
    return { ...cfg.ontology_builder };
  } catch (e) {
    // Last resort if config unreadable — still go through defaults module once
    console.error('[OntologyBuilder] App config unavailable:', e.message);
    return getDefaultOntologyBuilderConfig();
  }
}

/**
 * Drop util-like anchors by name patterns from settings.
 */
function filterAnchorsByExcludePatterns(anchors, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return anchors;
  const regs = [];
  for (const p of patterns) {
    try {
      regs.push(new RegExp(p));
    } catch {
      /* skip bad regex */
    }
  }
  if (regs.length === 0) return anchors;
  return anchors.filter((a) => {
    const names = [a.full_name, a.h_name, a.s_name].filter(Boolean).map(String);
    return !regs.some((re) => names.some((n) => re.test(n)));
  });
}

/**
 * Strip markdown fences and extract a JSON-looking substring.
 */
function stripLlmJsonWrapper(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // drop leading junk before first {
  const i = t.indexOf('{');
  if (i > 0) t = t.slice(i);
  return t;
}

/**
 * Best-effort salvage of a truncated concept object (unterminated string).
 * Pulls id / name / anchors if already closed in the fragment.
 */
function salvageIncompleteConceptObject(fragment) {
  if (!fragment || fragment.indexOf('{') === -1) return null;
  const idM = fragment.match(/"id"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!idM) return null;
  const nameM = fragment.match(/"name"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const anchors = [];
  const anchorBlock = fragment.match(/"anchorFullNames"\s*:\s*\[([\s\S]*)/);
  if (anchorBlock) {
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let am;
    while ((am = re.exec(anchorBlock[1])) !== null) {
      anchors.push(am[1].replace(/\\"/g, '"'));
      if (anchors.length >= 5) break;
    }
  }
  return {
    id: idM[1].replace(/\\"/g, '"'),
    name: nameM ? nameM[1].replace(/\\"/g, '"') : idM[1],
    rationale: 'recovered from truncated LLM JSON',
    aspects: ['domain'],
    anchorFullNames: anchors
  };
}

/**
 * Extract complete objects from a truncated `"concepts": [ {...}, {...` payload.
 * Survives Unterminated string / cut mid-object (common when max_tokens hits).
 * @returns {{ concepts: object[] }|null}
 */
function extractCompleteConceptsFromPartialJson(text) {
  const t = stripLlmJsonWrapper(text);
  const keyRe = /"concepts"\s*:\s*\[/;
  const m = t.match(keyRe);
  if (!m) return null;

  let i = m.index + m[0].length;
  const concepts = [];

  while (i < t.length) {
    while (i < t.length && /[\s,]/.test(t[i])) i++;
    if (i >= t.length || t[i] === ']') break;
    if (t[i] !== '{') break;

    const start = i;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let closed = false;

    for (; i < t.length; i++) {
      const c = t[i];
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (c === '\\') {
          esc = true;
          continue;
        }
        if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          i++;
          closed = true;
          break;
        }
      }
    }

    if (!closed) {
      // Last object truncated mid-stream — try salvage id/name
      const salvaged = salvageIncompleteConceptObject(t.slice(start));
      if (salvaged) {
        console.warn(
          `[OntologyBuilder] Salvaged incomplete concept id=${salvaged.id} from truncated JSON`
        );
        concepts.push(salvaged);
      }
      break;
    }
    try {
      concepts.push(JSON.parse(t.slice(start, i)));
    } catch {
      const salvaged = salvageIncompleteConceptObject(t.slice(start, i));
      if (salvaged) concepts.push(salvaged);
      break;
    }
  }

  return concepts.length > 0 ? { concepts } : null;
}

/**
 * Parse LLM JSON; tolerate fences + truncated concepts arrays.
 */
function parseLlmConceptsResponse(text) {
  const cleaned = stripLlmJsonWrapper(text);
  const attempts = [cleaned];
  // also try raw if cleaned differed
  if (cleaned !== String(text || '').trim()) attempts.push(String(text || '').trim());

  let lastErr = null;
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return { concepts: parsed };
      if (parsed && Array.isArray(parsed.concepts)) return parsed;
      if (parsed && typeof parsed === 'object') {
        // single concept mistaken as root
        if (parsed.id) return { concepts: [parsed] };
      }
      lastErr = new Error('JSON parsed but no concepts array');
    } catch (e) {
      lastErr = e;
    }
  }

  const recovered = extractCompleteConceptsFromPartialJson(text);
  if (recovered) {
    console.warn(
      `[OntologyBuilder] LLM JSON truncated/invalid; recovered ${recovered.concepts.length} complete concept(s)`
    );
    return recovered;
  }

  const preview = String(text || '').slice(0, 240).replace(/\s+/g, ' ');
  const err = new Error(
    `Битый или обрезанный JSON от LLM: ${lastErr?.message || 'parse failed'}. ` +
      `Начало ответа: «${preview}${String(text || '').length > 240 ? '…' : ''}». ` +
      `Уменьшите maxConcepts / exclude patterns или смените модель.`
  );
  err.code = 'LLM_BAD_JSON';
  throw err;
}

/**
 * Compact anchor lines for the model (less prompt bloat → more room for complete JSON).
 */
function formatAnchorsCompact(anchors, limit) {
  return anchors.slice(0, limit).map((a) => ({
    n: a.full_name,
    t: a.type,
    d: a.degree
  }));
}

/**
 * LLM clustering of anchors into concepts (prompts/model from System Settings).
 */
async function llmProposeConcepts(anchors, maxConcepts, seedConcepts, contextCode, builderSettings, extra = {}) {
  const settings = builderSettings || getOntologyBuilderSettings();
  const tableAnchors = extra.tableAnchors || anchors.filter((a) => a.type === 'table');
  const existingConcepts = extra.existingConcepts || [];
  const anchorCap = Math.min(32, Math.max(16, maxConcepts * 3));
  const selected = selectAnchorsForPrompt(anchors, tableAnchors, anchorCap);
  const sample = formatAnchorsCompact(selected, anchorCap);

  // Prompts ONLY from System Settings (ontology_builder) — no inline hardcode
  const systemPrompt = String(settings.systemPrompt || '').trim();
  const userTemplate = String(settings.userPromptTemplate || '').trim();
  const outputRules = String(settings.outputRulesSuffix || '').trim();
  const retrySystem = String(settings.retrySystemPrompt || systemPrompt).trim();
  const retryUserTemplate = String(settings.retryUserTemplate || userTemplate).trim();

  if (!systemPrompt || !userTemplate) {
    const err = new Error(
      'ontology_builder.systemPrompt / userPromptTemplate пусты. ' +
        'Settings → Ontology Builder → «Подставить factory defaults» → Save.'
    );
    err.status = 400;
    err.code = 'ONTOLOGY_PROMPTS_MISSING';
    err.userFacing = true;
    throw err;
  }

  const model =
    settings.model && String(settings.model).trim() ? String(settings.model).trim() : null;
  const temperature =
    settings.temperature !== undefined && settings.temperature !== null
      ? Number(settings.temperature)
      : 0;

  const outTokens = Math.min(8192, Math.max(2048, maxConcepts * 180 + 512));
  const seedList = Array.isArray(seedConcepts) ? seedConcepts : [...(seedConcepts || [])];
  const existingList = Array.isArray(existingConcepts) ? existingConcepts : [...existingConcepts];

  async function runOnce(anchorSample, maxC, useRetryPrompts, maxTok) {
    const sys = useRetryPrompts ? retrySystem : systemPrompt;
    const template = useRetryPrompts ? retryUserTemplate : userTemplate;
    const userContent =
      renderPromptTemplate(template, {
        maxConcepts: maxC,
        contextCode,
        seedConcepts: seedList,
        existingConcepts: existingList.slice(0, 40),
        anchors: anchorSample
      }) + (outputRules ? `\n\n${outputRules}` : '');

    const text = await callLLM(
      [
        { role: 'system', content: sys },
        { role: 'user', content: userContent }
      ],
      model,
      { jsonMode: true, temperature, max_tokens: maxTok }
    );
    console.log(`[OntologyBuilder] LLM raw length=${String(text).length}`);
    return parseLlmConceptsResponse(text);
  }

  let parsed;
  try {
    parsed = await runOnce(sample, maxConcepts, false, outTokens);
  } catch (e) {
    if (e.code !== 'LLM_BAD_JSON') throw e;
    console.warn('[OntologyBuilder] Bad JSON, retry #1 minimal prompt:', e.message);
    try {
      const smallSample = sample.slice(0, Math.min(18, sample.length));
      parsed = await runOnce(smallSample, Math.min(maxConcepts, 8), true, 4096);
    } catch (e2) {
      if (e2.code !== 'LLM_BAD_JSON') throw e2;
      console.warn('[OntologyBuilder] Bad JSON, retry #2 tiny payload:', e2.message);
      const tiny = sample.slice(0, 12);
      parsed = await runOnce(tiny, Math.min(maxConcepts, 6), true, 4096);
    }
  }

  const list = Array.isArray(parsed.concepts) ? parsed.concepts : [];
  for (const c of list) {
    if (Array.isArray(c.anchorFullNames)) {
      c.anchorFullNames = c.anchorFullNames.map((x) =>
        x && typeof x === 'object' && x.n ? x.n : x
      );
    }
  }
  return list.slice(0, maxConcepts);
}

/**
 * LLM failure → hard stop (no silent fallback). Motto: без ИИ жизни нет.
 */
function makeLlmRequiredError(stage, cause) {
  const detail = cause?.message || String(cause || 'unknown');
  const isBadJson =
    cause?.code === 'LLM_BAD_JSON' ||
    /JSON|Unterminated string|Unexpected token|parse/i.test(detail);

  const err = new Error(
    isBadJson
      ? `LLM ответил, но JSON непригоден на этапе «${stage}»: ${detail}\n\n` +
          `«Без ИИ жизни нет!» — операция остановлена (не подменяем эвристикой).\n` +
          `Что попробовать: уменьшить maxConcepts (8–12), проверить модель, ` +
          `исключить шумные anchors (exclude patterns), Retry suggest.`
      : `LLM недоступен или вернул ошибку на этапе «${stage}»: ${detail}\n\n` +
          `«Без ИИ жизни нет!» — операция остановлена. Проверьте kosmos-model / ` +
          `KOSMOS_BASE_URL / модель (System Settings → Ontology Builder) и повторите.`
  );
  err.status = isBadJson ? 502 : 503;
  err.code = isBadJson ? 'LLM_BAD_JSON' : 'LLM_REQUIRED';
  err.userFacing = true;
  err.cause = cause;
  return err;
}

/**
 * Optional second pass: enrich rationale/description from settings.descriptionPrompt.
 * Failures stop the request (no silent skip).
 */
async function enrichConceptDescriptions(concepts, builderSettings, contextCode) {
  if (!builderSettings?.enableDescriptionPass) return concepts;
  const template =
    (builderSettings.descriptionPrompt && String(builderSettings.descriptionPrompt).trim()) ||
    getDefaultOntologyBuilderConfig().descriptionPrompt;
  if (!template) return concepts;

  const payload = concepts.map((c) => ({
    id: c.id,
    name: c.name,
    rationale: c.rationale,
    anchors: c.anchorFullNames || []
  }));

  try {
    const model =
      builderSettings.model && String(builderSettings.model).trim()
        ? String(builderSettings.model).trim()
        : null;
    const descSystem = String(builderSettings.descriptionSystemPrompt || '').trim();
    if (!descSystem) {
      throw new Error(
        'ontology_builder.descriptionSystemPrompt пуст. Settings → Ontology Builder → factory defaults → Save.'
      );
    }
    const text = await callLLM(
      [
        { role: 'system', content: descSystem },
        {
          role: 'user',
          content: renderPromptTemplate(template, {
            contextCode,
            concepts: payload,
            maxConcepts: concepts.length
          })
        }
      ],
      model,
      {
        jsonMode: true,
        temperature:
          builderSettings.temperature !== undefined
            ? Number(builderSettings.temperature)
            : 0
      }
    );
    let parsed;
    try {
      parsed = JSON.parse(stripLlmJsonWrapper(text));
    } catch (pe) {
      const err = new Error(`description pass: invalid JSON (${pe.message})`);
      err.code = 'LLM_BAD_JSON';
      throw err;
    }
    const map = parsed.descriptions || parsed;
    if (!map || typeof map !== 'object') {
      throw new Error('description pass: invalid JSON shape (expected descriptions map)');
    }
    return concepts.map((c) => {
      const desc = map[c.id];
      if (typeof desc === 'string' && desc.trim()) {
        return { ...c, rationale: desc.trim(), description: desc.trim() };
      }
      return c;
    });
  } catch (e) {
    throw makeLlmRequiredError('ontology description pass', e);
  }
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
 * Shared setup for suggest / export-prompt / import-response.
 */
async function prepareSuggestContext(dbService, contextCode, options = {}) {
  const builderSettings = getOntologyBuilderSettings();
  const defaultMax = Number(builderSettings.maxConcepts) || 10;
  const maxConcepts = Math.min(
    30,
    Math.max(1, Number(options.maxConcepts) || defaultMax)
  );
  const defaultDepth =
    builderSettings.depth === 'concepts' ? 'concepts' : 'concepts+grounding';
  const depth =
    options.depth === 'concepts' || options.depth === 'concepts+grounding'
      ? options.depth
      : defaultDepth;
  const aspectsFilter = Array.isArray(options.aspects) ? options.aspects : null;
  const seedConcepts = Array.isArray(options.seedConcepts) ? options.seedConcepts : [];
  const seedMode =
    options.seedMode === 'all-existing' || options.seedMode === 'user-only'
      ? options.seedMode
      : builderSettings.seedMode === 'all-existing'
        ? 'all-existing'
        : 'user-only';

  await assertVectorizedReality(dbService, contextCode);

  const existingIds = await loadExistingConceptIds(dbService, contextCode);
  // Prompt avoid-list (small by default) — NOT the full concept dump
  const promptSeedList = buildPromptSeedList(seedConcepts, existingIds, seedMode);
  const promptSeedSet = new Set(promptSeedList);
  // Batch uniqueness only — reuse of existing domain ids (employee, department…) is allowed
  const usedIds = new Set();

  const allAnchors = await collectAnchors(dbService, contextCode, 120);
  const tableAnchors = await collectTableAnchors(dbService, contextCode);
  const anchorsBeforeExclude = allAnchors.length;
  let anchors = filterAnchorsByExcludePatterns(allAnchors, builderSettings.excludeNamePatterns);
  // Always re-include tables (even if filtered)
  {
    const kept = new Set(anchors.map((a) => a.full_name));
    for (const a of tableAnchors) {
      if (!kept.has(a.full_name)) anchors.push(a);
    }
    for (const a of allAnchors) {
      if (a.type === 'table' && !kept.has(a.full_name)) anchors.push(a);
    }
  }
  const anchorsByName = new Map(anchors.map((a) => [a.full_name, a]));

  return {
    builderSettings,
    maxConcepts,
    depth,
    aspectsFilter,
    seedConcepts,
    seedMode,
    promptSeedList,
    promptSeedSet,
    /** @deprecated use promptSeedSet — kept for older call sites */
    seedSet: promptSeedSet,
    existingIds,
    usedIds,
    anchors,
    tableAnchors,
    anchorsByName,
    anchorsBeforeExclude,
    contextCode
  };
}

/**
 * Build the same prompts that internal suggest would send to kosmos-model
 * (for BYO external LLM chat).
 */
function buildSuggestPromptPackage(ctx) {
  const {
    builderSettings,
    maxConcepts,
    promptSeedList,
    existingIds,
    anchors,
    tableAnchors,
    contextCode
  } = ctx;

  const anchorCap = Math.min(32, Math.max(16, maxConcepts * 3));
  const selected = selectAnchorsForPrompt(anchors, tableAnchors, anchorCap);
  const sample = formatAnchorsCompact(selected, anchorCap);

  const systemPrompt = String(builderSettings.systemPrompt || '').trim();
  const userTemplate = String(builderSettings.userPromptTemplate || '').trim();
  const outputRules = String(builderSettings.outputRulesSuffix || '').trim();
  const byoInstruction = String(builderSettings.byoInstruction || '').trim();

  const existingForPrompt = [...(existingIds || [])].sort().slice(0, 40);

  const userPrompt =
    renderPromptTemplate(userTemplate, {
      maxConcepts,
      contextCode,
      seedConcepts: promptSeedList || [],
      existingConcepts: existingForPrompt,
      anchors: sample
    }) + (outputRules ? `\n\n${outputRules}` : '');

  const combinedForChat =
    `### SYSTEM\n${systemPrompt}\n\n### USER\n${userPrompt}\n\n` +
    `### INSTRUCTION (for you in external chat)\n` +
    (byoInstruction || 'Paste ONLY the JSON object {"concepts":[...]} back into Ontology Builder.');

  return {
    systemPrompt,
    userPrompt,
    combinedForChat,
    modelHint: builderSettings.model || null,
    maxConcepts,
    anchorsInPrompt: sample.length,
    tablesInPrompt: sample.filter((a) => a.t === 'table').length,
    seedMode: ctx.seedMode,
    seedAvoidCount: (promptSeedList || []).length,
    existingConceptsListed: existingForPrompt.length,
    seedExcluded: (promptSeedList || []).length
  };
}

/**
 * Map raw LLM concept list → internal proposed list.
 * Allows reusing existing domain ids (refine). Only avoids explicit promptSeedSet
 * when options.strictSeedAvoid is true; default: allow reuse of existing ids.
 */
function mapLlmListToProposed(llmList, promptSeedSet, usedIds, options = {}) {
  const strictAvoid = options.strictSeedAvoid === true;
  const proposed = [];
  for (const raw of llmList || []) {
    let baseId = toKebabId(raw.id || raw.name);
    // Reject obvious anti-patterns from old models
    if (/(^|-)(ops|mutation|mutations|reporting|queries|core-service)(-|$)/i.test(baseId)) {
      // strip noisy suffixes toward domain noun
      baseId = baseId
        .replace(/-?(ops-service|service-core|mutations?|reporting|queries|ops)$/i, '')
        .replace(/^(ops|core)-/, '') || baseId;
      baseId = toKebabId(baseId);
    }
    if (strictAvoid && promptSeedSet && promptSeedSet.has(baseId)) continue;
    const id = uniqueKebab(baseId, usedIds);
    let anchorNames = Array.isArray(raw.anchorFullNames) ? raw.anchorFullNames : [];
    anchorNames = anchorNames.map((x) => (x && typeof x === 'object' && x.n ? x.n : x));
    const rels = Array.isArray(raw.relations)
      ? raw.relations
          .filter((r) => r && ALLOWED_RELATIONS.includes(r.type) && r.target)
          .map((r) => ({
            type: r.type,
            target: String(r.target).replace(/^concept:/, ''),
            comment: r.comment || ''
          }))
      : [];
    let aspects = Array.isArray(raw.aspects) && raw.aspects.length ? raw.aspects : ['domain'];
    // Prefer single primary aspect
    if (aspects.includes('domain') && aspects.includes('service') && aspects.length === 2) {
      aspects = ['domain'];
    }
    proposed.push({
      id,
      name: raw.name || id,
      rationale: raw.rationale || 'LLM proposal',
      aspects,
      relations: rels,
      anchorFullNames: anchorNames
    });
  }
  return proposed;
}

/**
 * Grounding + L1 lift + sanitize → final draft payload (same shape as suggest).
 */
async function finalizeSuggestDraft(dbService, ctx, proposed, source, modelUsed, extraMeta = {}) {
  const {
    builderSettings,
    maxConcepts,
    depth,
    aspectsFilter,
    anchorsByName,
    anchors,
    anchorsBeforeExclude,
    seedSet,
    contextCode
  } = ctx;

  let list = proposed;
  if (source === 'llm' && builderSettings.enableDescriptionPass) {
    list = await enrichConceptDescriptions(list, builderSettings, contextCode);
  }

  for (const c of list) {
    if (aspectsFilter && c.aspects && !c.aspects.some((a) => aspectsFilter.includes(a))) {
      c._skip = true;
      continue;
    }
    c.groundingCandidates = await buildGroundingCandidates(
      dbService,
      contextCode,
      c,
      anchorsByName,
      depth
    );
    c.relations = Array.isArray(c.relations)
      ? c.relations.filter((r) => ALLOWED_RELATIONS.includes(r.type))
      : [];
    delete c.anchorFullNames;
    delete c._anchors;
  }

  let concepts = list.filter((c) => !c._skip).slice(0, maxConcepts);
  await liftRelations(dbService, contextCode, concepts);

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
    model: modelUsed,
    settingsApplied: {
      maxConceptsDefault: builderSettings.maxConcepts,
      depthDefault: builderSettings.depth,
      enableDescriptionPass: !!builderSettings.enableDescriptionPass,
      excludeNamePatterns: builderSettings.excludeNamePatterns || []
    },
    suggestedAt: new Date().toISOString(),
    concepts,
    meta: {
      anchorsConsidered: anchors.length,
      anchorsBeforeExclude,
      seedMode: ctx.seedMode,
      seedAvoidCount: (ctx.promptSeedList || []).length,
      existingConcepts: ctx.existingIds ? ctx.existingIds.size : 0,
      seedExcluded: (ctx.promptSeedList || []).length,
      ...extraMeta
    }
  };
}

/**
 * Export prompts for external LLM (no model call).
 * POST /api/ontology/build/suggest/export-prompt
 */
async function exportSuggestPrompt(dbService, contextCode, options = {}) {
  const ctx = await prepareSuggestContext(dbService, contextCode, options);
  const pack = buildSuggestPromptPackage(ctx);
  return {
    contextCode,
    ...pack,
    howTo: [
      '1. Скопируйте combinedForChat (или system + user) во внешний чат с вашей LLM.',
      '2. Получите ответ — только JSON {"concepts":[...]} (можно в ```json блоке).',
      '3. В Ontology Builder нажмите «Вставить ответ LLM» и вставьте ответ.',
      '4. Импорт прогонит тот же grounding/relations, что и кнопка Suggest.'
    ],
    exportedAt: new Date().toISOString()
  };
}

/**
 * Import raw LLM text as if Suggest succeeded.
 * POST /api/ontology/build/suggest/import
 * body: { text: string, maxConcepts?, depth?, seedConcepts?, aspects? }
 */
async function importSuggestFromLlmText(dbService, contextCode, options = {}) {
  const text = options.text || options.llmResponse || options.response || '';
  if (!text || !String(text).trim()) {
    const err = new Error('Пустой ответ LLM. Вставьте JSON {"concepts":[...]}');
    err.status = 400;
    err.code = 'EMPTY_LLM_RESPONSE';
    err.userFacing = true;
    throw err;
  }

  const ctx = await prepareSuggestContext(dbService, contextCode, options);
  let parsed;
  try {
    parsed = parseLlmConceptsResponse(text);
  } catch (e) {
    throw makeLlmRequiredError('ontology suggest import', e);
  }

  const llmList = Array.isArray(parsed.concepts) ? parsed.concepts : [];
  if (llmList.length === 0) {
    throw makeLlmRequiredError(
      'ontology suggest import',
      new Error('В ответе нет concepts — нужен JSON {"concepts":[...]}')
    );
  }

  const proposed = mapLlmListToProposed(llmList, ctx.promptSeedSet, ctx.usedIds, {
    strictSeedAvoid: false
  });
  if (proposed.length === 0) {
    throw makeLlmRequiredError(
      'ontology suggest import',
      new Error('Не удалось разобрать concepts из JSON (пустой список после нормализации ids).')
    );
  }

  // External chat already produced full answer — skip second description pass unless asked
  const ctxImport = {
    ...ctx,
    builderSettings: {
      ...ctx.builderSettings,
      enableDescriptionPass: options.runDescriptionPass === true
    }
  };

  return finalizeSuggestDraft(dbService, ctxImport, proposed, 'external-llm', null, {
    importedConceptsRaw: llmList.length,
    importedConceptsAccepted: proposed.length
  });
}

/**
 * POST suggest — read-only draft (internal kosmos-model LLM).
 */
async function suggestOntology(dbService, contextCode, options = {}) {
  const ctx = await prepareSuggestContext(dbService, contextCode, options);
  const modelUsed = ctx.builderSettings.model || null;

  let llmList;
  try {
    llmList = await llmProposeConcepts(
      ctx.anchors,
      ctx.maxConcepts,
      ctx.promptSeedList,
      contextCode,
      ctx.builderSettings,
      {
        tableAnchors: ctx.tableAnchors,
        existingConcepts: [...(ctx.existingIds || [])]
      }
    );
  } catch (e) {
    if (e.code === 'LLM_REQUIRED' || e.code === 'LLM_BAD_JSON') {
      throw makeLlmRequiredError('ontology suggest', e);
    }
    throw makeLlmRequiredError('ontology suggest', e);
  }

  if (!Array.isArray(llmList) || llmList.length === 0) {
    throw makeLlmRequiredError(
      'ontology suggest',
      new Error('LLM вернул пустой список concepts — черновик не создан')
    );
  }

  const proposed = mapLlmListToProposed(llmList, ctx.promptSeedSet, ctx.usedIds, {
    strictSeedAvoid: false
  });
  if (proposed.length === 0) {
    throw makeLlmRequiredError(
      'ontology suggest',
      new Error('Не удалось нормализовать concepts из ответа LLM.')
    );
  }

  return finalizeSuggestDraft(dbService, ctx, proposed, 'llm', modelUsed);
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

/**
 * Clear ontology for a context: concept ai_items, onto_* links, concept chunks, optional MD files.
 * Does NOT touch non-concept reality (functions, tables, etc.).
 *
 * @param {object} dbService
 * @param {string} contextCode
 * @param {object} [options]
 * @param {boolean} [options.confirm=false] — must be true
 * @param {boolean} [options.deleteDb=true]
 * @param {boolean} [options.deleteFiles=true] — *.md in onto_loading.dirs
 * @param {boolean} [options.dryRun=false]
 */
async function clearOntologyForContext(dbService, contextCode, options = {}) {
  if (!options.confirm) {
    const err = new Error(
      'Для очистки онтологии передайте { "confirm": true }. ' +
        'Опции: deleteDb (default true), deleteFiles (default true), dryRun.'
    );
    err.status = 400;
    err.code = 'CONFIRM_REQUIRED';
    err.userFacing = true;
    throw err;
  }

  const deleteDb = options.deleteDb !== false;
  const deleteFiles = options.deleteFiles !== false;
  const dryRun = !!options.dryRun;
  const client = dbService.pgClient;
  const q = async (sql, params) => (await client.query(sql, params)).rows;

  const report = {
    contextCode,
    dryRun,
    deleteDb,
    deleteFiles,
    conceptsFound: 0,
    conceptIds: [],
    linksDeleted: 0,
    chunksDeleted: 0,
    aiItemsDeleted: 0,
    filesDeletedDb: 0,
    mdFilesDeleted: [],
    mdFilesSkipped: [],
    dirs: [],
    warnings: []
  };

  // --- DB: concept items ---
  const concepts = await q(
    `SELECT id, full_name, file_id FROM kosmos.ai_item
     WHERE context_code = $1 AND type = 'concept'
     ORDER BY full_name`,
    [contextCode]
  );
  report.conceptsFound = concepts.length;
  report.conceptIds = concepts.map((c) => c.full_name);
  const conceptPkIds = concepts.map((c) => c.id);
  const fileIds = [...new Set(concepts.map((c) => c.file_id).filter(Boolean))];

  if (deleteDb) {
    // onto_* links + any link touching concept:* for this context
    const linkCountSql = dryRun
      ? `SELECT count(*)::int AS n FROM kosmos.link l
         JOIN kosmos.link_type lt ON lt.id = l.link_type_id
         WHERE l.context_code = $1
           AND (lt.code LIKE 'onto_%' OR l.source LIKE 'concept:%' OR l.target LIKE 'concept:%')`
      : null;

    if (dryRun) {
      const lr = await q(linkCountSql, [contextCode]);
      report.linksDeleted = lr[0]?.n || 0;
      if (conceptPkIds.length) {
        const cr = await q(
          `SELECT count(*)::int AS n FROM kosmos.chunk_vector WHERE ai_item_id = ANY($1)`,
          [conceptPkIds]
        );
        report.chunksDeleted = cr[0]?.n || 0;
      }
      report.aiItemsDeleted = concepts.length;
      report.filesDeletedDb = fileIds.length;
    } else {
      const delLinks = await client.query(
        `DELETE FROM kosmos.link l
         USING kosmos.link_type lt
         WHERE l.link_type_id = lt.id
           AND l.context_code = $1
           AND (lt.code LIKE 'onto_%' OR l.source LIKE 'concept:%' OR l.target LIKE 'concept:%')`,
        [contextCode]
      );
      report.linksDeleted = delLinks.rowCount || 0;

      if (conceptPkIds.length) {
        const delChunks = await client.query(
          `DELETE FROM kosmos.chunk_vector WHERE ai_item_id = ANY($1)`,
          [conceptPkIds]
        );
        report.chunksDeleted = delChunks.rowCount || 0;

        const delItems = await client.query(
          `DELETE FROM kosmos.ai_item WHERE context_code = $1 AND type = 'concept'`,
          [contextCode]
        );
        report.aiItemsDeleted = delItems.rowCount || 0;
      }

      // Remove concept source files from kosmos.files if orphaned (only used by concepts)
      if (fileIds.length) {
        const delFiles = await client.query(
          `DELETE FROM kosmos.files f
           WHERE f.id = ANY($1)
             AND f.context_code = $2
             AND NOT EXISTS (SELECT 1 FROM kosmos.ai_item ai WHERE ai.file_id = f.id)
             AND NOT EXISTS (SELECT 1 FROM kosmos.chunk_vector cv WHERE cv.file_id = f.id)`,
          [fileIds, contextCode]
        );
        report.filesDeletedDb = delFiles.rowCount || 0;
      }
    }
  }

  // --- Files on disk ---
  if (deleteFiles) {
    let dirs = [];
    try {
      const resolved = await getOntoDirs(contextCode, {
        createIfMissing: false,
        persistConfig: false
      });
      dirs = resolved.dirs || [];
    } catch (e) {
      report.warnings.push(`onto dirs: ${e.message}`);
    }
    report.dirs = dirs;

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        report.warnings.push(`dir missing: ${dir}`);
        continue;
      }
      const mdFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
      for (const f of mdFiles) {
        const fp = path.join(dir, f);
        // Only delete files that look like concept MD (frontmatter type: concept) when possible
        let isConcept = true;
        try {
          const head = fs.readFileSync(fp, 'utf8').slice(0, 800);
          if (head.includes('type:') && !/type:\s*concept/.test(head)) {
            isConcept = false;
          }
        } catch {
          /* delete anyway if unreadable? skip */
          isConcept = true;
        }
        if (!isConcept) {
          report.mdFilesSkipped.push(fp);
          continue;
        }
        if (dryRun) {
          report.mdFilesDeleted.push(fp);
        } else {
          try {
            fs.unlinkSync(fp);
            report.mdFilesDeleted.push(fp);
          } catch (e) {
            report.warnings.push(`delete ${fp}: ${e.message}`);
          }
        }
      }
    }
  }

  report.clearedAt = new Date().toISOString();
  report.success = true;
  console.log(
    `[Ontology-Clear] ${contextCode} dryRun=${dryRun}: concepts=${report.aiItemsDeleted}, ` +
      `links=${report.linksDeleted}, md=${report.mdFilesDeleted.length}`
  );
  return report;
}

module.exports = {
  assertVectorizedReality,
  suggestOntology,
  materializeConcepts,
  serializeConceptToMd,
  applyOntologyBuild,
  getBuilderStatus,
  clearOntologyForContext,
  getOntoDirs,
  checkOntoLoadingConfig,
  parseOntoLoading,
  defaultConceptsDir,
  makeOntoLoadingNotConfiguredError,
  makeLlmRequiredError,
  getOntologyBuilderSettings,
  parseLlmConceptsResponse,
  extractCompleteConceptsFromPartialJson,
  exportSuggestPrompt,
  importSuggestFromLlmText,
  prepareSuggestContext,
  runValidateReport,
  toKebabId
};
