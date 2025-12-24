/**
 * Модуль для разбиения текста на чанки с различными стратегиями
 */

/**
 * Разделяет текст на чанки с учетом маркеров секций
 * @param {string} text - Исходный текст
 * @param {Object} options - Параметры разбиения
 * @param {string} options.sectionMarker - Маркер начала секции
 * @param {string} options.separator - Стандартный разделитель
 * @param {number} options.chunkSize - Максимальный размер чанка
 * @param {number} options.chunkOverlap - Размер перекрытия между чанками
 * @returns {string[]} Массив чанков
 */
function splitTextWithSections(text, options) {
  const { sectionMarker, separator = '\n', chunkSize = 200, chunkOverlap = 50 } = options;
  
  // Если маркер секций не указан, используем стандартное разделение
  if (!sectionMarker) {
    return splitTextByCharacters(text, { separator, chunkSize, chunkOverlap });
  }
  
  console.log(`Разбиение текста на секции с маркером: "${sectionMarker}"`);
  
  const chunks = [];
  
  // Находим все позиции маркеров секций
  const sectionPositions = [];
  let position = text.indexOf(sectionMarker);
  
  while (position !== -1) {
    sectionPositions.push(position);
    position = text.indexOf(sectionMarker, position + 1);
  }
  
  console.log(`Найдено ${sectionPositions.length} секций`);
  
  // Если маркеров нет, используем стандартное разделение
  if (sectionPositions.length === 0) {
    return splitTextByCharacters(text, { separator, chunkSize, chunkOverlap });
  }
  
  // Обрабатываем каждую секцию
  for (let i = 0; i < sectionPositions.length; i++) {
    const start = sectionPositions[i];
    const end = (i < sectionPositions.length - 1) ? sectionPositions[i + 1] : text.length;
    
    // Получаем текст секции
    const sectionText = text.substring(start, end);
    
    // Если секция помещается в один чанк, добавляем её как есть
    if (sectionText.length <= chunkSize) {
      chunks.push(sectionText);
    } else {
      // Если секция слишком большая, обрезаем её до размера чанка
      chunks.push(sectionText.substring(0, chunkSize));
    }
  }
  
  // Обрабатываем текст до первой секции, если он есть
  if (sectionPositions[0] > 0) {
    const initialText = text.substring(0, sectionPositions[0]);
    
    // Если начальный текст помещается в один чанк, добавляем его как есть
    if (initialText.length <= chunkSize) {
      chunks.unshift(initialText);
    } else {
      // Если начальный текст слишком большой, обрезаем его
      chunks.unshift(initialText.substring(0, chunkSize));
    }
  }
  
  console.log(`Создано ${chunks.length} чанков`);
  return chunks;
}

/**
 * Разделяет текст на чанки по символам с учетом разделителя
 * @param {string} text - Исходный текст
 * @param {Object} options - Параметры разбиения
 * @param {string} options.separator - Разделитель
 * @param {number} options.chunkSize - Максимальный размер чанка
 * @param {number} options.chunkOverlap - Размер перекрытия между чанками
 * @returns {string[]} Массив чанков
 */
function splitTextByCharacters(text, options) {
  const { separator = '\n', chunkSize = 200, chunkOverlap = 50 } = options;
  
  // Если текст меньше размера чанка, возвращаем его как есть
  if (text.length <= chunkSize) {
    return [text];
  }
  
  const chunks = [];
  const separatorLength = separator.length;
  
  // Разбиваем текст на части по разделителю
  const parts = text.split(separator);
  
  let currentChunk = '';
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    
    // Если часть не пустая, добавляем разделитель (кроме первой части)
    const partWithSeparator = i > 0 ? separator + part : part;
    
    // Если текущий чанк + новая часть не превышают размер чанка, добавляем часть к чанку
    if (currentChunk.length + partWithSeparator.length <= chunkSize) {
      currentChunk += partWithSeparator;
    } else {
      // Если текущий чанк не пустой, добавляем его в список чанков
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      
      // Если часть больше размера чанка, разбиваем её на подчасти
      if (partWithSeparator.length > chunkSize) {
        // Разбиваем большую часть на подчасти
        let j = 0;
        while (j < partWithSeparator.length) {
          chunks.push(partWithSeparator.substring(j, j + chunkSize));
          j += chunkSize - chunkOverlap;
        }
        currentChunk = partWithSeparator.substring(Math.max(0, j - chunkSize), j);
      } else {
        // Начинаем новый чанк с текущей части
        currentChunk = partWithSeparator;
      }
    }
  }
  
  // Добавляем последний чанк, если он не пустой
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

