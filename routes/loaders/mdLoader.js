// Загрузчик Markdown документов с разбиением на иерархию H1/H2
// routes/loaders/mdLoader.js

const fs = require('fs');
const path = require('path');
const { checkFileChanged } = require('../../packages/core/fileChangeDetector');
const { processEntitiesIncremental } = require('../../packages/core/entityProcessor');

/**
 * Парсинг структуры Markdown файла
 * @param {string} mdContent - содержимое MD файла
 * @param {string} filePath - путь к файлу (для отладки)
 * @returns {object} структура документа { mdDoc, h1Sections }
 */
function parseMdStructure(mdContent, filePath) {
  const lines = mdContent.split('\n');
  const structure = {
    mdDoc: null,  // пролог до первого H1
    h1Sections: [] // массив H1 секций
  };

  // Находим все H1 и H2 заголовки
  const headings = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const h1Match = line.match(/^#\s+(.+)$/);
    const h2Match = line.match(/^##\s+(.+)$/);

    if (h1Match && !line.startsWith('##')) {
      headings.push({
        level: 1,
        title: h1Match[1].trim(),
        lineIndex: i
      });
    } else if (h2Match) {
      headings.push({
        level: 2,
        title: h2Match[1].trim(),
        lineIndex: i
      });
    }
  }

  console.log(`[MD-Parser] Найдено заголовков: ${headings.length} (H1 + H2)`);

  // Определяем границы mdDoc (пролог до первого H1)
  const firstH1Index = headings.findIndex(h => h.level === 1);
  if (firstH1Index !== -1) {
    const firstH1Line = headings[firstH1Index].lineIndex;
    if (firstH1Line > 0) {
      structure.mdDoc = {
        startLine: 0,
        endLine: firstH1Line,
        content: lines.slice(0, firstH1Line).join('\n').trim()
      };
    }
  } else {
    // Нет H1 заголовков - весь файл идёт как mdDoc
    structure.mdDoc = {
      startLine: 0,
      endLine: lines.length,
      content: mdContent.trim()
    };
    return structure;
  }

  // Обрабатываем H1 секции
  const h1Headings = headings.filter(h => h.level === 1);
  
  for (let i = 0; i < h1Headings.length; i++) {
    const h1 = h1Headings[i];
    const nextH1 = h1Headings[i + 1];
    const h1EndLine = nextH1 ? nextH1.lineIndex : lines.length;

    // Находим все H2 внутри этого H1
    const h2InThisSection = headings.filter(h => 
      h.level === 2 && 
      h.lineIndex > h1.lineIndex && 
      h.lineIndex < h1EndLine
    );

    // Определяем контент H1 (до первого H2 или до конца секции)
    const firstH2InSection = h2InThisSection[0];
    const h1ContentEndLine = firstH2InSection ? firstH2InSection.lineIndex : h1EndLine;

    const h1Section = {
      title: h1.title,
      startLine: h1.lineIndex,
      endLine: h1EndLine,
      contentStartLine: h1.lineIndex + 1,
      contentEndLine: h1ContentEndLine,
      content: lines.slice(h1.lineIndex, h1ContentEndLine).join('\n').trim(),
      h2Sections: []
    };

    // Обрабатываем H2 внутри этого H1
    for (let j = 0; j < h2InThisSection.length; j++) {
      const h2 = h2InThisSection[j];
      const nextH2 = h2InThisSection[j + 1];
      const h2EndLine = nextH2 ? nextH2.lineIndex : h1EndLine;

      h1Section.h2Sections.push({
        title: h2.title,
        startLine: h2.lineIndex,
        endLine: h2EndLine,
        content: lines.slice(h2.lineIndex, h2EndLine).join('\n').trim()
      });
    }

    structure.h1Sections.push(h1Section);
  }

  console.log(`[MD-Parser] Структура: mdDoc=${!!structure.mdDoc}, H1 секций=${structure.h1Sections.length}`);
  
  return structure;
}

/**
 * Генерация slug из заголовка
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\wа-яё\s-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
}

/**
 * Загрузка Markdown файла с созданием AI Items и связей
 * @param {string} filePath - полный путь к MD файлу
 * @param {string} contextCode - контекст
 * @param {object} dbService - сервис БД
 * @param {object} pipelineState - состояние пайплайна
 * @returns {object} отчёт о загрузке
 */
async function loadMarkdownFromFile(filePath, contextCode, dbService, pipelineState = null, mode = 'incremental') {
  const filename = path.basename(filePath);
  console.log(`[MD-Loader] Обработка файла: ${filename}`);

  const report = {
    filename: filename,
    fileId: null,
    isNew: false,
    sectionsFound: 0,
    sectionsProcessed: 0,
    sections: [],
    errors: []
  };

  let mdContent;
  let fileHash = null;

  if (mode === 'incremental') {
    try {
      const changeResult = await checkFileChanged(filePath, contextCode, dbService);
      if (!changeResult.changed) {
        console.log(`[MD-Loader] Файл ${filename} не изменился (${changeResult.status}), пропускаем`);
        report.skipped = true;
        report.skipReason = changeResult.status;
        report.fileId = changeResult.fileId;
        return report;
      }
      mdContent = changeResult.content;
      fileHash = changeResult.newHash;
      report.fileId = changeResult.fileId;
    } catch (err) {
      console.warn(`[MD-Loader] Ошибка инкрементальной проверки: ${err.message}`);
      mdContent = null;
    }
  }

  if (!mdContent) {
    try {
      mdContent = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      const errorMsg = `Не удалось прочитать файл ${filename}: ${err.message}`;
      console.error(`[MD-Loader] ${errorMsg}`);
      report.errors.push(errorMsg);
      return report;
    }
  }

  // Парсим структуру
  const structure = parseMdStructure(mdContent, filePath);
  
  // Подсчёт секций
  let totalSections = 0;
  if (structure.mdDoc) totalSections++;
  totalSections += structure.h1Sections.length;
  structure.h1Sections.forEach(h1 => {
    totalSections += h1.h2Sections.length;
  });

  report.sectionsFound = totalSections;
  console.log(`[MD-Loader] Найдено секций: ${totalSections}`);

  // Convert structure to entities for incremental processing
  const entities = [];
  
  if (structure.mdDoc) {
    entities.push({
      full_name: `doc:${filename}`,
      sname: filename,
      type: 'md_doc',
      comment: 'Пролог документа',
      signature: `doc:${filename}`,
      body: structure.mdDoc.content
    });
  }
  
  for (const h1 of structure.h1Sections) {
    const h1FullName = `doc:${filename}#H1:${slugify(h1.title)}`;
    entities.push({
      full_name: h1FullName,
      sname: slugify(h1.title),
      type: 'head_level_1',
      comment: h1.title,
      signature: `H1:${h1.title}`,
      body: h1.content
    });
    
    for (const h2 of h1.h2Sections) {
      const h2FullName = `doc:${filename}##H2:${slugify(h1.title)}.${slugify(h2.title)}`;
      entities.push({
        full_name: h2FullName,
        sname: slugify(h2.title),
        type: 'head_level_2',
        comment: h2.title,
        signature: `H2:${h2.title}`,
        body: h2.content
      });
    }
  }

  // Регистрация файла
  try {
    const { id: fileId, isNew } = await dbService.saveFileInfo(filename, mdContent, filePath, contextCode, fileHash);
    report.fileId = fileId;
    report.isNew = isNew;
    console.log(`[MD-Loader] Файл зарегистрирован: fileId = ${fileId}, isNew = ${isNew}`);
  } catch (err) {
    const errorMsg = `Не удалось зарегистрировать файл ${filename}: ${err.message}`;
    console.error(`[MD-Loader] ${errorMsg}`);
    report.errors.push(errorMsg);
    return report;
  }

  // Кэшируем link_type IDs
  const linkTypeMap = {
    md_includes: 'includes',
    md_included_in: 'included_in',
    md_follows: 'follows',
    md_precedes: 'precedes'
  };
  const linkTypeIds = {};
  for (const code of Object.values(linkTypeMap)) {
    try {
      const res = await dbService.pgClient.query(
        'SELECT id FROM public.link_type WHERE code = $1',
        [code]
      );
      if (res.rows.length > 0) {
        linkTypeIds[code] = res.rows[0].id;
      } else {
        console.warn(`[MD-Loader] Тип связи '${code}' не найден в link_type`);
      }
    } catch (err) {
      console.error(`[MD-Loader] Ошибка при получении link_type '${code}':`, err.message);
    }
  }

  // === Инкрементальная обработка сущностей ===
  if (mode === 'incremental' && report.fileId) {
    try {
      const entityReport = await processEntitiesIncremental(entities, report.fileId, contextCode, dbService, {
        loaderTag: '[MD-Loader]',
        createChunksAndLinks: async (entity, aiItem, fId) => {
          const chunkContentL0 = { full_name: entity.full_name, s_name: entity.sname, signature: entity.signature, body: entity.body };
          const chunkContent = { text: chunkContentL0 };
          if (entity.comment && typeof entity.comment === 'string' && entity.comment.trim()) {
            chunkContent.comment = entity.comment.trim();
          }
          const chunkIdL0 = await dbService.saveChunkVector(fId, chunkContent, null,
            { type: 'markdown', level: '0-исходник', md_level: entity.type === 'md_doc' ? 'doc' : (entity.type === 'head_level_1' ? 1 : 2), s_name: entity.sname, h_name: entity.comment, full_name: entity.full_name }, null, contextCode);
          await dbService.pgClient.query('UPDATE public.chunk_vector SET ai_item_id = $1 WHERE id = $2', [aiItem.id, chunkIdL0]);

          // For MD documents, we can create hierarchical links
          // This would typically be handled separately since it requires cross-entity relationships
        }
      });
      report.entityReport = entityReport;
      report.sectionsProcessed = entityReport.created + entityReport.updated;
      console.log(`[MD-Loader] Инкрементальный итог: created=${entityReport.created}, updated=${entityReport.updated}, unchanged=${entityReport.unchanged}, deleted=${entityReport.deleted}`);
      return report;
    } catch (err) {
      console.error(`[MD-Loader] Ошибка инкрементальной обработки: ${err.message}`);
    }
  }

  // === Полный режим ===
  const allAiItems = []; // Для построения связей после создания всех ai_item

  // === 1. Обработка mdDoc (пролог) ===
  if (structure.mdDoc && structure.mdDoc.content) {
    const sectionReport = {
      full_name: `doc:${filename}`,
      type: 'md_doc',
      aiItemId: null,
      chunkL0Id: null,
      chunkL1Id: null,
      errors: []
    };

    try {
      console.log(`[MD-Loader] → Обработка md_doc`);

      // Создаём/обновляем ai_item
      const aiItemResult = await dbService.pgClient.query(
        `INSERT INTO public.ai_item (full_name, context_code, type, s_name, h_name, file_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (full_name, context_code) 
         DO UPDATE SET type = EXCLUDED.type, s_name = EXCLUDED.s_name, h_name = EXCLUDED.h_name, 
                       file_id = EXCLUDED.file_id, updated_at = NOW()
         RETURNING id`,
        [sectionReport.full_name, contextCode, 'md_doc', filename, 'Пролог документа', report.fileId]
      );
      sectionReport.aiItemId = aiItemResult.rows[0].id;

      // L0 чанк (содержимое md_doc)
      const chunkL0Id = await dbService.saveChunkVector(
        report.fileId,
        { text: structure.mdDoc.content },
        null, // embedding будет добавлен позже если нужно
        {
          type: 'markdown',
          level: '0-исходник',
          md_level: 'doc',
          s_name: filename,
          h_name: 'Пролог документа',
          full_name: sectionReport.full_name
        },
        null,
        contextCode
        // НЕ передаём ai_item_id - saveChunkVector найдёт его сам и не перезапишет type
      );
      sectionReport.chunkL0Id = chunkL0Id;

      allAiItems.push({
        full_name: sectionReport.full_name,
        aiItemId: sectionReport.aiItemId,
        type: 'md_doc',
        h1Children: [] // будет заполнено ниже
      });

      report.sectionsProcessed++;
      console.log(`[MD-Loader] md_doc обработан: aiItemId=${sectionReport.aiItemId}`);
    } catch (err) {
      const errorMsg = `Ошибка при обработке md_doc: ${err.message}`;
      console.error(`[MD-Loader] ${errorMsg}`);
      sectionReport.errors.push(errorMsg);
    }

    report.sections.push(sectionReport);
  }

  // === 2. Обработка H1 секций ===
  for (let i = 0; i < structure.h1Sections.length; i++) {
    const h1 = structure.h1Sections[i];
    const h1FullName = `doc:${filename}#H1:${slugify(h1.title)}`;
    
    const sectionReport = {
      full_name: h1FullName,
      type: 'head_level_1',
      title: h1.title,
      aiItemId: null,
      chunkL0Id: null,
      chunkL1Id: null,
      h2Children: [],
      errors: []
    };

    try {
      console.log(`[MD-Loader] → H1: "${h1.title}"`);

      // Создаём ai_item для H1
      const aiItemResult = await dbService.pgClient.query(
        `INSERT INTO public.ai_item (full_name, context_code, type, s_name, h_name, file_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (full_name, context_code) 
         DO UPDATE SET type = EXCLUDED.type, s_name = EXCLUDED.s_name, h_name = EXCLUDED.h_name, 
                       file_id = EXCLUDED.file_id, updated_at = NOW()
         RETURNING id`,
        [h1FullName, contextCode, 'head_level_1', slugify(h1.title), h1.title, report.fileId]
      );
      sectionReport.aiItemId = aiItemResult.rows[0].id;

      // L0 чанк (содержимое H1 без H2)
      const chunkL0Id = await dbService.saveChunkVector(
        report.fileId,
        { text: h1.content },
        null,
        {
          type: 'markdown',
          level: '0-исходник',
          md_level: 1,
          s_name: slugify(h1.title),
          h_name: h1.title,
          full_name: h1FullName
        },
        null,
        contextCode
        // НЕ передаём ai_item_id
      );
      sectionReport.chunkL0Id = chunkL0Id;

      allAiItems.push({
        full_name: h1FullName,
        aiItemId: sectionReport.aiItemId,
        type: 'head_level_1',
        h2Children: []
      });

      report.sectionsProcessed++;
      console.log(`[MD-Loader] H1 "${h1.title}" обработан: aiItemId=${sectionReport.aiItemId}`);

      // === 3. Обработка H2 внутри этого H1 ===
      for (let j = 0; j < h1.h2Sections.length; j++) {
        const h2 = h1.h2Sections[j];
        const h2FullName = `doc:${filename}##H2:${slugify(h1.title)}.${slugify(h2.title)}`;

        const h2Report = {
          full_name: h2FullName,
          type: 'head_level_2',
          title: h2.title,
          aiItemId: null,
          chunkL0Id: null,
          chunkL1Id: null,
          errors: []
        };

        try {
          console.log(`[MD-Loader]   → H2: "${h2.title}"`);

          // Создаём ai_item для H2
          const h2AiItemResult = await dbService.pgClient.query(
            `INSERT INTO public.ai_item (full_name, context_code, type, s_name, h_name, file_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
             ON CONFLICT (full_name, context_code) 
             DO UPDATE SET type = EXCLUDED.type, s_name = EXCLUDED.s_name, h_name = EXCLUDED.h_name, 
                           file_id = EXCLUDED.file_id, updated_at = NOW()
             RETURNING id`,
            [h2FullName, contextCode, 'head_level_2', slugify(h2.title), h2.title, report.fileId]
          );
          h2Report.aiItemId = h2AiItemResult.rows[0].id;

          // L0 чанк
          const h2ChunkL0Id = await dbService.saveChunkVector(
            report.fileId,
            { text: h2.content },
            null,
            {
              type: 'markdown',
              level: '0-исходник',
              md_level: 2,
              s_name: slugify(h2.title),
              h_name: h2.title,
              full_name: h2FullName
            },
            null,
            contextCode
            // НЕ передаём ai_item_id
          );
          h2Report.chunkL0Id = h2ChunkL0Id;

          // Сохраняем для связей
          allAiItems.push({
            full_name: h2FullName,
            aiItemId: h2Report.aiItemId,
            type: 'head_level_2',
            parentH1: h1FullName,
            orderIndex: j
          });

          // Добавляем к детям H1
          const parentH1Item = allAiItems.find(item => item.full_name === h1FullName);
          if (parentH1Item) {
            parentH1Item.h2Children.push(h2FullName);
          }
          // Также добавляем в sectionReport.h2Children для отчета
          sectionReport.h2Children.push(h2Report);
          report.sectionsProcessed++;
          console.log(`[MD-Loader]   H2 "${h2.title}" обработан: aiItemId=${h2Report.aiItemId}`);
        } catch (err) {
          const errorMsg = `Ошибка при обработке H2 "${h2.title}": ${err.message}`;
          console.error(`[MD-Loader] ${errorMsg}`);
          h2Report.errors.push(errorMsg);
        }
      }
    } catch (err) {
      const errorMsg = `Ошибка при обработке H1 "${h1.title}": ${err.message}`;
      console.error(`[MD-Loader] ${errorMsg}`);
      sectionReport.errors.push(errorMsg);
    }

    report.sections.push(sectionReport);
  }

  // === 4. Создание связей L1 ===
  console.log(`[MD-Loader] Создание L1 связей...`);

  // 4.1. md_doc включает все H1
  const mdDocItem = allAiItems.find(item => item.type === 'md_doc');
  const h1Items = allAiItems.filter(item => item.type === 'head_level_1');

  if (mdDocItem && h1Items.length > 0) {
    for (const h1Item of h1Items) {
      await createLink(dbService, contextCode, mdDocItem.full_name, h1Item.full_name, linkTypeIds.includes);
      await createLink(dbService, contextCode, h1Item.full_name, mdDocItem.full_name, linkTypeIds.included_in);
    }
  }

  // 4.2. Каждый H1 включает свои H2
  for (const h1Item of h1Items) {
    for (const h2FullName of h1Item.h2Children) {
      await createLink(dbService, contextCode, h1Item.full_name, h2FullName, linkTypeIds.includes);
      await createLink(dbService, contextCode, h2FullName, h1Item.full_name, linkTypeIds.included_in);
    }
  }

  // 4.3. Последовательность H2 (follows/precedes) - только внутри одной H1
  for (const h1Item of h1Items) {
    const h2InH1 = allAiItems
      .filter(item => item.type === 'head_level_2' && h1Item.h2Children.includes(item.full_name))
      .sort((a, b) => a.orderIndex - b.orderIndex);
    
    for (let i = 0; i < h2InH1.length - 1; i++) {
      const current = h2InH1[i];
      const next = h2InH1[i + 1];
      
      await createLink(dbService, contextCode, current.full_name, next.full_name, linkTypeIds.follows);
      await createLink(dbService, contextCode, next.full_name, current.full_name, linkTypeIds.precedes);
    }
  }

  console.log(`[MD-Loader] Файл ${filename} успешно обработан`);
  return report;
}

/**
 * Вспомогательная функция для создания связи
 */
async function createLink(dbService, contextCode, source, target, linkTypeId) {
  if (!linkTypeId) return;

  try {
    await dbService.pgClient.query(
      `INSERT INTO public.link (context_code, source, target, link_type_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (context_code, source, target, link_type_id) DO NOTHING`,
      [contextCode, source, target, linkTypeId]
    );
  } catch (err) {
    console.warn(`[MD-Loader] Не удалось создать связь ${source} -> ${target}: ${err.message}`);
  }
}

module.exports = {
  parseMdStructure,
  loadMarkdownFromFile
};
