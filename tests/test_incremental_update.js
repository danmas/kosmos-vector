/**
 * Тест инкрементального обновления Step 1.
 * Два почти одинаковых файла (version_a.sql, version_b.sql):
 * - Загружаем version_a -> первая загрузка (created).
 * - Подменяем файл на version_b -> проверяем unchanged, updated, created, deleted.
 * - Запускаем Step1 ещё раз без изменений -> проверяем skipped (mtime/hash).
 *
 * Требования: сервер на BASE_URL, БД из .env.
 * Запуск: node tests/test_incremental_update.js
 */

require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3200';
const CONTEXT_CODE = 'INCR_UPDATE_TEST';

const dbConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE || 'postgres',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres'
    };

const PROJECT_DIR = path.join(process.cwd(), 'tests', 'incremental_test_project');
const TARGET_FILE = path.join(PROJECT_DIR, 'incr_functions.sql');
const FIXTURE_A = path.join(process.cwd(), 'tests', 'fixtures', 'incremental', 'version_a.sql');
const FIXTURE_B = path.join(process.cwd(), 'tests', 'fixtures', 'incremental', 'version_b.sql');
const KB_CONFIG_PATH = path.join(process.cwd(), 'kb-configs', `${CONTEXT_CODE}.json`);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureKbConfig() {
  ensureDir(path.dirname(KB_CONFIG_PATH));
  const rootPath = PROJECT_DIR.replace(/\//g, path.sep);
  const fileSelectionEntry = rootPath + path.sep + './incr_functions.sql';
  const config = {
    contextCode: CONTEXT_CODE,
    rootPath,
    includeMask: '**/*',
    ignorePatterns: '**/node_modules/**',
    fileSelection: [fileSelectionEntry],
    lastUpdated: new Date().toISOString(),
    metadata: {
      projectName: 'Incremental update test',
      description: 'Single SQL file for incremental Step1 tests',
      tags: [],
      custom_settings: 'functions_loading:\n  enabled: true\njs_loading:\n  enabled: false\nts_loading:\n  enabled: false\nphp_loading:\n  enabled: false\nddl_loading:\n  enabled: false\ntable_loading:\n  enabled: false'
    }
  };
  fs.writeFileSync(KB_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

async function cleanupContext() {
  const client = new Client(dbConfig);
  await client.connect();
  try {
    await client.query('DELETE FROM public.link WHERE context_code = $1', [CONTEXT_CODE]);
    await client.query('DELETE FROM public.ai_item WHERE context_code = $1', [CONTEXT_CODE]);
    await client.query('DELETE FROM public.files WHERE context_code = $1', [CONTEXT_CODE]);
  } finally {
    await client.end();
  }
}

async function waitForStepCompletion(stepNumber, maxWaitMs = 120000) {
  const start = Date.now();
  const poll = 2000;
  let lastLog = 0;
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`${BASE_URL}/api/pipeline/steps/status?context-code=${CONTEXT_CODE}`);
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const { steps } = await res.json();
    const step = steps.find(s => s.id === stepNumber);
    if (!step) throw new Error(`Step ${stepNumber} not found`);
    if (step.status === 'completed') return { success: true, step };
    if (step.status === 'failed') return { success: false, error: step.error };
    if (step.status === 'running' && Date.now() - lastLog > 10000) {
      console.log(`  ... Step${stepNumber} выполняется (${step.progress || 0}%), ждём до ${maxWaitMs / 1000}с`);
      lastLog = Date.now();
    }
    await new Promise(r => setTimeout(r, poll));
  }
  throw new Error(`Step ${stepNumber} timeout (${maxWaitMs / 1000}с)`);
}

function getStep1Report() {
  return fetch(`${BASE_URL}/api/pipeline/steps/status?context-code=${CONTEXT_CODE}`)
    .then(r => r.json())
    .then(data => {
      const step1 = data.steps && data.steps.find(s => s.id === 1);
      return step1 && step1.report ? step1.report.summary : null;
    });
}

async function runStep1(mode = 'incremental') {
  const url = `${BASE_URL}/api/pipeline/step/1/run?context-code=${encodeURIComponent(CONTEXT_CODE)}&mode=${mode}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`Step1: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Step1 failed');
}

async function run() {
  console.log('=== Тест инкрементального обновления (Step 1) ===\n');
  console.log('Контекст:', CONTEXT_CODE);
  console.log('URL:', BASE_URL);
  console.log('Файл:', TARGET_FILE);

  ensureDir(PROJECT_DIR);
  if (!fs.existsSync(FIXTURE_A)) throw new Error('Фикстура не найдена: ' + FIXTURE_A);
  if (!fs.existsSync(FIXTURE_B)) throw new Error('Фикстура не найдена: ' + FIXTURE_B);

  ensureKbConfig();
  await cleanupContext();

  // ---------- 1) Первая загрузка: version_a (3 функции: fa, fb, fd) ----------
  console.log('\n[1] Копируем version_a -> рабочий файл, запускаем Step1...');
  fs.copyFileSync(FIXTURE_A, TARGET_FILE);
  await runStep1('incremental');
  const done1 = await waitForStepCompletion(1);
  if (!done1.success) throw new Error('Step1 после version_a: ' + done1.error);
  const report1 = await getStep1Report();
  if (!report1) throw new Error('Нет отчёта Step1 после version_a');
  console.log('  Отчёт R1:', 'created=', report1.createdEntities, 'updated=', report1.updatedEntities, 'unchanged=', report1.skippedEntities, 'deleted=', report1.deletedEntities);
  if ((report1.createdEntities || 0) < 3) {
    throw new Error('Ожидалось минимум 3 созданных сущности (fa, fb, fd), получено: ' + (report1.createdEntities || 0));
  }

  // Пауза, чтобы сервер успел завершить все callback'и (saveSessionLogs и т.д.) перед вторым запуском
  await new Promise(r => setTimeout(r, 2500));

  // ---------- 2) Вторая загрузка: version_b (fa без изменений, fb изменён, fc добавлена, fd удалена) ----------
  console.log('\n[2] Копируем version_b -> рабочий файл, запускаем Step1...');
  fs.copyFileSync(FIXTURE_B, TARGET_FILE);
  await runStep1('incremental');
  const done2 = await waitForStepCompletion(1);
  if (!done2.success) throw new Error('Step1 после version_b: ' + done2.error);
  const report2 = await getStep1Report();
  if (!report2) throw new Error('Нет отчёта Step1 после version_b');
  console.log('  Отчёт R2:', 'created=', report2.createdEntities, 'updated=', report2.updatedEntities, 'unchanged=', report2.skippedEntities, 'deleted=', report2.deletedEntities);

  const unchanged = (report2.skippedEntities || 0) >= 1;
  const updated = (report2.updatedEntities || 0) >= 1;
  const created = (report2.createdEntities || 0) >= 1;
  const deleted = (report2.deletedEntities || 0) >= 1;

  if (!unchanged) throw new Error('Ожидалось >= 1 unchanged (fa), получено skippedEntities=' + (report2.skippedEntities || 0));
  if (!updated) throw new Error('Ожидалось >= 1 updated (fb), получено updatedEntities=' + (report2.updatedEntities || 0));
  if (!created) throw new Error('Ожидалось >= 1 created (fc), получено createdEntities=' + (report2.createdEntities || 0));
  if (!deleted) throw new Error('Ожидалось >= 1 deleted (fd), получено deletedEntities=' + (report2.deletedEntities || 0));

  // ---------- 3) Третий запуск без изменений файла: пропуск по mtime/hash ----------
  console.log('\n[3] Запускаем Step1 снова без изменений файла...');
  await runStep1('incremental');
  const done3 = await waitForStepCompletion(1);
  if (!done3.success) throw new Error('Step1 повторный: ' + done3.error);
  const report3 = await getStep1Report();
  const skippedFiles = (report3 && report3.skippedFiles) || 0;
  const skippedEntities = (report3 && report3.skippedEntities) || 0;
  console.log('  Отчёт R3:', 'skippedFiles=', skippedFiles, 'skippedEntities=', skippedEntities);
  if (skippedFiles < 1 && skippedEntities < 1) {
    throw new Error('Ожидался пропуск (skippedFiles или skippedEntities >= 1), получено skippedFiles=' + skippedFiles + ', skippedEntities=' + skippedEntities);
  }

  console.log('\n=== Все проверки инкрементального обновления пройдены ===');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
