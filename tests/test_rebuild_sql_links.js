/**
 * Тест для эндпоинта POST /api/items/:id/rebuild-sql-links
 * Проверяет загрузку модуля и при запущенном сервере — вызов API.
 *
 * Запуск: bun tests/test_rebuild_sql_links.js
 * Для вызова API нужен запущенный сервер и context-code (например CARL).
 */

require('dotenv').config();

const BASE_URL = (() => {
  let u = process.env.BASE_URL || 'http://127.0.0.1:3200';
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = `http://${u}`;
  if (!u.match(/:\d+(\/|$)/)) u = `${u}:3200`;
  return u.replace(/\/$/, '');
})();
const TEST_FULL_NAME = process.env.TEST_FULL_NAME || 'carl_inspect._getCityFromReport';
const TEST_CONTEXT = process.env.TEST_CONTEXT || 'CARL';

async function main() {
  console.log('1. Load rebuildSqlLinks module...');
  const { rebuildSqlLinksFromDb } = require('../routes/loaders/rebuildSqlLinks');
  if (typeof rebuildSqlLinksFromDb !== 'function') {
    console.error('FAIL: rebuildSqlLinksFromDb is not a function');
    process.exit(1);
  }
  console.log('   OK: rebuildSqlLinksFromDb is a function');

  const url = `${BASE_URL.replace(/\/$/, '')}/api/items/${encodeURIComponent(TEST_FULL_NAME)}/rebuild-sql-links?context-code=${encodeURIComponent(TEST_CONTEXT)}`;
  console.log('2. Call API:', url);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('   API error:', res.status, data.error || data);
      if (res.status === 404 && res.url.includes('rebuild-sql-links')) {
        console.error('   Tip: restart the server to load the new route.');
      }
      process.exit(1);
    }
    console.log('   OK:', data.success ? 'success' : 'failed', data.report ? `linksCreated=${data.report.linksCreated}` : '');
  } catch (err) {
    console.error('   Request failed (is server running?):', err.message);
    process.exit(1);
  }
  console.log('Done.');
}

main();
