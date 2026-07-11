// Онтология: валидация консистентности и актуальности
// GET /api/ontology/validate?context-code=XXX[&dir=путь_к_папке_понятий]
// См. Ontology/ONTOLOGY_PLAN.md (Этап 3) и KB/README_ONTO_LOADING.md

const express = require('express');
const fs = require('fs');
const path = require('path');
const { parseConceptFile, validateOntology } = require('./loaders/ontoLoader');
const { callLLM } = require('../packages/core/llmClient');
const ontologyBuilder = require('./ontology/ontologyBuilder');
const pipelineStateManager = require('./pipelineState');

const GROUNDING_CODES = ['onto_implemented_in', 'onto_stored_in', 'onto_documented_in', 'onto_configured_in'];
const RELATION_CODES = [
  'onto_part_of', 'onto_has_part', 'onto_uses', 'onto_used_by', 'onto_manages', 'onto_managed_by',
  'onto_produces', 'onto_produced_by', 'onto_consumes', 'onto_consumed_by',
  'onto_precedes', 'onto_follows', 'onto_related_to'
];

module.exports = (dbService, embeddings) => {
  const router = express.Router();

  router.get('/validate', async (req, res) => {
    const contextCode = req.query['context-code'] || req.query.contextCode;
    const dir = req.query.dir || null;
    if (!contextCode) {
      return res.status(400).json({ error: 'Обязателен параметр context-code' });
    }

    const q = async (sql, params) => (await dbService.pgClient.query(sql, params)).rows;
    const report = {
      contextCode,
      checkedAt: new Date().toISOString(),
      summary: {},
      details: {}
    };

    try {
      // --- 1. Битый grounding: цель не резолвится ни в один ai_item ---
      report.details.brokenGrounding = await q(
        `SELECT lt.code AS role, l.source AS concept, l.target
         FROM kosmos.link l JOIN kosmos.link_type lt ON lt.id = l.link_type_id
         WHERE l.context_code = $1 AND lt.code = ANY($2)
           AND NOT EXISTS (SELECT 1 FROM kosmos.ai_item ai
                           WHERE ai.full_name = l.target OR ai.full_name LIKE l.target || '#%')
         ORDER BY l.source, l.target`,
        [contextCode, GROUNDING_CODES]
      );

      // --- 2. Протухший grounding: у цели needs_rebuild = true ---
      report.details.staleGrounding = await q(
        `SELECT l.source AS concept, l.target, lt.code AS role,
                count(DISTINCT ai.full_name)::int AS stale_items,
                min(ai.full_name) AS example_item
         FROM kosmos.link l
         JOIN kosmos.link_type lt ON lt.id = l.link_type_id
         JOIN kosmos.ai_item ai ON ai.context_code = l.context_code
           AND (ai.full_name = l.target OR ai.full_name LIKE l.target || '#%')
         WHERE l.context_code = $1 AND lt.code = ANY($2) AND ai.needs_rebuild = true
         GROUP BY l.source, l.target, lt.code
         ORDER BY l.source, l.target`,
        [contextCode, GROUNDING_CODES]
      );

      // --- 3. Понятия без grounding (гипотезы) ---
      report.details.conceptsWithoutGrounding = (await q(
        `SELECT c.full_name FROM kosmos.ai_item c
         WHERE c.type = 'concept' AND c.context_code = $1
           AND NOT EXISTS (SELECT 1 FROM kosmos.link l JOIN kosmos.link_type lt ON lt.id = l.link_type_id
                           WHERE l.source = c.full_name AND l.context_code = $1 AND lt.code = ANY($2))
         ORDER BY 1`,
        [contextCode, GROUNDING_CODES]
      )).map(r => r.full_name);

      // --- 4. Висячие отношения: concept:* цель без ai_item ---
      report.details.danglingRelations = await q(
        `SELECT lt.code AS relation, l.source, l.target
         FROM kosmos.link l JOIN kosmos.link_type lt ON lt.id = l.link_type_id
         WHERE l.context_code = $1 AND lt.code = ANY($2) AND l.target LIKE 'concept:%'
           AND NOT EXISTS (SELECT 1 FROM kosmos.ai_item ai
                           WHERE ai.full_name = l.target AND ai.context_code = $1)
         ORDER BY l.source`,
        [contextCode, RELATION_CODES]
      );

      // --- 5. Coverage: значимые items, не покрытые понятиями ---
      report.details.coverageByType = await q(
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

      // Примеры непокрытых крупных items (по числу чанков)
      report.details.uncoveredSamples = await q(
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

      // --- 6. Файловая валидация (если передан dir) ---
      if (dir) {
        const fileValidation = { dir, errors: [], warnings: [] };
        try {
          const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
          const concepts = [];
          for (const f of files) {
            const parsed = parseConceptFile(fs.readFileSync(path.join(dir, f), 'utf8'), f);
            fileValidation.errors.push(...parsed.errors);
            fileValidation.warnings.push(...parsed.warnings);
            if (parsed.concept) concepts.push(parsed.concept);
          }
          const v = validateOntology(concepts);
          fileValidation.errors.push(...v.errors);
          fileValidation.warnings.push(...v.warnings);
          fileValidation.filesFound = files.length;
          fileValidation.conceptsParsed = concepts.length;
        } catch (e) {
          fileValidation.errors.push(`Не удалось прочитать директорию ${dir}: ${e.message}`);
        }
        report.details.fileValidation = fileValidation;
      }

      // --- Сводка ---
      report.summary = {
        brokenGrounding: report.details.brokenGrounding.length,
        staleGroundingTargets: report.details.staleGrounding.length,
        staleConcepts: [...new Set(report.details.staleGrounding.map(r => r.concept))].length,
        conceptsWithoutGrounding: report.details.conceptsWithoutGrounding.length,
        danglingRelations: report.details.danglingRelations.length,
        coverage: report.details.coverageByType.map(r => `${r.type}: ${r.covered}/${r.total}`).join(', '),
        fileErrors: report.details.fileValidation ? report.details.fileValidation.errors.length : null,
        ok: report.details.brokenGrounding.length === 0
          && report.details.danglingRelations.length === 0
          && (!report.details.fileValidation || report.details.fileValidation.errors.length === 0)
      };

      res.json(report);
    } catch (err) {
      console.error('[Ontology-Validate] Ошибка:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // === Concept-first retrieval ===
  // POST /api/ontology/ask?context-code=XXX
  // body: { question, maxConcepts=3, maxChunks=8, generateAnswer=true }
  router.post('/ask', async (req, res) => {
    const contextCode = req.query['context-code'] || req.query.contextCode;
    const { question, maxConcepts = 3, maxChunks = 8, generateAnswer = true } = req.body || {};
    if (!contextCode) return res.status(400).json({ error: 'Обязателен параметр context-code' });
    if (!question || typeof question !== 'string') return res.status(400).json({ error: 'Обязательно поле question' });
    if (!embeddings) return res.status(500).json({ error: 'Embeddings не сконфигурированы' });

    const q = async (sql, params) => (await dbService.pgClient.query(sql, params)).rows;

    try {
      // --- 1. Вопрос -> ближайшие понятия ---
      const queryVector = await embeddings.embedQuery(question);
      const vecLiteral = `[${queryVector.join(',')}]`;

      const concepts = await q(
        `SELECT ai.full_name, ai.h_name AS name,
                round((1 - (cv.embedding <=> $1::vector))::numeric, 4)::float AS similarity
         FROM kosmos.chunk_vector cv
         JOIN kosmos.ai_item ai ON ai.id = cv.ai_item_id
         WHERE cv.type = 'concept' AND ai.context_code = $2 AND cv.embedding IS NOT NULL
         ORDER BY cv.embedding <=> $1::vector
         LIMIT $3`,
        [vecLiteral, contextCode, maxConcepts]
      );

      if (concepts.length === 0) {
        return res.json({ question, contextCode, concepts: [], chain: [], chunks: [],
          note: 'Понятия не найдены: онтология не загружена или не векторизована' });
      }
      const conceptNames = concepts.map(c => c.full_name);

      // --- 2. Отношения и grounding найденных понятий ---
      const chain = await q(
        `SELECT l.source, lt.code AS relation, l.target
         FROM kosmos.link l JOIN kosmos.link_type lt ON lt.id = l.link_type_id
         WHERE l.context_code = $1 AND lt.code LIKE 'onto_%' AND l.source = ANY($2)
         ORDER BY l.source, lt.code, l.target`,
        [contextCode, conceptNames]
      );

      // --- 3. Grounding-цели -> реальные items -> их L0-чанки, ранжированные по вопросу ---
      const chunks = await q(
        `WITH grounded AS (
           SELECT DISTINCT ai.id AS ai_item_id, ai.full_name AS item_name, l.source AS concept, lt.code AS role
           FROM kosmos.link l
           JOIN kosmos.link_type lt ON lt.id = l.link_type_id
           JOIN kosmos.ai_item ai ON ai.context_code = l.context_code
             AND (ai.full_name = l.target OR ai.full_name LIKE l.target || '#%')
           WHERE l.context_code = $1 AND l.source = ANY($2)
             AND lt.code IN ('onto_implemented_in','onto_stored_in','onto_documented_in','onto_configured_in')
         )
         SELECT g.concept, g.role, g.item_name, cv.full_name AS chunk_name,
                left(coalesce(cv.chunk_content->>'text', cv.chunk_content #>> '{}'), 2500) AS content,
                CASE WHEN cv.embedding IS NULL THEN null
                     ELSE round((1 - (cv.embedding <=> $3::vector))::numeric, 4)::float END AS similarity
         FROM grounded g
         JOIN kosmos.chunk_vector cv ON cv.ai_item_id = g.ai_item_id
         WHERE cv.level LIKE '0-%'
         ORDER BY (cv.embedding IS NULL), cv.embedding <=> $3::vector
         LIMIT $4`,
        [contextCode, conceptNames, vecLiteral, maxChunks]
      );

      // --- 4. Сборка контекста ---
      const conceptDescriptions = await q(
        `SELECT ai.full_name, coalesce(cv.chunk_content->>'text', cv.chunk_content #>> '{}', '') AS text
         FROM kosmos.ai_item ai JOIN kosmos.chunk_vector cv ON cv.ai_item_id = ai.id
         WHERE ai.full_name = ANY($1) AND ai.context_code = $2 AND cv.type = 'concept'`,
        [conceptNames, contextCode]
      );

      const chainText = chain
        .map(r => `${r.source} —${r.relation.replace('onto_', '')}→ ${r.target}`)
        .join('\n');
      const contextText = [
        '=== ПОНЯТИЯ ОНТОЛОГИИ (верхний уровень) ===',
        ...conceptDescriptions.map(c => `--- ${c.full_name} ---\n${c.text}`),
        '=== СВЯЗИ ===',
        chainText,
        '=== РЕАЛЬНОСТЬ (код, таблицы, документы нижнего уровня) ===',
        ...chunks.map(c => `--- ${c.chunk_name} (grounding: ${c.concept} ${c.role.replace('onto_', '')}) ---\n${c.content}`)
      ].join('\n\n');

      const result = { question, contextCode, concepts, chain, chunks: chunks.map(c => ({
        concept: c.concept, role: c.role.replace('onto_', ''), item: c.item_name,
        chunk: c.chunk_name, similarity: c.similarity
      })) };

      // --- 5. Генерация ответа (опционально) ---
      // Без ИИ жизни нет: если ответ запрошен — LLM error = hard stop, не soft answerError
      if (generateAnswer) {
        try {
          result.answer = await callLLM([
            { role: 'system', content: 'Ты отвечаешь на вопросы о программной системе. Используй сначала ПОНЯТИЯ онтологии (верхний уровень), затем подтверждай деталями из РЕАЛЬНОСТИ (код/таблицы/документы). В конце ответа укажи цепочку: понятие → отношение → элемент кода. Отвечай на русском.' },
            { role: 'user', content: `Контекст:\n${contextText}\n\nВопрос: ${question}` }
          ]);
        } catch (e) {
          const err = new Error(
            `LLM недоступен: ${e.message}. «Без ИИ жизни нет!» — ответ не сформирован. ` +
              `Проверьте kosmos-model / KOSMOS_BASE_URL / KOSMOS_MODEL.`
          );
          err.status = 503;
          err.code = 'LLM_REQUIRED';
          err.userFacing = true;
          throw err;
        }
      } else {
        result.contextText = contextText;
      }

      res.json(result);
    } catch (err) {
      const status = err.status || 500;
      if (err.userFacing || err.code === 'LLM_REQUIRED') {
        console.warn(`[Ontology-Ask] ${err.code || status}: ${String(err.message).split('\n')[0]}`);
        return res.status(status).json({ error: err.message, code: err.code || 'LLM_REQUIRED' });
      }
      console.error('[Ontology-Ask] Ошибка:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // === Ontology Builder (Step 6) ===
  const sendSuggestError = (res, err, logTag) => {
    const status =
      err.status ||
      (err.code === 'STEP4_REQUIRED'
        ? 409
        : err.code === 'EMPTY_LLM_RESPONSE'
          ? 400
          : err.code === 'LLM_REQUIRED' || err.code === 'LLM_BAD_JSON'
            ? err.code === 'LLM_BAD_JSON'
              ? 502
              : 503
            : 500);
    if (
      err.userFacing ||
      err.code === 'LLM_REQUIRED' ||
      err.code === 'LLM_BAD_JSON' ||
      err.code === 'STEP4_REQUIRED' ||
      err.code === 'EMPTY_LLM_RESPONSE'
    ) {
      console.warn(`[${logTag}] ${err.code || status}: ${String(err.message).split('\n')[0]}`);
      return res.status(status).json({ error: err.message, code: err.code || undefined });
    }
    console.error(`[${logTag}] Ошибка:`, err);
    return res.status(status).json({ error: err.message, code: err.code || undefined });
  };

  // POST /api/ontology/build/suggest — read-only draft from vectorized reality (internal LLM)
  router.post('/build/suggest', async (req, res) => {
    const contextCode = req.query['context-code'] || req.query.contextCode;
    if (!contextCode) return res.status(400).json({ error: 'Обязателен параметр context-code' });
    try {
      const draft = await ontologyBuilder.suggestOntology(dbService, contextCode, req.body || {});
      res.json(draft);
    } catch (err) {
      sendSuggestError(res, err, 'Ontology-Build-Suggest');
    }
  });

  // POST /api/ontology/build/suggest/export-prompt — same prompts as suggest, no LLM call
  router.post('/build/suggest/export-prompt', async (req, res) => {
    const contextCode = req.query['context-code'] || req.query.contextCode;
    if (!contextCode) return res.status(400).json({ error: 'Обязателен параметр context-code' });
    try {
      const pack = await ontologyBuilder.exportSuggestPrompt(
        dbService,
        contextCode,
        req.body || {}
      );
      res.json(pack);
    } catch (err) {
      sendSuggestError(res, err, 'Ontology-Build-ExportPrompt');
    }
  });

  // POST /api/ontology/build/suggest/import — paste external LLM JSON as if Suggest ran
  router.post('/build/suggest/import', async (req, res) => {
    const contextCode = req.query['context-code'] || req.query.contextCode;
    if (!contextCode) return res.status(400).json({ error: 'Обязателен параметр context-code' });
    try {
      const draft = await ontologyBuilder.importSuggestFromLlmText(
        dbService,
        contextCode,
        req.body || {}
      );
      res.json(draft);
    } catch (err) {
      sendSuggestError(res, err, 'Ontology-Build-Import');
    }
  });

  // POST /api/ontology/clear — wipe ontology for context (concepts + onto links + optional MD)
  // body: { confirm: true, deleteDb?: true, deleteFiles?: true, dryRun?: false }
  router.post('/clear', async (req, res) => {
    const contextCode = req.query['context-code'] || req.query.contextCode;
    if (!contextCode) return res.status(400).json({ error: 'Обязателен параметр context-code' });
    try {
      const report = await ontologyBuilder.clearOntologyForContext(
        dbService,
        contextCode,
        req.body || {}
      );
      res.json(report);
    } catch (err) {
      const status = err.status || 500;
      if (err.userFacing || err.code === 'CONFIRM_REQUIRED') {
        console.warn(`[Ontology-Clear] ${err.code || status}: ${err.message}`);
        return res.status(status).json({ error: err.message, code: err.code });
      }
      console.error('[Ontology-Clear] Ошибка:', err);
      res.status(status).json({ error: err.message, code: err.code });
    }
  });

  // POST /api/ontology/build/materialize — write concepts/*.md
  router.post('/build/materialize', async (req, res) => {
    const contextCode = req.query['context-code'] || req.query.contextCode;
    if (!contextCode) return res.status(400).json({ error: 'Обязателен параметр context-code' });
    const { concepts, overwrite, dryRun, dirs, outDir } = req.body || {};
    if (!Array.isArray(concepts) || concepts.length === 0) {
      return res.status(400).json({ error: 'Обязательно поле concepts: ConceptCandidate[]' });
    }
    try {
      const result = await ontologyBuilder.materializeConcepts(contextCode, concepts, {
        overwrite: !!overwrite,
        dryRun: !!dryRun,
        dirs,
        outDir
      });
      if (result.conflicts?.length && result.written.length === 0 && !dryRun) {
        return res.status(409).json({
          error: 'Конфликт id: файлы уже существуют',
          conflicts: result.conflicts,
          ...result
        });
      }
      res.json(result);
    } catch (err) {
      const status = err.status || 500;
      // Config / expected conflicts: user-facing, no stack spam
      if (
        err.userFacing ||
        err.code === 'ONTO_LOADING_NOT_CONFIGURED' ||
        err.code === 'CONCEPT_FILES_EXIST' ||
        err.code === 'MATERIALIZE_CONFLICT' ||
        status === 409
      ) {
        console.warn(
          `[Ontology-Build-Materialize] ${err.code || status}: ${String(err.message).split('\n')[0]}`
        );
        return res.status(status).json({
          error: err.message,
          code: err.code,
          conflicts: err.conflicts,
          outDir: err.outDir,
          hint: err.hint || undefined
        });
      }
      console.error('[Ontology-Build-Materialize] Ошибка:', err);
      res.status(status).json({
        error: err.message,
        conflicts: err.conflicts,
        code: err.code
      });
    }
  });

  // POST /api/ontology/build/apply — materialize → onto_loading → vectorize concept:* → validate
  router.post('/build/apply', async (req, res) => {
    const contextCode = req.query['context-code'] || req.query.contextCode;
    if (!contextCode) return res.status(400).json({ error: 'Обязателен параметр context-code' });
    try {
      const result = await ontologyBuilder.applyOntologyBuild(
        dbService,
        embeddings,
        contextCode,
        req.body || {},
        pipelineStateManager
      );
      if (!result.success) {
        return res.status(422).json(result);
      }
      res.json(result);
    } catch (err) {
      const status = err.status || err.applyResult?.httpStatus || 500;
      if (
        err.userFacing ||
        err.code === 'ONTO_LOADING_NOT_CONFIGURED' ||
        err.code === 'CONCEPT_FILES_EXIST' ||
        err.code === 'MATERIALIZE_CONFLICT' ||
        status === 409
      ) {
        console.warn(`[Ontology-Build-Apply] ${err.code || status}: ${String(err.message).split('\n')[0]}`);
        return res.status(status).json({
          error: err.message,
          code: err.code,
          conflicts: err.conflicts,
          hint: err.hint || undefined,
          success: false,
          ...(err.applyResult || {})
        });
      }
      console.error('[Ontology-Build-Apply] Ошибка:', err);
      res.status(status).json(err.applyResult || { error: err.message, code: err.code });
    }
  });

  // GET /api/ontology/build/status — snapshot for Step 6 card
  router.get('/build/status', async (req, res) => {
    const contextCode = req.query['context-code'] || req.query.contextCode;
    if (!contextCode) return res.status(400).json({ error: 'Обязателен параметр context-code' });
    try {
      const status = await ontologyBuilder.getBuilderStatus(dbService, contextCode);
      res.json(status);
    } catch (err) {
      console.error('[Ontology-Build-Status] Ошибка:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