/**
 * Разделяет SQL-текст на чанки на основе типов SQL-объектов (функции, таблицы и т.д.)
 * @param {string} text - Исходный SQL-текст
 * @param {Object} options - Параметры разбиения
 * @param {number} options.chunkSize - Максимальный размер чанка (по умолчанию 200000)
 * @param {number} options.chunkOverlap - Размер перекрытия между чанками (по умолчанию 0)
 * @returns {Array} Массив объектов с текстом чанка и метаданными
 */
function splitSqlByObjects(text, options = {}) {
  const { chunkSize = 200000, chunkOverlap = 0 } = options;
  
  console.log(`Разбиение SQL-текста на объекты с параметрами: chunkSize=${chunkSize}, chunkOverlap=${chunkOverlap}`);
  
  // Преобразуем текст к нижнему регистру для поиска ключевых слов без учета регистра
  const lowerText = text.toLowerCase();
  
  // Определяем паттерны для разных типов SQL-объектов
  const patterns = [
    { 
      pattern: /create\s+(?:or\s+replace\s+)?function\s+/gi, 
      type: 'function' 
    },
    { 
      pattern: /create\s+table\s+/gi, 
      type: 'table' 
    },
    { 
      pattern: /create\s+(?:unique\s+)?index\s+/gi, 
      type: 'index' 
    },
    { 
      pattern: /create\s+view\s+/gi, 
      type: 'view' 
    },
    { 
      pattern: /create\s+materialized\s+view\s+/gi, 
      type: 'materialized_view' 
    },
    { 
      pattern: /create\s+(?:or\s+replace\s+)?procedure\s+/gi, 
      type: 'procedure' 
    },
    { 
      pattern: /create\s+trigger\s+/gi, 
      type: 'trigger' 
    },
    { 
      pattern: /create\s+sequence\s+/gi, 
      type: 'sequence' 
    },
    {
      pattern: /create\s+type\s+/gi,
      type: 'type'
    },
    {
      pattern: /create\s+domain\s+/gi,
      type: 'domain'
    },
    {
      pattern: /create\s+schema\s+/gi,
      type: 'schema'
    },
    {
      pattern: /create\s+role\s+/gi,
      type: 'role'
    },
    {
      pattern: /grant\s+/gi,
      type: 'grant'
    }
  ];
  
  // Находим все позиции и типы SQL-объектов
  const positions = [];
  
  patterns.forEach(({ pattern, type }) => {
    let match;
    const regex = new RegExp(pattern);
    
    while ((match = regex.exec(lowerText)) !== null) {
      positions.push({
        position: match.index,
        type,
        pattern: match[0]
      });
    }
  });
  
  // Если не найдены SQL-объекты, возвращаем весь текст как один чанк
  if (positions.length === 0) {
    return [{
      content: text,
      metadata: {
        type: 'sql',
        level: '0-исходник'
      }
    }];
  }
  
  // Сортируем позиции в порядке возрастания
  positions.sort((a, b) => a.position - b.position);
  
  // Создаем чанки на основе найденных позиций
  const chunks = [];
  
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].position;
    const end = (i < positions.length - 1) 
      ? positions[i + 1].position 
      : text.length;
    
    const chunkText = text.substring(start, end);
    
    // Если чанк слишком большой, разбиваем его на подчанки
    if (chunkText.length > chunkSize) {
      let j = 0;
      while (j < chunkText.length) {
        const subChunkText = chunkText.substring(j, Math.min(j + chunkSize, chunkText.length));
        
        chunks.push({
          content: subChunkText,
          metadata: {
            type: positions[i].type,
            level: '0-исходник'
          }
        });
        
        j += chunkSize - chunkOverlap;
      }
    } else {
      chunks.push({
        content: chunkText,
        metadata: {
          type: positions[i].type,
          level: '0-исходник'
        }
      });
    }
  }
  
  // Обрабатываем текст до первого SQL-объекта
  if (positions[0].position > 0) {
    const initialText = text.substring(0, positions[0].position);
    
    if (initialText.trim().length > 0) {
      chunks.unshift({
        content: initialText,
        metadata: {
          type: 'sql',
          level: '0-исходник'
        }
      });
    }
  }
  
  console.log(`Создано ${chunks.length} SQL-чанков`);
  return chunks;
}

