// tests/test_file_content_api.js
// Тест для нового API endpoint GET /api/file-content
// Запуск: node tests/test_file_content_api.js

const path = require('path');

const API_BASE_URL = 'http://localhost:3200';
const CONTEXT_CODE = 'KOSMOS-VECTOR';

// Используем абсолютные пути
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEST_FILE_SERVER = path.join(PROJECT_ROOT, 'server.js');
const TEST_FILE_README = path.join(PROJECT_ROOT, 'README.md');
const TEST_FILE_PACKAGE = path.join(PROJECT_ROOT, 'package.json');

/**
 * Выполняет GET запрос к API
 */
async function apiGet(endpoint, contextCode = CONTEXT_CODE) {
  const url = new URL(endpoint, API_BASE_URL);
  url.searchParams.append('context-code', contextCode);
  
  console.log(`  [REQUEST] GET ${url.toString()}`);
  
  const response = await fetch(url.toString());
  const contentType = response.headers.get('content-type');
  
  if (contentType && contentType.includes('application/json')) {
    return await response.json();
  } else {
    return await response.text();
  }
}

/**
 * Выполняет GET запрос с дополнительными query параметрами
 */
async function apiGetWithParams(endpoint, params = {}, contextCode = CONTEXT_CODE) {
  const url = new URL(endpoint, API_BASE_URL);
  url.searchParams.append('context-code', contextCode);
  
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });
  
  console.log(`  [REQUEST] GET ${url.toString()}`);
  
  const response = await fetch(url.toString());
  
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    body: response.headers.get('content-type')?.includes('application/json') 
      ? await response.json() 
      : await response.text()
  };
}

console.log('═══════════════════════════════════════════════════════════');
console.log('  ТЕСТ API ENDPOINT: GET /api/file-content');
console.log('═══════════════════════════════════════════════════════════\n');

async function runTests() {
  try {
    console.log('[Тест 1] Проверка успешного получения содержимого файла...');
    console.log(`  Абсолютный путь: ${TEST_FILE_SERVER}`);
    const result1 = await apiGetWithParams('/api/file-content', {
      path: TEST_FILE_SERVER
    });
    
    if (result1.status === 200 && typeof result1.body === 'string' && result1.body.includes('require')) {
      console.log(`  ✅ УСПЕШНО: Файл получен, размер: ${result1.body.length} символов`);
      console.log(`  Content-Type: ${result1.contentType}`);
    } else {
      console.log(`  ❌ ОШИБКА: Статус ${result1.status}, тип ${typeof result1.body}`);
      console.log(`  Ответ:`, result1.body);
    }

    console.log('\n[Тест 2] Проверка ошибки 400: отсутствует параметр path...');
    const result2 = await apiGetWithParams('/api/file-content', {});
    
    if (result2.status === 400 && result2.body.error && result2.body.error.includes('path')) {
      console.log(`  ✅ УСПЕШНО: Получена ожидаемая ошибка 400`);
      console.log(`  Сообщение: ${result2.body.error}`);
    } else {
      console.log(`  ❌ ОШИБКА: Неожиданный ответ`);
      console.log(`  Ответ:`, result2.body);
    }

    console.log('\n[Тест 3] Проверка ошибки 404: файл не найден...');
    const nonexistentPath = path.join(PROJECT_ROOT, 'nonexistent-file-12345.txt');
    console.log(`  Тестовый путь: ${nonexistentPath}`);
    const result3 = await apiGetWithParams('/api/file-content', {
      path: nonexistentPath
    });
    
    if (result3.status === 404 && result3.body.error && result3.body.error.includes('not found')) {
      console.log(`  ✅ УСПЕШНО: Получена ожидаемая ошибка 404`);
      console.log(`  Сообщение: ${result3.body.error}`);
    } else {
      console.log(`  ❌ ОШИБКА: Неожиданный ответ`);
      console.log(`  Ответ:`, result3.body);
    }

    console.log('\n[Тест 4] Проверка защиты от path traversal (попытка выйти за rootPath)...');
    // Пытаемся получить файл за пределами PROJECT_ROOT
    const outsidePath = path.resolve(PROJECT_ROOT, '..', '..', 'etc', 'passwd');
    console.log(`  Тестовый путь вне rootPath: ${outsidePath}`);
    const result4 = await apiGetWithParams('/api/file-content', {
      path: outsidePath
    });
    
    if (result4.status === 403 || result4.status === 404) {
      console.log(`  ✅ УСПЕШНО: Доступ запрещён или файл не найден (статус ${result4.status})`);
      console.log(`  Сообщение: ${result4.body.error || 'N/A'}`);
    } else {
      console.log(`  ❌ ОШИБКА: Path traversal не заблокирован!`);
      console.log(`  Статус: ${result4.status}`);
      console.log(`  Ответ:`, result4.body);
    }

    console.log('\n[Тест 5] Проверка получения файла из KB (README.md)...');
    console.log(`  Абсолютный путь: ${TEST_FILE_README}`);
    const result5 = await apiGetWithParams('/api/file-content', {
      path: TEST_FILE_README
    });
    
    if (result5.status === 200 && typeof result5.body === 'string' && result5.body.length > 100) {
      console.log(`  ✅ УСПЕШНО: README.md получен, размер: ${result5.body.length} символов`);
      console.log(`  Начало содержимого: ${result5.body.substring(0, 80)}...`);
    } else if (result5.status === 404) {
      console.log(`  ⚠️  ПРЕДУПРЕЖДЕНИЕ: README.md не найден (это нормально, если файл отсутствует)`);
    } else {
      console.log(`  ❌ ОШИБКА: Неожиданный ответ`);
      console.log(`  Статус: ${result5.status}`);
      console.log(`  Ответ:`, result5.body);
    }

    console.log('\n[Тест 6] Проверка получения файла из package.json...');
    console.log(`  Абсолютный путь: ${TEST_FILE_PACKAGE}`);
    const result6 = await apiGetWithParams('/api/file-content', {
      path: TEST_FILE_PACKAGE
    });
    
    if (result6.status === 200 && typeof result6.body === 'string') {
      try {
        const parsed = JSON.parse(result6.body);
        console.log(`  ✅ УСПЕШНО: package.json получен и валиден`);
        console.log(`  Название проекта: ${parsed.name || 'N/A'}`);
      } catch (e) {
        console.log(`  ⚠️  ПРЕДУПРЕЖДЕНИЕ: Файл получен, но JSON невалиден`);
      }
    } else if (result6.status === 404) {
      console.log(`  ⚠️  ПРЕДУПРЕЖДЕНИЕ: package.json не найден`);
    } else {
      console.log(`  ❌ ОШИБКА: Неожиданный ответ`);
      console.log(`  Статус: ${result6.status}`);
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  ТЕСТЫ ЗАВЕРШЕНЫ');
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ КРИТИЧЕСКАЯ ОШИБКА:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runTests();
