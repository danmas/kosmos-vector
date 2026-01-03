// routes/pipeline/step1Runner.js
// Обновлённая версия для AiItem RAG Architect v2.1.1+

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const { Minimatch } = require('minimatch');
const kbConfigService = require('../../packages/core/kbConfigService');
const { createMatchers, normalizeRelativePath, isIgnored: checkIgnored, isIncluded: checkIncluded } = require('../../packages/core/fileMatchUtils');
const { loadSqlFunctionsFromFile } = require('../loaders/sqlFunctionLoader');
const { loadJsFunctionsFromFile } = require('../loaders/jsFunctionLoader');
const { loadTsFunctionsFromFile } = require('../loaders/tsFunctionLoader');
const { getFilteredTableNames, loadTableSchema } = require('../loaders/tableSchemaLoader');
const { createStepLogger } = require('./stepLogger');

/**
 * Парсинг настроек загрузки таблиц из YAML строки custom_settings
 * @param {string|null} customSettingsYaml - YAML строка из metadata.custom_settings
 * @returns {object|null} Объект с настройками { enabled, schema, includePatterns, excludePatterns, excludeNames } или null
 */
function parseTableLoadingConfig(customSettingsYaml) {
  if (!customSettingsYaml || typeof customSettingsYaml !== 'string' || customSettingsYaml.trim() === '') {
    return null;
  }

  try {
    const parsed = yaml.load(customSettingsYaml);
    
    if (!parsed || typeof parsed !== 'object') {
      console.warn('[Step1] custom_settings не является объектом YAML');
      return null;
    }

    const tableLoading = parsed.table_loading;
    
    if (!tableLoading || typeof tableLoading !== 'object') {
      // Секция table_loading отсутствует - это нормально, просто не настроено
      return null;
    }

    // Валидация обязательных полей
    if (typeof tableLoading.enabled !== 'boolean') {
      console.warn('[Step1] table_loading.enabled должен быть boolean, пропускаем загрузку таблиц');
      return null;
    }

    if (!tableLoading.enabled) {
      console.log('[Step1] Загрузка таблиц отключена в конфигурации (table_loading.enabled = false)');
      return { enabled: false, schema: null, includePatterns: [], excludePatterns: [], excludeNames: [] };
    }

    if (!tableLoading.schema || typeof tableLoading.schema !== 'string') {
      console.warn('[Step1] table_loading.schema обязателен и должен быть строкой, пропускаем загрузку таблиц');
      return null;
    }

    // Извлекаем настройки с дефолтными значениями
    // include_patterns - приоритетнее exclude_patterns (SQL LIKE паттерны для включения)
    const includePatterns = Array.isArray(tableLoading.include_patterns)
      ? tableLoading.include_patterns.filter(p => typeof p === 'string')
      : [];

    const excludePatterns = Array.isArray(tableLoading.exclude_patterns) 
      ? tableLoading.exclude_patterns.filter(p => typeof p === 'string')
      : [];
    
    const excludeNames = Array.isArray(tableLoading.exclude_names)
      ? tableLoading.exclude_names.filter(n => typeof n === 'string')
      : [];

    return {
      enabled: true,
      schema: tableLoading.schema,
      includePatterns: includePatterns,
      excludePatterns: excludePatterns,
      excludeNames: excludeNames
    };
  } catch (error) {
    console.error(`[Step1] Ошибка парсинга YAML из custom_settings: ${error.message}`);
    return null;
  }
}

/**
 * Парсинг настроек загрузки функций из YAML строки custom_settings
 * @param {string|null} customSettingsYaml - YAML строка из metadata.custom_settings
 * @returns {object} Объект с настройками { enabled } (по умолчанию enabled: true)
 */
