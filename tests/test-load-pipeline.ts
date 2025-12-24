// test-load-pipeline.ts
// Запуск: bun tests/test-load-pipeline.ts
//  тестовая конфигурация для загрузки pipeline
// ```json
// {
//     "rootPath": "C:\\ERV\\projects-ex\\aian-vector\\client",
//     "includeMask": "**/*.sql",
//     "ignorePatterns": "**/node_modules/**,**/venv/**,**/__pycache__/**,**/dist/**,**/.git/**",
//     "fileSelection": [],
//     "lastUpdated": "2025-12-21T06:26:03.564Z",
//     "metadata": {
//       "projectName": "New Project",
//       "description": "RAG knowledge base",
//       "tags": [],
//       "custom_settings": "table_loading:\n  enabled: true\n  schema: carl_data\n  include_patterns:\n    - \"%hol%\"\n  exclude_patterns:\n    - \"\\\\_%\"\n  exclude_names:\n    - \"a\"\n    - \"auction_b20210519\"\n    - \"test_table\""
//     }
//   }
//```

import { fetch } from 'bun';

const BASE_URL = 'http://localhost:3200'; // или твой порт
const CONTEXT_CODE = 'TEST';

// Цвета для консоли
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

// Ожидаемые функции (реальные имена из api_auct_sort.sql)
const EXPECTED_FUNCTIONS = [
  'calcAuctPriority',
  '_getDtEndForSort',
  '_getQueSortNumForSort',
];

// Ожидаем минимум одну таблицу (даже если CREATE TABLE нет — парсер может вытащить из зависимостей)
const EXPECTED_MIN_TABLES = 1;

async function apiPost(endpoint: string, body: any, contextCode?: string) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (contextCode) url.searchParams.set('context-code', contextCode);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`POST ${endpoint} failed: ${res.status} - ${errorText}`);
  }
  return res.json();
}

