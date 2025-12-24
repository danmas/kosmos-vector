const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3005';

async function runTests() {
  console.log('--- Запуск тестов для Server v2 ---');

  try {
    // Тест 1: Health Check
    console.log('Тест 1: Проверка доступности сервера (ожидаем 404)');
    const res404 = await fetch(`${BASE_URL}/non-existent-route`);
    if (res404.status === 404) {
      console.log('  [SUCCESS] Сервер ответил с кодом 404, как и ожидалось.');
    } else {
      console.error(`  [FAILURE] Ожидался код 404, но получен ${res404.status}`);
    }

    // Тест 2: Получение списка файлов
    console.log('\nТест 2: Получение списка файлов (GET /files)');
    const filesRes = await fetch(`${BASE_URL}/files`);
    if (filesRes.ok) {
        const files = await filesRes.json();
        console.log(`  [SUCCESS] Получено ${files.length} файлов.`);
        if (files.length > 0) {
            console.log(`    Пример файла: ${files[0].filename}`);
        }
    } else {
        console.error(`  [FAILURE] Ошибка при запросе /files: ${filesRes.status}`);
    }

    // Тест 3: Получение кодов контекста
    console.log('\nТест 3: Получение кодов контекста (GET /context-codes)');
    const codesRes = await fetch(`${BASE_URL}/context-codes`);
    if (codesRes.ok) {
        const codes = await codesRes.json();
        console.log(`  [SUCCESS] Получены коды контекста: ${codes.join(', ')}`);
    } else {
        console.error(`  [FAILURE] Ошибка при запросе /context-codes: ${codesRes.status}`);
    }

    // Тест 4: Запрос к RAG
    console.log('\nТест 4: Запрос к RAG (POST /ask)');
    const askRes = await fetch(`${BASE_URL}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'Что такое test?' })
    });
    if (askRes.ok) {
        const answer = await askRes.json();
        console.log(`  [SUCCESS] Получен ответ от RAG: "${answer.answer}"`);
    } else {
        console.error(`  [FAILURE] Ошибка при запросе /ask: ${askRes.status}`);
    }

  } catch (error) {
    console.error('\n[ERROR] Произошла критическая ошибка во время тестов:', error.message);
  }

  console.log('\n--- Тесты завершены ---');
}

runTests();