function parseFunctionsLoadingConfig(customSettingsYaml) {
  if (!customSettingsYaml || typeof customSettingsYaml !== 'string' || customSettingsYaml.trim() === '') {
    return { enabled: true }; // По умолчанию включено
  }

  try {
    const parsed = yaml.load(customSettingsYaml);
    
    if (!parsed || typeof parsed !== 'object') {
      return { enabled: true }; // Секция отсутствует — включено
    }

    const functionsLoading = parsed.functions_loading;
    
    if (!functionsLoading || typeof functionsLoading !== 'object') {
      return { enabled: true }; // Секция отсутствует — включено
    }

    if (typeof functionsLoading.enabled !== 'boolean') {
      return { enabled: true };
    }

    return { enabled: functionsLoading.enabled };
  } catch (error) {
    console.error(`[Step1] Ошибка парсинга YAML из custom_settings для functions_loading: ${error.message}`);
    return { enabled: true }; // При ошибке парсинга — включено (безопасное поведение)
  }
}

/**
 * Парсинг настроек загрузки JS файлов из YAML строки custom_settings
 * @param {string|null} customSettingsYaml - YAML строка из metadata.custom_settings
 * @returns {object} Объект с настройками { enabled } (по умолчанию enabled: false для обратной совместимости)
 */
function parseJsLoadingConfig(customSettingsYaml) {
  if (!customSettingsYaml || typeof customSettingsYaml !== 'string' || customSettingsYaml.trim() === '') {
    return { enabled: false }; // По умолчанию отключено (обратная совместимость)
  }

  try {
    const parsed = yaml.load(customSettingsYaml);
    
    if (!parsed || typeof parsed !== 'object') {
      return { enabled: false };
    }

    const jsLoading = parsed.js_loading;
    
    if (!jsLoading || typeof jsLoading !== 'object') {
      return { enabled: false };
    }

    if (typeof jsLoading.enabled !== 'boolean') {
      return { enabled: false };
    }

    return { enabled: jsLoading.enabled };
  } catch (error) {
    console.error(`[Step1] Ошибка парсинга YAML из custom_settings для js_loading: ${error.message}`);
    return { enabled: false };
  }
}

/**
 * Парсинг настроек загрузки TS файлов из YAML строки custom_settings
 * @param {string|null} customSettingsYaml - YAML строка из metadata.custom_settings
 * @returns {object} Объект с настройками { enabled } (по умолчанию enabled: false для обратной совместимости)
 */
function parseTsLoadingConfig(customSettingsYaml) {
  if (!customSettingsYaml || typeof customSettingsYaml !== 'string' || customSettingsYaml.trim() === '') {
    return { enabled: false }; // По умолчанию отключено (обратная совместимость)
  }

  try {
    const parsed = yaml.load(customSettingsYaml);
    
    if (!parsed || typeof parsed !== 'object') {
      return { enabled: false };
    }

    const tsLoading = parsed.ts_loading;
    
    if (!tsLoading || typeof tsLoading !== 'object') {
      return { enabled: false };
    }

    if (typeof tsLoading.enabled !== 'boolean') {
      return { enabled: false };
    }

    return { enabled: tsLoading.enabled };
  } catch (error) {
    console.error(`[Step1] Ошибка парсинга YAML из custom_settings для ts_loading: ${error.message}`);
    return { enabled: false };
  }
}

/**
 * Запуск шага 1 pipeline: загрузка SQL-функций и схем таблиц
 * Теперь полностью использует KnowledgeBaseConfig (rootPath, masks, fileSelection)
 *
 * @param {string} contextCode
 * @param {string} sessionId - Уникальный ID сессии для привязки логов
 * @param {DbService} dbService
 * @param {PipelineStateManager} pipelineState
 * @param {PipelineHistoryManager} pipelineHistory
 */
