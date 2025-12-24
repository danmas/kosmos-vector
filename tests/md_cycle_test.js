const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3005';
const TEST_FILE_NAME = 'README.md'; // <-- Изменено
// Путь теперь ведет в корень проекта
const TEST_FILE_PATH = path.join(__dirname, '..', TEST_FILE_NAME); 


async function runFullCycleTest() {
  console.log('--- Запуск комплексного E2E теста для MARKDOWN ---');
  
  // --- Шаг 1: Подготовка и предварительная очистка ---
  console.log(`\n[Шаг 1] Проверяем и удаляем файл '${TEST_FILE_NAME}', если он существует...`);
  try {
    const deleteRes = await fetch(`${BASE_URL}/file/${TEST_FILE_NAME}`, { method: 'DELETE' });
    if (deleteRes.ok) {
      const result = await deleteRes.json();
      console.log(`  [SUCCESS] Файл '${TEST_FILE_NAME}' успешно удален (или не существовал). Сообщение: ${result.message}`);
    } else if (deleteRes.status === 404) {
        console.log(`  [INFO] Файл '${TEST_FILE_NAME}' не найден в базе, очистка не требуется.`);
    } 
    else {
      throw new Error(`Статус: ${deleteRes.status}`);
    }
  } catch (error) {
    console.error(`  [FAILURE] Ошибка при предварительном удалении файла:`, error.message);
    return;
  }

  // --- Шаг 2: Векторизация тестового файла ---
  console.log(`\n[Шаг 2] Векторизуем файл '${TEST_FILE_PATH}'...`);
  try {
    const vectorizeRes = await fetch(`${BASE_URL}/vectorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: TEST_FILE_PATH, fileName: TEST_FILE_NAME })
    });
    if (!vectorizeRes.ok) {
        const errorBody = await vectorizeRes.text();
        throw new Error(`Статус: ${vectorizeRes.status}, Тело: ${errorBody}`);
    }
    const vectorizeResult = await vectorizeRes.json();
    console.log(`  [SUCCESS] Файл успешно векторизован. Создано чанков: ${vectorizeResult.chunks_count}`);
    if (vectorizeResult.chunks_count === 0) {
        throw new Error('Векторизация не создала ни одного чанка!');
    }
  } catch (error) {
    console.error(`  [FAILURE] Ошибка при векторизации файла:`, error.message);
    return;
  }

  // --- Шаг 3: Проверка созданных чанков ---
  console.log(`\n[Шаг 3] Проверяем, что чанки для файла '${TEST_FILE_NAME}' появились в базе...`);
  try {
    const chunksRes = await fetch(`${BASE_URL}/file-chunks/${TEST_FILE_NAME}`);
     if (!chunksRes.ok) {
        throw new Error(`Статус: ${chunksRes.status}`);
    }
    const { chunks } = await chunksRes.json();
    console.log(`  [SUCCESS] Получено ${chunks.length} чанков для файла.`);
    if (chunks.length > 0) {
        console.log(`    Пример чанка (id: ${chunks[0].id}): "${chunks[0].chunk_name}"`);
    } else {
        throw new Error('API вернул 0 чанков, хотя они должны были быть созданы!');
    }
  } catch (error) {
    console.error(`  [FAILURE] Ошибка при получении чанков файла:`, error.message);
    return;
  }

  // --- Шаг 4: RAG-запрос ---
  const question = "Какие ключевые возможности у этого проекта?"; // <-- Изменено
  console.log(`\n[Шаг 4] Задаем вопрос к RAG: "${question}"`);
  try {
    const askRes = await fetch(`${BASE_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });
    if (!askRes.ok) {
        throw new Error(`Статус: ${askRes.status}`);
    }
    const answer = await askRes.json();
    console.log(`  [SUCCESS] Получен ответ от RAG: "${answer.answer}"`);
    if (answer.answer.toLowerCase().includes('не могу найти')) {
        console.warn(`  [WARNING] Ответ RAG выглядит так, будто он не нашел нужный контекст.`);
    } else if (!answer.answer.toLowerCase().includes('векторизация')) {
        console.warn(`  [WARNING] Ответ не содержит ожидаемого ключевого слова 'векторизация'.`);
    }
  } catch (error) {
    console.error(`  [FAILURE] Ошибка при запросе к RAG:`, error.message);
    return;
  }
  
  // --- Шаг 5: Финальная очистка ---
  console.log(`\n[Шаг 5] Финальная очистка: удаляем тестовый файл '${TEST_FILE_NAME}'...`);
  try {
    const finalDeleteRes = await fetch(`${BASE_URL}/file/${TEST_FILE_NAME}`, { method: 'DELETE' });
    if (!finalDeleteRes.ok) {
        throw new Error(`Статус: ${finalDeleteRes.status}`);
    }
    const result = await finalDeleteRes.json();
    console.log(`  [SUCCESS] Файл '${TEST_FILE_NAME}' и его чанки успешно удалены. Сообщение: ${result.message}`);
  } catch (error) {
    console.error(`  [FAILURE] Ошибка при финальном удалении файла:`, error.message);
  }

  console.log('\n--- Комплексный тест завершен ---');
}

runFullCycleTest();
