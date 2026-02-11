// entityProcessor.js — инкрементальная обработка сущностей (entity-level diff)
const { computeEntityHash } = require('./hashUtils');

/**
 * Инкрементальная обработка массива сущностей (функций, классов, секций и т.д.)
 * Сравнивает каждую сущность с уже существующей в БД по content_hash.
 * Если hash совпадает — пропускает. Иначе — удаляет старые чанки/link, создаёт заново.
 * Исчезнувшие сущности удаляются каскадно, обратные соседи помечаются needs_rebuild.
 *
 * @param {Array<Object>} entities - Массив распарсенных сущностей, каждая с полями:
 *   { full_name, body, signature, comment, ... } (зависит от лоадера)
 * @param {number} fileId - ID файла в БД
 * @param {string} contextCode - Код контекста
 * @param {Object} dbService - Экземпляр DbService
 * @param {Object} options
 * @param {string} options.loaderTag - Тег для логирования, напр. '[SQL-Loader]'
 * @param {Function} options.createChunksAndLinks - async callback(entity, aiItem, fileId)
 *   Создаёт L0/L1 чанки и link'и для сущности. Вызывается лоадером.
 * @returns {Promise<{created: number, updated: number, unchanged: number, deleted: number}>}
 */
async function processEntitiesIncremental(entities, fileId, contextCode, dbService, options) {
  const { loaderTag = '[Loader]', createChunksAndLinks } = options;

  const report = { created: 0, updated: 0, unchanged: 0, deleted: 0 };

  // 1. Получаем старые ai_item для этого файла
  const oldItemsArr = await dbService.getAiItemsByFileId(fileId, contextCode);
  const oldItems = new Map();
  for (const item of oldItemsArr) {
    oldItems.set(item.full_name, { id: item.id, content_hash: item.content_hash, file_id: item.file_id });
  }

  // 2. Множество имён новых сущностей
  const newEntityNames = new Set(entities.map(e => e.full_name));

  // 3. Обработка каждой сущности
  for (const entity of entities) {
    const entityHash = computeEntityHash({
      body: entity.body,
      signature: entity.signature,
      comment: entity.comment
    });

    const oldItem = oldItems.get(entity.full_name);

    // Если сущность не изменилась — SKIP
    if (oldItem && oldItem.content_hash === entityHash) {
      console.log(`${loaderTag} Без изменений: ${entity.full_name}`);
      report.unchanged++;
      continue;
    }

    // Сущность изменилась или новая
    const isUpdate = !!oldItem;

    if (isUpdate) {
      // Удалить старые чанки и link'и
      await dbService.deleteChunksByAiItemId(oldItem.id);
      await dbService.deleteLinksBySource(entity.full_name, contextCode);
      console.log(`${loaderTag} Обновление сущности: ${entity.full_name}`);
    } else {
      console.log(`${loaderTag} Новая сущность: ${entity.full_name}`);
    }

    // Создать/обновить ai_item с новым content_hash
    const aiItem = await dbService.createAiItem({
      full_name: entity.full_name,
      contextCode: contextCode,
      type: entity.type || 'function',
      sName: entity.sname || entity.s_name || entity.full_name,
      fileId: fileId,
      contentHash: entityHash
    });

    // Callback лоадера: создание L0/L1 чанков и link'ов
    if (createChunksAndLinks) {
      await createChunksAndLinks(entity, aiItem, fileId);
    }

    // Пометить сам ai_item как требующий перестройки
    await dbService.markNeedsRebuild([entity.full_name], contextCode);

    if (isUpdate) {
      report.updated++;
    } else {
      report.created++;
    }
  }

  // 4. Шаг G — удаление исчезнувших сущностей
  for (const [fullName, oldItem] of oldItems) {
    if (newEntityNames.has(fullName)) continue; // сущность ещё есть

    // Перечитать текущий file_id (защита от переезда)
    const currentFileId = await dbService.getAiItemFileId(oldItem.id);
    if (currentFileId !== fileId) {
      console.log(`${loaderTag} Сущность ${fullName} переехала (file_id ${currentFileId} != ${fileId}), не удаляем`);
      continue;
    }

    // Пометить обратных соседей
    const reverseNeighbors = await dbService.getReverseLinkedItems(fullName, contextCode);
    if (reverseNeighbors.length > 0) {
      await dbService.markNeedsRebuild(reverseNeighbors, contextCode);
      console.log(`${loaderTag} Помечены обратные соседи (${reverseNeighbors.length}) для удаляемой ${fullName}`);
    }

    // Каскадное удаление
    await dbService.deleteAiItemCascade(oldItem.id, fullName, contextCode);
    console.log(`${loaderTag} Удалена сущность: ${fullName}`);
    report.deleted++;
  }

  return report;
}

module.exports = {
  processEntitiesIncremental
};