async function apiGet(endpoint: string, contextCode?: string) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (contextCode) url.searchParams.set('context-code', contextCode);
  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GET ${endpoint} failed: ${res.status} - ${errorText}`);
  }
  return res.json();
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForStep(stepId: number, maxAttempts = 300) {
  let lastProgress = -1;
  let attempts = 0;

  while (attempts < maxAttempts) {
    await delay(2000);
    attempts++;

    const statusRes = await apiGet('/api/pipeline/steps/status', CONTEXT_CODE);
    const steps = statusRes.steps || [];
    const step = steps.find((s: any) => s.id === stepId);

    if (!step) throw new Error(`Шаг ${stepId} не найден в статусе`);

    const progress = step.progress ?? 0;

    if (progress !== lastProgress) {
      console.log(`  Шаг ${stepId}: ${progress}% (${step.status})`);
      lastProgress = progress;
    }

    if (step.status === 'failed') {
      throw new Error(`Шаг ${stepId} завершился с ошибкой: ${step.error || 'Unknown error'}`);
    }

    if (step.status === 'completed') {
      console.log(green(`✓ Шаг ${stepId} завершён успешно!`));
      
      // Выводим логи из report, если они есть
      if (step.report?.logs && Array.isArray(step.report.logs)) {
        console.log(yellow(`\nЛоги шага ${stepId} (${step.report.logs.length} записей):`));
        step.report.logs.forEach((log: any) => {
          const level = log.level === 'error' ? red : log.level === 'warn' ? yellow : (s: string) => s;
          console.log(`  ${level(log.message)}`);
        });
        
        // Выводим summary из report
        if (step.report.summary) {
          const s = step.report.summary;
          console.log(yellow(`\nИтоги шага ${stepId}:`));
          if (s.totalFiles !== undefined) console.log(`  Файлов обработано: ${s.totalFiles}`);
          if (s.totalTables !== undefined) console.log(`  Таблиц загружено: ${s.totalTables}`);
          if (s.totalFunctions !== undefined) console.log(`  Функций найдено: ${s.totalFunctions}`);
          if (s.totalAiItems !== undefined) console.log(`  AI Items создано: ${s.totalAiItems}`);
          if (s.totalChunks !== undefined) console.log(`  Чанков создано: ${s.totalChunks}`);
          if (s.errors !== undefined && s.errors > 0) console.log(red(`  Ошибок: ${s.errors}`));
          if (s.skipped !== undefined && s.skipped > 0) console.log(yellow(`  Пропущено: ${s.skipped}`));
        }
      }
      
      return step;
    }

    if (attempts > 5 && step.status === 'pending') {
      throw new Error(`Шаг ${stepId} не запустился - остаётся в pending`);
    }
  }

  throw new Error(`Шаг ${stepId} не завершился за ${maxAttempts * 2} секунд`);
}

async function main() {
  console.log(yellow(`\n=== ТЕСТ ЗАГРУЗКИ ШАГОВ 1 И 2 PIPELINE ===\n`));
  console.log(`Контекст: ${CONTEXT_CODE}`);
  console.log(`Ожидаем: ${EXPECTED_FUNCTIONS.length} функций и минимум ${EXPECTED_MIN_TABLES} таблицу\n`);

  // 0. Получаем и выводим конфигурацию
  console.log(yellow('=== КОНФИГУРАЦИЯ ==='));
  try {
    const configRes = await apiGet('/api/kb-config', CONTEXT_CODE);
    const config = configRes.config || {};
    
    console.log(`rootPath: ${config.rootPath || 'N/A'}`);
    console.log(`includeMask: ${config.includeMask || 'N/A'}`);
    console.log(`ignorePatterns: ${config.ignorePatterns || 'N/A'}`);
    console.log(`fileSelection: ${Array.isArray(config.fileSelection) ? config.fileSelection.length + ' файлов' : 'N/A'}`);
    
    if (config.fileSelection && config.fileSelection.length > 0) {
      console.log(`  Файлы: ${config.fileSelection.slice(0, 5).join(', ')}${config.fileSelection.length > 5 ? '...' : ''}`);
    }
    
    if (config.metadata?.custom_settings) {
      console.log(`custom_settings: присутствует`);
      // Пытаемся распарсить YAML (опционально, если js-yaml доступен)
      try {
        // В Bun можно использовать встроенный парсер или просто показать как есть
        const settingsStr = config.metadata.custom_settings;
        // Простой парсинг для table_loading.enabled
        if (settingsStr.includes('table_loading:')) {
          const enabledMatch = settingsStr.match(/enabled:\s*(true|false)/);
          const schemaMatch = settingsStr.match(/schema:\s*"([^"]+)"/);
          if (enabledMatch) console.log(`  table_loading.enabled: ${enabledMatch[1]}`);
          if (schemaMatch) console.log(`  table_loading.schema: ${schemaMatch[1]}`);
          
          // Паттерны
          const includeMatch = settingsStr.match(/include_patterns:\s*\n\s*-\s*"([^"]+)"/);
          const excludeMatch = settingsStr.match(/exclude_patterns:\s*\n\s*-\s*"([^"]+)"/);
          if (includeMatch) console.log(`  include_patterns: ${includeMatch[1]}`);
          if (excludeMatch) console.log(`  exclude_patterns: ${excludeMatch[1]}`);
        }
        if (settingsStr.includes('functions_loading:')) {
          const funcEnabledMatch = settingsStr.match(/functions_loading:\s*\n\s*enabled:\s*(true|false)/);
          if (funcEnabledMatch) console.log(`  functions_loading.enabled: ${funcEnabledMatch[1]}`);
        }
      } catch (e) {
        console.log(`  (ошибка парсинга)`);
      }
    } else {
      console.log(`custom_settings: отсутствует`);
    }
    console.log('');
  } catch (err) {
    console.log(red(`Ошибка получения конфигурации: ${err.message}`));
    console.log('');
  }

  // 1. Запуск шага 1 (Polyglot Parsing L0)
  console.log(yellow('=== ШАГ 1: Polyglot Parsing (L0) ==='));
  console.log('Запускаем...');
  await apiPost('/api/pipeline/step/1/run', {}, CONTEXT_CODE);
  await waitForStep(1);

  // 2. Запуск шага 2 (Dependencies Extraction L1)
  console.log(yellow('\n=== ШАГ 2: Dependencies Extraction (L1) ==='));
  console.log('Запускаем...');
  await apiPost('/api/pipeline/step/2/run', {}, CONTEXT_CODE);
  await waitForStep(2);

  console.log(green('\n✓ Шаги 1 и 2 успешно завершены!'));

  // 3. Проверка AiItems
  const items = await apiGet('/api/items', CONTEXT_CODE);
  const functions = items.filter(i => i.type === 'function' || i.type === 'procedure');
  const tables = items.filter(i => i.type === 'table');

  console.log(`\nНайдено AiItems: ${items.length}`);
  console.log(`  Функций: ${functions.length}`);
  console.log(`  Таблиц: ${tables.length}`);

  // Проверка функций
  const foundFunctionNames = functions.map(f => 
    f.sName || f.full_name?.split('.').pop() || f.id?.split('.').pop() || 'unknown'
  );

  const missing = EXPECTED_FUNCTIONS.filter(name => !foundFunctionNames.includes(name));
  if (missing.length > 0) {
    console.log(red(`ОШИБКА: Не найдены функции: ${missing.join(', ')}`));
    console.log(yellow(`Найденные: ${foundFunctionNames.slice(0, 10).join(', ')}${foundFunctionNames.length > 10 ? '...' : ''}`));
    process.exit(1);
  }
  console.log(green(`✓ Найдены все ожидаемые функции: ${EXPECTED_FUNCTIONS.join(', ')}`));

  // Проверка таблиц
  if (tables.length < EXPECTED_MIN_TABLES) {
    console.log(red(`ОШИБКА: Найдено только ${tables.length} таблиц, ожидалось минимум ${EXPECTED_MIN_TABLES}`));
    process.exit(1);
  }
  console.log(green(`✓ Найдено ${tables.length} таблиц`));

  // Проверка наличия тела функций
  const emptyFunctions = functions.filter(f => !f.l0_code || f.l0_code.trim() === '');
  if (emptyFunctions.length > 0) {
    console.log(yellow(`Предупреждение: ${emptyFunctions.length} функций без тела (l0_code):`));
    emptyFunctions.forEach(f => {
      const name = f.sName || f.full_name?.split('.').pop() || f.id?.split('.').pop() || 'unknown';
      console.log(yellow(`  - ${name}`));
    });
  } else {
    console.log(green(`✓ У всех функций есть тело (l0_code)`));
  }

  console.log(green('\n=== ТЕСТ ПРОШЁЛ УСПЕШНО! ==='));
}

main().catch(err => {
  console.error(red(`\nОШИБКА ТЕСТА: ${err.message}`));
  console.error(err.stack);
  process.exit(1);
});