async function runStep1(contextCode, sessionId, dbService, pipelineState, pipelineHistory = null) {
  // Создаём логгер для сбора логов с sessionId
  const logger = createStepLogger('[Step1]', sessionId);
  
  // 1. Получаем актуальную конфигурацию проекта
  let kbConfig;
  try {
    kbConfig = await kbConfigService.getConfig(contextCode);
  } catch (err) {
    throw new Error(`Не удалось загрузить конфигурацию для контекста ${contextCode}: ${err.message}`);
  }

  const rootPath = kbConfig.rootPath;
  const includeMask = (kbConfig.includeMask || '').trim() || '**/*.sql';
  const ignorePatterns = (kbConfig.ignorePatterns || '').trim();
  const fileSelection = kbConfig.fileSelection || [];

  if (!fs.existsSync(rootPath)) {
    throw new Error(`Root path не существует или недоступен: ${rootPath}`);
  }

  logger.log(`Запуск для контекста "${contextCode}"`);
  logger.log(`rootPath: ${rootPath}`);
  logger.log(`includeMask: "${includeMask}"`);
  logger.log(`ignorePatterns: "${ignorePatterns}"`);
  logger.log(`fileSelection: ${fileSelection.length} файлов`);

  const tasks = [];

  // Получаем custom_settings для проверки функций, JS, TS и таблиц
  const customSettings = kbConfig.metadata?.custom_settings || null;
  const functionsLoadingConfig = parseFunctionsLoadingConfig(customSettings);
  const jsLoadingConfig = parseJsLoadingConfig(customSettings);
  const tsLoadingConfig = parseTsLoadingConfig(customSettings);

  // Подготовка матчеров (используем общие функции для синхронизации с /api/project/tree)
  const { includeMatcher, ignoreMatchers } = createMatchers(includeMask, ignorePatterns);

  function isIgnored(relativePath) {
    return checkIgnored(relativePath, ignoreMatchers);
  }

  let sqlFilePaths = [];

  // === Сканирование SQL-файлов (если включено) ===
  if (functionsLoadingConfig.enabled) {
    // === Режим 1: Точный выбор файлов (приоритет по контракту) ===
    if (fileSelection.length > 0) {
      logger.log(`Режим: точный выбор файлов (${fileSelection.length} шт.)`);

      for (const relPath of fileSelection) {
        // relPath уже с ./ в начале (по контракту)
        const cleanRel = relPath.startsWith('./') ? relPath.slice(2) : relPath;
        const absPath = path.join(rootPath, cleanRel);

        if (!fs.existsSync(absPath)) {
          logger.warn(`Файл из fileSelection не найден: ${relPath}`);
          continue;
        }

        if (!absPath.toLowerCase().endsWith('.sql')) {
          logger.warn(`Пропущен не-SQL файл из fileSelection: ${relPath}`);
          continue;
        }

        if (isIgnored(relPath)) {
          logger.warn(`Файл из fileSelection игнорируется по ignorePatterns: ${relPath}`);
          continue;
        }

        sqlFilePaths.push(absPath);
      }
    } 
    // === Режим 2: Glob-маски ===
    else {
      logger.log(`Режим: сканирование по glob-маскам`);

      function scanDirectory(currentDir, baseRelPath = '.') {
        if (!fs.existsSync(currentDir)) return;

        const entries = fs.readdirSync(currentDir);
        for (const entry of entries) {
          const absPath = path.join(currentDir, entry);
          const relPath = path.join(baseRelPath, entry).replace(/\\/g, '/');
          const fullRelPath = normalizeRelativePath(relPath);

          try {
            const stats = fs.statSync(absPath);

            if (stats.isDirectory()) {
              if (!isIgnored(fullRelPath)) {
                scanDirectory(absPath, relPath);
              }
            } else if (stats.isFile() && absPath.toLowerCase().endsWith('.sql')) {
              if (isIgnored(fullRelPath)) {
                continue;
              }
              if (checkIncluded(fullRelPath, includeMatcher)) {
                sqlFilePaths.push(absPath);
              }
            }
          } catch (err) {
            logger.warn(`Ошибка доступа к ${absPath}: ${err.message}`);
          }
        }
      }

      scanDirectory(rootPath, '.');
    }

    // Добавляем найденные SQL-файлы в задачи
    logger.log(`Найдено ${sqlFilePaths.length} SQL-файлов для обработки`);
    for (const filePath of sqlFilePaths) {
      tasks.push({
        type: 'sql',
        path: filePath,
        name: path.basename(filePath)
      });
    }
  } else {
    logger.log('Загрузка функций отключена в конфигурации (functions_loading.enabled = false)');
  }

  // === Сканирование JS-файлов (если включено) ===
  let jsFilePaths = [];
  
  if (jsLoadingConfig.enabled) {
    logger.log('Сканирование JS файлов включено');
    
    // === Режим 1: Точный выбор файлов ===
    if (fileSelection.length > 0) {
      for (const relPath of fileSelection) {
        const cleanRel = relPath.startsWith('./') ? relPath.slice(2) : relPath;
        const absPath = path.join(rootPath, cleanRel);

        if (!fs.existsSync(absPath)) continue;
        if (!absPath.toLowerCase().endsWith('.js')) continue;
        if (isIgnored(relPath)) continue;

        jsFilePaths.push(absPath);
      }
    } 
    // === Режим 2: Glob-маски ===
    else {
      function scanDirectoryForJs(currentDir, baseRelPath = '.') {
        if (!fs.existsSync(currentDir)) return;

        const entries = fs.readdirSync(currentDir);
        for (const entry of entries) {
          const absPath = path.join(currentDir, entry);
          const relPath = path.join(baseRelPath, entry).replace(/\\/g, '/');
          const fullRelPath = normalizeRelativePath(relPath);

          try {
            const stats = fs.statSync(absPath);

            if (stats.isDirectory()) {
              if (!isIgnored(fullRelPath)) {
                scanDirectoryForJs(absPath, relPath);
              }
            } else if (stats.isFile() && absPath.toLowerCase().endsWith('.js')) {
              if (isIgnored(fullRelPath)) continue;
              jsFilePaths.push(absPath);
            }
          } catch (err) {
            logger.warn(`Ошибка доступа к ${absPath}: ${err.message}`);
          }
        }
      }

      scanDirectoryForJs(rootPath, '.');
    }

    logger.log(`Найдено ${jsFilePaths.length} JS-файлов для обработки`);
    for (const filePath of jsFilePaths) {
      tasks.push({
        type: 'js',
        path: filePath,
        name: path.basename(filePath)
      });
    }
  } else {
    logger.log('Загрузка JS файлов отключена (js_loading.enabled = false или не настроено)');
  }

  // === Сканирование TS-файлов (если включено) ===
  let tsFilePaths = [];
  
  if (tsLoadingConfig.enabled) {
    logger.log('Сканирование TS файлов включено');
    
    // === Режим 1: Точный выбор файлов ===
    if (fileSelection.length > 0) {
      for (const relPath of fileSelection) {
        const cleanRel = relPath.startsWith('./') ? relPath.slice(2) : relPath;
        const absPath = path.join(rootPath, cleanRel);

        if (!fs.existsSync(absPath)) continue;
        const lower = absPath.toLowerCase();
        if (!lower.endsWith('.ts') && !lower.endsWith('.tsx')) continue;
        if (lower.endsWith('.d.ts')) continue; // Пропускаем declaration файлы
        if (isIgnored(relPath)) continue;

        tsFilePaths.push(absPath);
      }
    } 
    // === Режим 2: Glob-маски ===
    else {
      function scanDirectoryForTs(currentDir, baseRelPath = '.') {
        if (!fs.existsSync(currentDir)) return;

        const entries = fs.readdirSync(currentDir);
        for (const entry of entries) {
          const absPath = path.join(currentDir, entry);
          const relPath = path.join(baseRelPath, entry).replace(/\\/g, '/');
          const fullRelPath = normalizeRelativePath(relPath);

          try {
            const stats = fs.statSync(absPath);

            if (stats.isDirectory()) {
              if (!isIgnored(fullRelPath)) {
                scanDirectoryForTs(absPath, relPath);
              }
            } else if (stats.isFile()) {
              const lower = absPath.toLowerCase();
              if ((lower.endsWith('.ts') || lower.endsWith('.tsx')) && !lower.endsWith('.d.ts')) {
                if (isIgnored(fullRelPath)) continue;
                tsFilePaths.push(absPath);
              }
            }
          } catch (err) {
            logger.warn(`Ошибка доступа к ${absPath}: ${err.message}`);
          }
        }
      }

      scanDirectoryForTs(rootPath, '.');
    }

    logger.log(`Найдено ${tsFilePaths.length} TS-файлов для обработки`);
    for (const filePath of tsFilePaths) {
      tasks.push({
        type: 'ts',
        path: filePath,
        name: path.basename(filePath)
      });
    }
  } else {
    logger.log('Загрузка TS файлов отключена (ts_loading.enabled = false или не настроено)');
  }

  // === Обработка таблиц из custom_settings (YAML) ===
  let allTables = [];
  
  // Парсим настройки загрузки таблиц из metadata.custom_settings
  const tableLoadingConfig = parseTableLoadingConfig(customSettings);

  if (tableLoadingConfig && tableLoadingConfig.enabled) {
    try {
      logger.log(`Загрузка таблиц из схемы "${tableLoadingConfig.schema}"`);
      logger.log(`Включаемые паттерны: ${tableLoadingConfig.includePatterns.join(', ') || '(все)'}`);
      logger.log(`Исключаемые паттерны: ${tableLoadingConfig.excludePatterns.join(', ') || '(нет)'}`);
      logger.log(`Исключаемые имена: ${tableLoadingConfig.excludeNames.join(', ') || '(нет)'}`);

      allTables = await getFilteredTableNames(
        tableLoadingConfig.schema,
        tableLoadingConfig.includePatterns,
        tableLoadingConfig.excludePatterns,
        tableLoadingConfig.excludeNames
      );

      logger.log(`Найдено ${allTables.length} таблиц для загрузки`);
    } catch (err) {
      logger.error(`Ошибка при получении списка таблиц: ${err.message}`);
      // Ошибка будет добавлена в report позже, если потребуется
    }

    // Добавляем найденные таблицы в задачи
    for (const tableName of allTables) {
      const fullName = `${tableLoadingConfig.schema}.${tableName}`;
      tasks.push({
        type: 'table',
        name: fullName
      });
    }
  } else if (tableLoadingConfig && !tableLoadingConfig.enabled) {
    logger.log('Загрузка таблиц отключена в конфигурации');
  } else {
    logger.log('Настройки загрузки таблиц не найдены в custom_settings, пропускаем загрузку таблиц');
  }

  // Обновляем общее количество задач
  pipelineState.updateStep(1, {
    totalItems: tasks.length,
    itemsProcessed: 0,
    progress: 0
  });

  if (pipelineHistory) {
    pipelineHistory.addHistoryEntry(contextCode, 1, pipelineState.getStep(1));
  }

  logger.log(`=====================`);
  logger.log(`Всего задач: ${tasks.length} (${sqlFilePaths.length} SQL + ${jsFilePaths.length} JS + ${tsFilePaths.length} TS + ${allTables.length} таблиц)`);
  logger.log(`=====================`);

  // === Инициализация отчета ===
  const report = {
    summary: {
      totalFiles: 0,
      totalTables: 0,
      totalFunctions: 0,
      totalAiItems: 0,
      totalChunks: 0,
      errors: 0,
      skipped: 0
    },
    details: {
      sqlFiles: [],
      jsFiles: [],
      tsFiles: [],
      tables: [],
      errors: []
    }
  };

  // === Выполнение задач (без изменений) ===
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    try {
      if (task.type === 'sql') {
        const fileReport = await loadSqlFunctionsFromFile(task.path, contextCode, dbService, pipelineState);

        if (fileReport) {
          report.details.sqlFiles.push(fileReport);

          if (fileReport.fileId) {
            report.summary.totalFiles++;
            report.summary.totalFunctions += fileReport.functionsProcessed || 0;

            fileReport.functions.forEach(func => {
              if (func.aiItemId) report.summary.totalAiItems++;
              if (func.chunkL0Id || func.chunkL1Id) report.summary.totalChunks++;
            });
          } else {
            report.summary.skipped++;
          }

          // Ошибки из файла и функций
          if (fileReport.errors?.length > 0) {
            report.summary.errors += fileReport.errors.length;
            fileReport.errors.forEach(err => report.details.errors.push({ type: 'sql', name: fileReport.filename, message: err }));
          }
          fileReport.functions.forEach(func => {
            if (func.errors?.length > 0) {
              report.summary.errors += func.errors.length;
              func.errors.forEach(err => report.details.errors.push({ type: 'sql', name: `${fileReport.filename}:${func.full_name}`, message: err }));
            }
          });
        } else {
          report.summary.skipped++;
        }
      } else if (task.type === 'js') {
        const fileReport = await loadJsFunctionsFromFile(task.path, contextCode, dbService, pipelineState);

        if (fileReport) {
          report.details.jsFiles.push(fileReport);

          if (fileReport.fileId) {
            report.summary.totalFiles++;
            report.summary.totalFunctions += fileReport.functionsProcessed || 0;

            fileReport.functions.forEach(func => {
              if (func.aiItemId) report.summary.totalAiItems++;
              if (func.chunkL0Id || func.chunkL1Id) report.summary.totalChunks++;
            });
          } else {
            report.summary.skipped++;
          }

          // Ошибки из файла и функций
          if (fileReport.errors?.length > 0) {
            report.summary.errors += fileReport.errors.length;
            fileReport.errors.forEach(err => report.details.errors.push({ type: 'js', name: fileReport.filename, message: err }));
          }
          fileReport.functions.forEach(func => {
            if (func.errors?.length > 0) {
              report.summary.errors += func.errors.length;
              func.errors.forEach(err => report.details.errors.push({ type: 'js', name: `${fileReport.filename}:${func.full_name}`, message: err }));
            }
          });
        } else {
          report.summary.skipped++;
        }
      } else if (task.type === 'ts') {
        const fileReport = await loadTsFunctionsFromFile(task.path, contextCode, dbService, pipelineState);

        if (fileReport) {
          report.details.tsFiles.push(fileReport);

          if (fileReport.fileId) {
            report.summary.totalFiles++;
            report.summary.totalFunctions += fileReport.functionsProcessed || 0;

            fileReport.functions.forEach(func => {
              if (func.aiItemId) report.summary.totalAiItems++;
              if (func.chunkL0Id || func.chunkL1Id) report.summary.totalChunks++;
            });
          } else {
            report.summary.skipped++;
          }

          // Ошибки из файла и функций
          if (fileReport.errors?.length > 0) {
            report.summary.errors += fileReport.errors.length;
            fileReport.errors.forEach(err => report.details.errors.push({ type: 'ts', name: fileReport.filename, message: err }));
          }
          fileReport.functions.forEach(func => {
            if (func.errors?.length > 0) {
              report.summary.errors += func.errors.length;
              func.errors.forEach(err => report.details.errors.push({ type: 'ts', name: `${fileReport.filename}:${func.full_name}`, message: err }));
            }
          });
        } else {
          report.summary.skipped++;
        }
      } else if (task.type === 'table') {
        logger.log(`----${task.name}-----`);
        const tableReport = await loadTableSchema(task.name, contextCode, dbService, pipelineState);
        logger.log(`---------------------`);

        if (tableReport) {
          report.details.tables.push(tableReport);

          if (tableReport.fileId) {
            report.summary.totalTables++;
            if (tableReport.aiItemId) report.summary.totalAiItems++;
            if (tableReport.chunkId) report.summary.totalChunks++;
          } else {
            report.summary.skipped++;
          }

          if (tableReport.errors?.length > 0) {
            report.summary.errors += tableReport.errors.length;
            tableReport.errors.forEach(err => report.details.errors.push({ type: 'table', name: tableReport.fullName, message: err }));
          }
        } else {
          report.summary.skipped++;
        }
      }

      pipelineState.incrementItemsProcessed(1);

      if (pipelineHistory && (i + 1) % 10 === 0) {
        pipelineHistory.addHistoryEntry(contextCode, 1, pipelineState.getStep(1));
      }
    } catch (err) {
      logger.error(`Ошибка обработки ${task.type} "${task.name}": ${err.message}`);

      report.summary.errors++;
      report.details.errors.push({
        type: task.type,
        name: task.name,
        message: err.message,
        timestamp: new Date().toISOString()
      });

      pipelineState.incrementItemsProcessed(1);
    }
  }

  logger.log(`Шаг 1 завершён для контекста ${contextCode}`);
  logger.log(`Отчёт: ${report.summary.totalFiles} файлов, ${report.summary.totalTables} таблиц, ${report.summary.totalAiItems} AI Items, ${report.summary.errors} ошибок`);

  // Добавляем логи в report
  report.logs = logger.getLogs();

  // Завершение шага
  pipelineState.updateStep(1, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    report
  });

  if (pipelineHistory) {
    pipelineHistory.addHistoryEntry(contextCode, 1, pipelineState.getStep(1));
  }
}

module.exports = { runStep1 };