/**
 * Разделяет Markdown-документ на чанки по заголовкам
 * @param {string} text - Исходный Markdown-текст
 * @param {Object} options - Параметры разбиения
 * @param {number} options.chunkSize - Максимальный размер чанка (по умолчанию 1500)
 * @param {number} options.chunkOverlap - Размер перекрытия между чанками (по умолчанию 200)
 * @param {Array<number>} options.headingLevels - Уровни заголовков для разбиения [1,2,3,...]
 * @param {string} options.codeBlocks - Обработка блоков кода: 'separate' | 'inline' | 'ignore'
 * @returns {Array} Массив объектов с текстом чанка и метаданными
 */
function splitMarkdownBySections(text, options = {}) {
  const { 
    chunkSize = 1500, 
    chunkOverlap = 200,
    headingLevels = [1, 2, 3], // По умолчанию разбиваем по заголовкам 1-го, 2-го и 3-го уровня
    codeBlocks = 'inline' // По умолчанию оставляем блоки кода внутри разделов
  } = options;
  
  console.log(`[MD-SPLITTER] Разбиение Markdown-текста на разделы с параметрами: chunkSize=${chunkSize}, headingLevels=${headingLevels.join(',')}`);
  
  // Паттерн для поиска заголовков нужных уровней
  const headingPattern = new RegExp(`^(#{1,${Math.max(...headingLevels)}})\\s+(.+)$`, 'gm');
  
  // Находим блоки кода, чтобы не разрывать их
  const codeBlocksList = [];
  if (codeBlocks !== 'ignore') {
    const codeBlockPattern = /```[\s\S]*?```/g;
    let codeMatch;
    while ((codeMatch = codeBlockPattern.exec(text)) !== null) {
      // console.log(`-1- Разбиение Markdown-текста на разделы с параметрами: chunkSize=${chunkSize}, headingLevels=${headingLevels}`);
      codeBlocksList.push({
        position: codeMatch.index,
        end: codeMatch.index + codeMatch[0].length,
        content: codeMatch[0]
      });
    }
  }
  
  // Находим все заголовки в тексте
  const headings = [];
  let match;
  
  console.log(`[MD-SPLITTER] Ищем заголовки уровней ${headingLevels.join(',')}...`);
  
  while ((match = headingPattern.exec(text)) !== null) {
    const level = match[1].length; // Количество # определяет уровень заголовка
    const title = match[2].trim();
    
    // Проверяем, что уровень заголовка входит в нужные для разбиения
    if (headingLevels.includes(level)) {
      console.log(`[MD-SPLITTER] Найден заголовок H${level}: "${title}"`);
      headings.push({
        position: match.index,
        level,
        title,
        raw: match[0]
      });
    }
  }
  
  // console.log(`-3- Разбиение Markdown-текста на разделы с параметрами: chunkSize=${chunkSize}, headingLevels=${headingLevels}`);
  
  // Если заголовков нет, разбиваем текст на чанки стандартным способом
  if (headings.length === 0) {
    return splitTextByCharacters(text, { chunkSize, chunkOverlap, separator: '\n\n' })
      .map(chunk => ({
        content: chunk,
        metadata: {
          type: 'markdown',
          level: '0-исходник',
          s_name: '',
          h_name: '',
          full_name: ''
        }
      }));
  }
  
  // console.log(`-4- Разбиение Markdown-текста на разделы с параметрами: chunkSize=${chunkSize}, headingLevels=${headingLevels}`);
  
  // Сортируем заголовки по позиции
  headings.sort((a, b) => a.position - b.position);
  
  // Создаем чанки на основе найденных заголовков
  const chunks = [];
  
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].position;
    const end = (i < headings.length - 1) 
      ? headings[i + 1].position 
      : text.length;
    
    // Получаем текст раздела
    const sectionText = text.substring(start, end);
    
    // Проверяем, нужно ли разделять большие разделы
    if (sectionText.length > chunkSize) {
      // Определяем подразделы по более низким уровням заголовков (если есть)
      const subHeadingPattern = new RegExp(`^(#{${headings[i].level + 1},6})\\s+(.+)$`, 'gm');
      const subHeadings = [];
      let subMatch;
      
      let sectionForSearch = sectionText;
      while ((subMatch = subHeadingPattern.exec(sectionForSearch)) !== null) {
      //  console.log(`-5.1- Разбиение Markdown-текста на разделы с параметрами: chunkSize=${chunkSize}, headingLevels=${headingLevels}`);

        subHeadings.push({
          position: start + subMatch.index,
          level: subMatch[1].length,
          title: subMatch[2].trim(),
          raw: subMatch[0]
        });
      }
      
      // Если есть подзаголовки, разбиваем по ним
      if (subHeadings.length > 0) {
        subHeadings.sort((a, b) => a.position - b.position);
        
        for (let j = 0; j < subHeadings.length; j++) {
          const subStart = subHeadings[j].position;
          const subEnd = (j < subHeadings.length - 1) 
            ? subHeadings[j + 1].position 
            : end;

          const subSectionText = text.substring(subStart, subEnd);
          console.log(`-5.2- Разбиение Markdown-текста на разделы с параметрами: chunkSize=${chunkSize}, headingLevels=${headingLevels}`);
            chunks.push({
              content: subSectionText,
              metadata: {
                type: 'markdown',
                level: '0-исходник',
                s_name: `h${subHeadings[j].level}_${subHeadings[j].title.toLowerCase().replace(/\s+/g, '_')}`,
                h_name: subHeadings[j].title,
                full_name: subHeadings[j].title,
                parent_heading: headings[i].title
              }
            });
        }
      } else {
        // console.log(`-5.3- Разбиение Markdown-текста на разделы с параметрами: chunkSize=${chunkSize}, headingLevels=${headingLevels}`);
        // Если подзаголовков нет, разбиваем по параграфам
        let j = 0;
        while (j < sectionText.length) {
          // Проверяем, не разбиваем ли мы блок кода
          let canSplit = true;
          const absPos = start + j;
          // console.log(`-5.4- Разбиение Markdown-текста на разделы с параметрами: chunkSize=${chunkSize}, headingLevels=${headingLevels}`);
          for (const block of codeBlocksList) {
            if (absPos > block.position && absPos < block.end) {
              canSplit = false;
              // Если оказались внутри блока кода, двигаемся к его концу
              if (codeBlocks === 'separate') {
                j = block.end - start;
                chunks.push({
                  content: text.substring(block.position, block.end),
                  metadata: {
                    type: 'code_block',
                    level: '0-исходник',
                    s_name: 'code_block',
                    h_name: 'Блок кода',
                    full_name: 'Блок кода',
                    parent_heading: headings[i].title
                  }
                });
              }
              break;
            }
          }
          
          if (canSplit) {
            const subChunkEnd = Math.min(j + chunkSize, sectionText.length);
            const subChunkText = sectionText.substring(j, subChunkEnd);
            
            chunks.push({
              content: subChunkText,
              metadata: {
                type: 'markdown',
                level: '0-исходник',
                s_name: `h${headings[i].level}_${headings[i].title.toLowerCase().replace(/\s+/g, '_')}_part${Math.floor(j/chunkSize)}`,
                h_name: `${headings[i].title} (часть ${Math.floor(j/chunkSize) + 1})`,
                full_name: `${headings[i].title} (часть ${Math.floor(j/chunkSize) + 1})`,
                isPartial: true,
                partIndex: Math.floor(j/chunkSize)
              }
            });
            
            j += chunkSize - chunkOverlap;
          } else {
            // Если мы не можем разбить здесь (внутри блока кода)
            // и не выбрали опцию 'separate', то нужно все равно увеличить j
            if (codeBlocks !== 'separate') {
              // Передвигаемся вперед хотя бы на 1 символ, чтобы избежать зацикливания
              j += 1;
            }
          }
        }
        // console.log(`-5.5- Разбиение Markdown-текста на разделы с параметрами: chunkSize=${chunkSize}, headingLevels=${headingLevels}`);
      }
    } else {
      // Если раздел помещается в один чанк, добавляем его как есть
      chunks.push({
        content: sectionText,
        metadata: {
          type: 'markdown',
          level: '0-исходник',
          s_name: `h${headings[i].level}_${headings[i].title.toLowerCase().replace(/\s+/g, '_')}`,
          h_name: headings[i].title,
          full_name: headings[i].title
        }
      });
    }
  }
  
  // console.log(`-6- Разбиение Markdown-текста на разделы с параметрами: chunkSize=${chunkSize}, headingLevels=${headingLevels}`);
  // Обрабатываем текст до первого заголовка, если он есть
  if (headings[0].position > 0) {
    const initialText = text.substring(0, headings[0].position);
    
    if (initialText.trim().length > 0) {
      chunks.unshift({
        content: initialText,
        metadata: {
          type: 'markdown',
          level: '0-исходник',
          s_name: 'introduction',
          h_name: 'Введение',
          full_name: 'Введение'
        }
      });
    }
  }
  
  console.log(`[MD-SPLITTER] Создано ${chunks.length} Markdown-чанков`);
  
  // Выводим подробную информацию о каждом чанке
  chunks.forEach((chunk, index) => {
    console.log(`[MD-SPLITTER] Чанк ${index}: type=${chunk.metadata.type}, h_name="${chunk.metadata.h_name}", full_name="${chunk.metadata.full_name}"`);
  });
  
  return chunks;
}

