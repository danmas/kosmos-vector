// routes/pipeline/step2Runner.js
// Реализация Шага 2: Проверка и авто-исправление L1 зависимостей (аналог --fix-l1)

const dbService = require('../../packages/core/dbService'); // для JSDoc, реально передается в аргументах
const { createStepLogger } = require('./stepLogger');

/**
 * Запуск шага 2 pipeline: Анализ и исправление зависимостей
 *
 * @param {string} contextCode
 * @param {string} sessionId - Уникальный ID сессии для привязки логов
 * @param {DbService} dbService
 * @param {PipelineStateManager} pipelineState
 * @param {PipelineHistoryManager} pipelineHistory
 */
async function runStep2(contextCode, sessionId, dbService, pipelineState, pipelineHistory = null) {
    // Создаём логгер для сбора логов с sessionId
    const logger = createStepLogger('[Step2]', sessionId);
    
    logger.log(`Запуск анализа и исправления зависимостей для контекста "${contextCode}"`);

    // Обновляем статус
    pipelineState.updateStep(2, {
        status: 'running',
        startedAt: new Date().toISOString(),
        progress: 0,
        itemsProcessed: 0,
        totalItems: 0
    });

    const report = {
        summary: {
            aiItemsNoSchema: 0,
            l0ChunksNoSchema: 0,
            l1ChunksAnalyzed: 0,
            missingDeps: 0,
            ambiguousDeps: 0,
            fixedDeps: 0
        },
        details: {
            fixes: [],
            ambiguous: [],
            missing: [],
            errors: []
        }
    };

    try {
        const client = dbService.pgClient;

        // 1. Проверка целостности AiItem (full_name без схемы)
        // Это просто проверка, исправлять тут сложно без контекста, просто логируем
        const aiItemsNoSchema = await client.query(`
      SELECT ai.id, ai.full_name, f.filename
      FROM public.ai_item ai
      LEFT JOIN public.files f ON ai.file_id = f.id
      WHERE ai.context_code = $1
        AND (ai.full_name IS NULL OR ai.full_name = '' OR ai.full_name NOT LIKE '%.%')
    `, [contextCode]);

        report.summary.aiItemsNoSchema = aiItemsNoSchema.rows.length;
        if (aiItemsNoSchema.rows.length > 0) {
            logger.warn(`Найдено ${aiItemsNoSchema.rows.length} AiItem без схемы`);
        }

        // 2. Проверка чанков L0 без схемы
        const chunksL0NoSchema = await client.query(`
      SELECT fv.id
      FROM public.file_vectors fv
      JOIN public.files f ON fv.file_id = f.id
      WHERE f.context_code = $1
        AND fv.level LIKE '0%'
        AND fv.full_name IS NOT NULL AND fv.full_name != ''
        AND fv.full_name NOT LIKE '%.%'
    `, [contextCode]);

        report.summary.l0ChunksNoSchema = chunksL0NoSchema.rows.length;
        if (chunksL0NoSchema.rows.length > 0) {
            logger.warn(`Найдено ${chunksL0NoSchema.rows.length} L0 чанков без схемы`);
        }

        // 3. Анализ и исправление L1 зависимостей
        // Получаем все чанки уровня 1
        const l1Chunks = await client.query(`
      SELECT fv.id AS chunk_id, fv.chunk_content, fv.full_name AS parent_func, f.filename
      FROM public.file_vectors fv
      JOIN public.files f ON fv.file_id = f.id
      WHERE f.context_code = $1 AND fv.level LIKE '1-%'
    `, [contextCode]);

        report.summary.l1ChunksAnalyzed = l1Chunks.rows.length;
        pipelineState.updateStep(2, { totalItems: l1Chunks.rows.length });

        // Списки для фикса
        const knownKeys = ['called_functions', 'select_from', 'update_tables', 'insert_tables', 'dependencies', 'imports'];

        for (let i = 0; i < l1Chunks.rows.length; i++) {
            const chunk = l1Chunks.rows[i];
            let content = chunk.chunk_content;

            // Если контент строка, парсим
            if (typeof content === 'string') {
                try {
                    content = JSON.parse(content);
                } catch (e) {
                    logger.warn(`Ошибка парсинга chunk_content id=${chunk.chunk_id}`);
                    continue;
                }
            }

            let chunkModified = false;

            // Проходим по всем ключам зависимостей
            for (const key of knownKeys) {
                if (!Array.isArray(content[key]) || content[key].length === 0) continue;

                const newArray = [];
                for (const dep of content[key]) {
                    // Пропускаем если не строка или уже со схемой (есть точка)
                    if (typeof dep !== 'string' || dep.includes('.')) {
                        newArray.push(dep);
                        continue;
                    }

                    const shortName = dep.trim();
                    if (!shortName) continue;

                    // Ищем кандидатов в ai_item
                    // RegExp: имя начинается на что угодно, потом точка, потом shortName, потом конец
                    const candidates = await client.query(`
                    SELECT full_name
                    FROM public.ai_item
                    WHERE context_code = $1
                      AND full_name ~ ('^[^.]+\\.' || $2 || '$')
                `, [contextCode, shortName]);

                    if (candidates.rows.length === 0) {
                        report.summary.missingDeps++;
                        report.details.missing.push({
                            dep: shortName,
                            in: chunk.parent_func,
                            file: chunk.filename
                        });
                        newArray.push(shortName); // Оставляем как есть
                    } else if (candidates.rows.length === 1) {
                        // Найдено точное совпадение -> ИСПРАВЛЯЕМ
                        const fullName = candidates.rows[0].full_name;
                        newArray.push(fullName);
                        chunkModified = true;

                        report.summary.fixedDeps++;
                        report.details.fixes.push({
                            from: shortName,
                            to: fullName,
                            in: chunk.parent_func
                        });
                    } else {
                        // Неоднозначность
                        report.summary.ambiguousDeps++;
                        report.details.ambiguous.push({
                            dep: shortName,
                            candidates: candidates.rows.map(r => r.full_name),
                            in: chunk.parent_func
                        });
                        newArray.push(shortName); // Оставляем как есть
                    }
                }

                // Обновляем массив в контенте
                content[key] = newArray;
            }

            // Если были изменения, сохраняем в БД
            if (chunkModified) {
                await client.query(
                    `UPDATE public.file_vectors SET chunk_content = $1 WHERE id = $2`,
                    [content, chunk.chunk_id]
                );
            }

            // Обновляем прогресс
            pipelineState.incrementItemsProcessed(2);

            // История каждые 10 элементов
            if (pipelineHistory && (i + 1) % 10 === 0) {
                pipelineHistory.addHistoryEntry(contextCode, 2, pipelineState.getStep(2));
            }
        }

    } catch (err) {
        logger.error(`Критическая ошибка: ${err.message}`);
        report.details.errors.push(err.message);
        
        // Добавляем логи в report даже при ошибке
        report.logs = logger.getLogs();

        pipelineState.updateStep(2, {
            status: 'failed',
            error: err.message,
            completedAt: new Date().toISOString(),
            report
        });

        if (pipelineHistory) {
            pipelineHistory.addHistoryEntry(contextCode, 2, pipelineState.getStep(2));
        }
        throw err; // Пробрасываем ошибку выше, чтобы прервать пайплайн если нужно
    }

    logger.log(`Шаг 2 завершён.`);
    logger.log(`Исправлено зависимостей: ${report.summary.fixedDeps}`);
    logger.log(`Неоднозначных: ${report.summary.ambiguousDeps}`);
    logger.log(`Отсутствующих: ${report.summary.missingDeps}`);
    
    // Добавляем логи в report
    report.logs = logger.getLogs();

    // Завершение шага
    pipelineState.updateStep(2, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        progress: 100,
        report
    });

    if (pipelineHistory) {
        pipelineHistory.addHistoryEntry(contextCode, 2, pipelineState.getStep(2));
    }
}

module.exports = { runStep2 };
