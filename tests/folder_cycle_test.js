const fetch = require('node-fetch');
const path = require('path');

const BASE_URL = 'http://localhost:3005';
const TEST_FOLDER_NAME = 'test_folder';
const TEST_FOLDER_DIR = path.join(__dirname, 'test_data', TEST_FOLDER_NAME);
const TEST_FILES = ['test1.js', 'test2.md'];

async function runFolderCycleTest() {
  console.log('--- Запуск E2E теста сканирования папки ---');

  // --- Шаг 1: Подготовка и предварительная очистка ---
  console.log(`\n[Шаг 1] Проверяем и удаляем тестовые файлы, если они существуют...`);
  for (const fileName of TEST_FILES) {
    try {
      const deleteRes = await fetch(`${BASE_URL}/file/${fileName}`, { method: 'DELETE' });
      if (deleteRes.ok) {
        const result = await deleteRes.json();
        console.log(`  [SUCCESS] Файл '${fileName}' успешно удален (или не существовал).`);
      } else if (deleteRes.status === 404) {
        console.log(`  [INFO] Файл '${fileName}' не найден в базе, очистка не требуется.`);
      } else {
        throw new Error(`Статус: ${deleteRes.status}`);
      }
    } catch (error) {
      console.error(`  [FAILURE] Ошибка при предварительном удалении файла '${fileName}':`, error.message);
      return;
    }
  }

  // --- Шаг 2: Сканирование и векторизация тестовой папки ---
  console.log(`\n[Шаг 2] Сканируем и векторизуем папку '${TEST_FOLDER_DIR}'...`);
  try {
    const scanRes = await fetch(`${BASE_URL}/scan-and-vectorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: TEST_FOLDER_DIR })
    });
    if (!scanRes.ok) {
        const errorBody = await scanRes.text();
        throw new Error(`Статус: ${scanRes.status}, Тело: ${errorBody}`);
    }
    const scanResult = await scanRes.json();
    console.log(`  [SUCCESS] Папка успешно просканирована. Результат:`, scanResult);
    if (!scanResult.total_files || scanResult.total_files === 0) {
        throw new Error('Сканирование не нашло или не обработало ни одного файла!');
    }
    if (scanResult.vectorized_files.length !== TEST_FILES.length) {
        console.warn(`  [WARNING] Количество векторизованных файлов (${scanResult.vectorized_files.length}) не совпадает с ожидаемым (${TEST_FILES.length}).`);
    }
  } catch (error) {
    console.error(`  [FAILURE] Ошибка при сканировании папки:`, error.message);
    return;
  }

  // --- Шаг 3: Проверка созданных чанков ---
  console.log(`\n[Шаг 3] Проверяем, что чанки для файлов появились в базе...`);
  for (const fileName of TEST_FILES) {
    try {
      const chunksRes = await fetch(`${BASE_URL}/file-chunks/${fileName}`);
       if (!chunksRes.ok) {
          throw new Error(`Статус: ${chunksRes.status}`);
      }
      const { chunks } = await chunksRes.json();
      console.log(`  [SUCCESS] Получено ${chunks.length} чанков для файла '${fileName}'.`);
      if (chunks.length === 0) {
          throw new Error(`API вернул 0 чанков для '${fileName}', хотя они должны были быть созданы!`);
      }
    } catch (error) {
      console.error(`  [FAILURE] Ошибка при получении чанков для '${fileName}':`, error.message);
      // Не выходим из цикла, чтобы проверить все файлы
    }
  }
  
  // --- Шаг 4: RAG-запросы для проверки контекста ---
  console.log(`\n[Шаг 4] Задаем вопросы к RAG для проверки контекста...`);
  const questions = [
    {
      q: "Что возвращает testFunction1?",
      expected: "unique_string_from_js_file"
    },
    {
      q: "Какой специальный ключ содержится в markdown файле?",
      expected: "unique_keyword_from_md_file"
    }
  ];

  for (const { q, expected } of questions) {
    console.log(`  Задаем вопрос: "${q}"`);
    try {
      const askRes = await fetch(`${BASE_URL}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q })
      });
      if (!askRes.ok) {
          throw new Error(`Статус: ${askRes.status}`);
      }
      const answer = await askRes.json();
      console.log(`  [SUCCESS] Получен ответ от RAG: "${answer.answer}"`);
      if (answer.answer.toLowerCase().includes('не могу найти')) {
          console.warn(`  [WARNING] Ответ RAG выглядит так, будто он не нашел нужный контекст.`);
      }
      if (!answer.answer.includes(expected)) {
          console.warn(`  [WARNING] Ответ RAG не содержит ожидаемую строку "${expected}".`);
      }
    } catch (error) {
      console.error(`  [FAILURE] Ошибка при запросе к RAG:`, error.message);
    }
  }
  
  // --- Шаг 5: Финальная очистка ---
  /*
  console.log(`\n[Шаг 5] Финальная очистка: удаляем тестовые файлы...`);
    for (const fileName of TEST_FILES) {
    try {
      const finalDeleteRes = await fetch(`${BASE_URL}/file/${fileName}`, { method: 'DELETE' });
      if (!finalDeleteRes.ok) {
          throw new Error(`Статус: ${finalDeleteRes.status}`);
      }
      const result = await finalDeleteRes.json();
      console.log(`  [SUCCESS] Файл '${fileName}' и его чанки успешно удалены.`);
    } catch (error) {
      console.error(`  [FAILURE] Ошибка при финальном удалении файла '${fileName}':`, error.message);
    }
  }
  */
  console.log('\n--- Тест сканирования папки завершен ---');
}

runFolderCycleTest();