/**
 * Разделяет JavaScript-текст на чанки на основе типов JS-объектов (функции, классы и т.д.)
 * @param {string} text - Исходный JavaScript-текст
 * @param {Object} options - Параметры разбиения
 * @param {number} options.chunkSize - Максимальный размер чанка (по умолчанию 10000)
 * @param {number} options.chunkOverlap - Размер перекрытия между чанками (по умолчанию 100)
 * @param {boolean} options.includeComments - Включать комментарии в анализ (по умолчанию true)
 * @param {boolean} options.parseImports - Выделять импорты в отдельные чанки (по умолчанию true)
 * @returns {Array} Массив объектов с текстом чанка и метаданными
 */
function splitJsByObjects(text, options = {}) {
  const { 
    chunkSize = 10000, 
    chunkOverlap = 0,
    includeComments = true,
    parseImports = true
  } = options;
  
  console.log(`Разбиение JavaScript-текста на объекты с параметрами: chunkSize=${chunkSize}, chunkOverlap=${chunkOverlap}`);
  
  // Преобразуем текст к нижнему регистру для поиска ключевых слов без учета регистра
  const lowerText = text.toLowerCase();
  
  // Определяем паттерны для разных типов JS-объектов
  const patterns = [
    { 
      // Исключаем ключевые слова if, for, while и т.д.
      pattern: /(?:export\s+)?(?:async\s+)?function\s+(?!if|else|for|while|switch|catch|with)\w+\s*\(/gi, 
      type: 'function' 
    },
    { 
      pattern: /(?:export\s+)?const\s+\w+\s*=\s*(?:async\s+)?\(\s*.*?\s*\)\s*=>/gi, 
      type: 'arrow_function' 
    },
    { 
      pattern: /(?:export\s+)?(?:abstract\s+)?class\s+\w+/gi, 
      type: 'class' 
    },
    { 
      pattern: /(?:export\s+)?interface\s+\w+/gi, 
      type: 'interface' 
    },
    { 
      pattern: /(?:export\s+)?(?:const|let|var)\s+\w+\s*=/gi, 
      type: 'variable' 
    },
    {
      pattern: /import\s+.*from\s+['"].*['"]/gi,
      type: 'import'
    },
    {
      pattern: /export\s+default\s+/gi,
      type: 'export_default'
    },
    {
      pattern: /export\s+{/gi,
      type: 'export_named'
    }
  ];
  
  // Находим все позиции и типы JS-объектов
  const positions = [];
  
  patterns.forEach(({ pattern, type }) => {
    let match;
    const regex = new RegExp(pattern);
    
    while ((match = regex.exec(lowerText)) !== null) {
      // Для импортов проверяем parseImports
      if (type === 'import' && !parseImports) continue;
      
      positions.push({
        position: match.index,
        type,
        pattern: match[0]
      });
    }
  });
  
  // Если не найдены JS-объекты, возвращаем весь текст как один чанк
  if (positions.length === 0) {
    return [{
      content: text,
      metadata: {
        type: 'javascript',
        level: '0-исходник'
      }
    }];
  }
  
  // Сортируем позиции в порядке возрастания
  positions.sort((a, b) => a.position - b.position);
  
  // Создаем чанки на основе найденных позиций
  const chunks = [];
  
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].position;
    const end = (i < positions.length - 1) 
      ? positions[i + 1].position 
      : text.length;
    
    const chunkText = text.substring(start, end);
    
    // Если чанк слишком большой, разбиваем его на подчанки
    if (chunkText.length > chunkSize) {
      let j = 0;
      while (j < chunkText.length) {
        const subChunkText = chunkText.substring(j, Math.min(j + chunkSize, chunkText.length));
        
        chunks.push({
          content: subChunkText,
          metadata: {
            type: positions[i].type,
            level: '0-исходник',
            isPartial: true,
            partIndex: Math.floor(j/chunkSize)
          }
        });
        
        j += chunkSize - chunkOverlap;
      }
    } else {
      chunks.push({
        content: chunkText,
        metadata: {
          type: positions[i].type,
          level: '0-исходник'
        }
      });
    }
  }
  
  // Обрабатываем текст до первого JS-объекта (обычно комментарии в начале файла)
  if (positions[0].position > 0) {
    const initialText = text.substring(0, positions[0].position);
    
    if (initialText.trim().length > 0) {
      chunks.unshift({
        content: initialText,
        metadata: {
          type: 'comment',
          level: '0-исходник'
        }
      });
    }
  }
  
  // Извлечение имен объектов для метаданных
  chunks.forEach(chunk => {
    // Дополнительная обработка для извлечения имен
    if (chunk.metadata.type === 'function') {
      const match = chunk.content.match(/function\s+(\w+)/i);
      if (match && match[1]) {
        // Проверяем, не является ли это ключевым словом JavaScript
        const jsKeywords = ['if', 'else', 'for', 'while', 'switch', 'catch', 'with'];
        if (!jsKeywords.includes(match[1].toLowerCase())) {
          chunk.metadata.s_name = match[1];
          chunk.metadata.h_name = match[1];
          chunk.metadata.full_name = match[1];
        }
      }
    } else if (chunk.metadata.type === 'arrow_function') {
      const match = chunk.content.match(/const\s+(\w+)\s*=/i);
      if (match && match[1]) {
        chunk.metadata.s_name = match[1];
        chunk.metadata.h_name = match[1];
        chunk.metadata.full_name = match[1];
      }
    } else if (chunk.metadata.type === 'class') {
      const match = chunk.content.match(/class\s+(\w+)/i);
      if (match && match[1]) {
        chunk.metadata.s_name = match[1];
        chunk.metadata.h_name = match[1];
        chunk.metadata.full_name = match[1];
      }
    } else if (chunk.metadata.type === 'interface') {
      const match = chunk.content.match(/interface\s+(\w+)/i);
      if (match && match[1]) {
        chunk.metadata.s_name = match[1];
        chunk.metadata.h_name = match[1];
        chunk.metadata.full_name = match[1];
      }
    } else if (chunk.metadata.type === 'variable') {
      const match = chunk.content.match(/(?:const|let|var)\s+(\w+)\s*=/i);
      if (match && match[1]) {
        chunk.metadata.s_name = match[1];
        chunk.metadata.h_name = match[1];
        chunk.metadata.full_name = match[1];
      }
    }
  });
  
  console.log(`Создано ${chunks.length} JavaScript-чанков`);
  return chunks;
}

/**
 * Разделяет JavaScript код на чанки по объектам (функции, классы, методы)
 * @param {string} text - Исходный JavaScript код
 * @param {Object} options - Параметры разбиения
 * @param {number} options.chunkSize - Максимальный размер чанка (по умолчанию 20000)
 * @param {number} options.chunkOverlap - Размер перекрытия между чанками (по умолчанию 0)
 * @param {boolean} options.includeComments - Включать комментарии в чанки (по умолчанию true)
 * @param {boolean} options.parseImports - Выделять импорты в отдельный чанк (по умолчанию true)
 * @returns {Array} Массив объектов с текстом чанка и метаданными
 */
function splitJavaScriptByObjects(text, options = {}) {
    console.log(`[JS-SPLITTER] Начинаем разбор JavaScript файла...`);
    const chunks = [];
    const REGEX_FLAGS = 'g'; // Global flag to find all matches

    // Find block boundaries (handles nested braces)
    const findBlockEnd = (str, start) => {
        let braceLevel = 0;
        let firstBraceFound = false;
        for (let i = start; i < str.length; i++) {
            if (str[i] === '{') {
                braceLevel++;
                firstBraceFound = true;
            } else if (str[i] === '}') {
                braceLevel--;
            }
            if (firstBraceFound && braceLevel === 0) {
                return i + 1;
            }
        }
        return -1; // Not found
    };

    // 1. Find top-level classes
    console.log(`[JS-SPLITTER] Ищем классы...`);
    const classPattern = new RegExp(/class\s+([a-zA-Z0-9_]+)\s*\{/, REGEX_FLAGS);
    let classMatch;
    const processedRanges = [];

    while ((classMatch = classPattern.exec(text)) !== null) {
        const className = classMatch[1];
        const blockStartIndex = classMatch.index;
        const blockEndIndex = findBlockEnd(text, blockStartIndex);

        if (blockEndIndex !== -1) {
            console.log(`[JS-SPLITTER] Найден класс: ${className}`);
            const classContent = text.substring(blockStartIndex, blockEndIndex);
            processedRanges.push({ start: blockStartIndex, end: blockEndIndex });

            chunks.push({
                content: classContent,
                metadata: { type: 'class', level: '0-исходник', s_name: className, h_name: className, full_name: className }
            });

            // 2. Find methods within this class
            console.log(`[JS-SPLITTER] Ищем методы в классе ${className}...`);
            const methodPattern = new RegExp(/(?:async\s+|get\s+|set\s+)?([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{/, REGEX_FLAGS);
            const classBody = classContent.substring(classContent.indexOf('{') + 1, classContent.lastIndexOf('}'));
            let methodMatch;

            while ((methodMatch = methodPattern.exec(classBody)) !== null) {
                // Avoid matching 'function' keyword inside a method
                if (methodMatch[0].trim().startsWith('function')) continue;
                
                const methodName = methodMatch[1];
                // Исключаем конструкции if, while, for, switch и другие ключевые слова
                const jsKeywords = ['if', 'else', 'for', 'while', 'switch', 'catch', 'with'];
                if (jsKeywords.includes(methodName)) continue;
                
                // Skip constructor if it is the only thing on the line
                if (methodName === 'constructor' && methodMatch.input.trim().startsWith('constructor')) continue;

                const methodStartIndex = methodMatch.index;
                const methodBlockEndIndex = findBlockEnd(classBody, methodStartIndex);

                if (methodBlockEndIndex !== -1) {
                    const methodContent = classBody.substring(methodStartIndex, methodBlockEndIndex);
                    const full_name = `${className}.${methodName}`;
                    console.log(`[JS-SPLITTER] Найден метод: ${full_name}`);
                    chunks.push({
                        content: methodContent,
                        metadata: { type: 'method', level: '0-исходник', s_name: methodName, h_name: full_name, full_name: full_name }
                    });
                }
            }
        }
    }

    // 3. Find top-level functions (outside of processed class ranges)
    console.log(`[JS-SPLITTER] Ищем standalone функции...`);
    const functionPattern = new RegExp(/(?:async\s+)?function\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{/, REGEX_FLAGS);
    let funcMatch;
    while ((funcMatch = functionPattern.exec(text)) !== null) {
        const funcName = funcMatch[1];
        const blockStartIndex = funcMatch.index;
        
        // Check if this function is inside a range we already processed (a class)
        const isProcessed = processedRanges.some(range => blockStartIndex >= range.start && blockStartIndex < range.end);
        if (isProcessed) {
            console.log(`[JS-SPLITTER] Пропускаем функцию ${funcName} - она внутри класса`);
            continue;
        }

        const blockEndIndex = findBlockEnd(text, blockStartIndex);
        if (blockEndIndex !== -1) {
            console.log(`[JS-SPLITTER] Найдена функция: ${funcName}`);
            const funcContent = text.substring(blockStartIndex, blockEndIndex);
            chunks.push({
                content: funcContent,
                metadata: { type: 'function', level: '0-исходник', s_name: funcName, h_name: funcName, full_name: funcName }
            });
        }
    }
    
    console.log(`[JS-SPLITTER] Создано ${chunks.length} JavaScript-чанков`);
    
    // Выводим подробную информацию о каждом чанке
    chunks.forEach((chunk, index) => {
        console.log(`[JS-SPLITTER] Чанк ${index}: type=${chunk.metadata.type}, full_name="${chunk.metadata.full_name}"`);
    });
    
    return chunks;
}


// Экспортируем функции
module.exports = {
  splitTextWithSections,
  splitTextByCharacters,
  splitSqlByObjects,
  splitMarkdownBySections,
  splitJsByObjects,
  splitJavaScriptByObjects,
}; 