// Шаг 4 pipeline: массовая векторизация невекторизованных чанков контекста
// routes/pipeline/step4Vectorize.js

const { createStepLogger } = require('./stepLogger');

/**
 * Массовая векторизация. По умолчанию — только L0-чанки (уровень '0-...'),
 * batchSize текстов на один вызов embeddings.embedDocuments.
 *
 * @param {string} contextCode
 * @param {string} sessionId
 * @param {DbService} dbService
 * @param {object} embeddings - экземпляр из EmbeddingsFactory
 * @param {PipelineStateManager} pipelineState
 * @param {PipelineHistoryManager} pipelineHistory
 * @param {object} options - { batchSize=50, allLevels=false, force=false }
 */
async function runStep4(contextCode, sessionId, dbService, embeddings, pipelineState, pipelineHistory = null, options = {}) {
  const logger = createStepLogger('[Step4]', sessionId);
  const batchSize = Math.max(1, Math.min(200, options.batchSize || 50));
  const levelPattern = options.allLevels ? '%' : '0-%';
  const embeddingFilter = options.force ? '' : 'AND cv.embedding IS NULL';

  logger.log(`Массовая векторизация: контекст ${contextCode}, level LIKE '${levelPattern}', force=${!!options.force}`);

  const idRows = (await dbService.pgClient.query(
    `SELECT cv.id
     FROM kosmos.chunk_vector cv JOIN kosmos.files f ON f.id = cv.file_id
     WHERE f.context_code = $1 ${embeddingFilter} AND cv.level LIKE $2
     ORDER BY cv.created_at`,
    [contextCode, levelPattern]
  )).rows;
  const ids = idRows.map(r => r.id);

  pipelineState.updateStep(4, { totalItems: ids.length, itemsProcessed: 0, progress: 0 });
  logger.log(`Чанков к векторизации: ${ids.length}`);

  const report = { totalChunks: ids.length, vectorized: 0, skippedEmpty: 0, batchErrors: 0 };
  let consecutiveErrors = 0;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batchIds = ids.slice(i, i + batchSize);
    const chunks = (await dbService.pgClient.query(
      `SELECT id, coalesce(chunk_content->>'text', chunk_content #>> '{}') AS text
       FROM kosmos.chunk_vector WHERE id = ANY($1)`,
      [batchIds]
    )).rows;

    const valid = chunks.filter(c => c.text && c.text.trim() !== '');
    report.skippedEmpty += chunks.length - valid.length;

    if (valid.length > 0) {
      try {
        // ~8192 токенов лимит на один вход; для кода ~3 симв./токен => безопасно ~20000 символов
        const vectors = await embeddings.embedDocuments(valid.map(c => c.text.slice(0, 20000)));
        for (let j = 0; j < valid.length; j++) {
          await dbService.updateChunkEmbedding(valid[j].id, vectors[j]);
          report.vectorized++;
        }
        consecutiveErrors = 0;
      } catch (e) {
        if (String(e.message).includes('maximum context length')) {
          // В батче есть слишком длинный текст — пересчитываем поштучно с жёсткой обрезкой
          logger.warn(`Батч ${i}..${i + batchIds.length}: превышение контекста, пересчёт поштучно`);
          for (const c of valid) {
            try {
              let vec;
              try {
                [vec] = await embeddings.embedDocuments([c.text.slice(0, 20000)]);
              } catch (inner) {
                if (!String(inner.message).includes('maximum context length')) throw inner;
                [vec] = await embeddings.embedDocuments([c.text.slice(0, 8000)]);
                report.truncatedHard = (report.truncatedHard || 0) + 1;
              }
              await dbService.updateChunkEmbedding(c.id, vec);
              report.vectorized++;
            } catch (inner) {
              report.batchErrors++;
              logger.error(`Чанк ${c.id}: ${inner.message}`);
            }
          }
          consecutiveErrors = 0;
        } else {
          report.batchErrors++;
          consecutiveErrors++;
          logger.error(`Батч ${i}..${i + batchIds.length}: ${e.message}`);
          if (consecutiveErrors >= 3) {
            throw new Error(`Прервано после 3 ошибок подряд (последняя: ${e.message}). Векторизовано ${report.vectorized}/${ids.length}.`);
          }
        }
      }
    }

    const processed = Math.min(i + batchSize, ids.length);
    pipelineState.updateStep(4, {
      itemsProcessed: processed,
      progress: ids.length > 0 ? Math.round((processed / ids.length) * 100) : 100
    });
    if (pipelineHistory && (processed % (batchSize * 10) === 0)) {
      pipelineHistory.addHistoryEntry(contextCode, 4, pipelineState.getStep(4));
    }
  }

  logger.log(`Шаг 4 завершён: векторизовано ${report.vectorized}, пустых ${report.skippedEmpty}, ошибок батчей ${report.batchErrors}`);
  report.logs = logger.getLogs();

  pipelineState.updateStep(4, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    progress: 100,
    report
  });
  if (pipelineHistory) {
    pipelineHistory.addHistoryEntry(contextCode, 4, pipelineState.getStep(4));
  }

  return report;
}

module.exports = { runStep4 };
