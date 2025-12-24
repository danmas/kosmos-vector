// run_tests.js
import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Получаем реальный путь к текущему файлу скрипта
const __filename = fileURLToPath(import.meta.url);
// Получаем директорию, в которой находится файл скрипта
const __dirname = path.dirname(__filename);

// Функция для запуска тестов
async function runTests() {
  console.log('=== Запуск тестов ===');
  
  // Запуск тестов API маршрутов с SimpleEmbeddings
  await runTest('tests/api_routes_test_simple.js', 'Тесты API маршрутов с SimpleEmbeddings');
  
  // Запуск тестов API маршрутов с OpenAIEmbeddings
  await runTest('tests/api_routes_test_openai.js', 'Тесты API маршрутов с OpenAIEmbeddings');
  
  // Запуск тестов моделей эмбеддингов
  await runTest('tests/embedding_models_test.js', 'Тесты моделей эмбеддингов');
  
  // Запуск тестов контекстных кодов
  await runTest('tests/context_code_test.js', 'Тесты работы с контекстными кодами');
  
  // Запуск тестов микросервисов
  await runTest('tests/microservices_test.js', 'Тесты микросервисов');
  
  // Запуск тестов векторизации
  await runTest('tests/vectorization_test.js', 'Тесты процесса векторизации');
  
  console.log('\n=== Все тесты завершены ===');
}

// Функция для запуска отдельного теста
function runTest(testFile, testName) {
  return new Promise((resolve, reject) => {
    console.log(`\n--- Запуск: ${testName} ---`);
    
    const testProcess = spawn('node', [path.join(__dirname, testFile)], {
      stdio: 'inherit'
    });
    
    testProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ ${testName} успешно пройдены`);
        resolve();
      } else {
        console.error(`❌ ${testName} завершились с ошибкой (код ${code})`);
        resolve(); // Продолжаем выполнение даже при ошибке
      }
    });
    
    testProcess.on('error', (error) => {
      console.error(`❌ Ошибка при запуске ${testName}:`, error);
      resolve(); // Продолжаем выполнение даже при ошибке
    });
  });
}

// Запускаем тесты
runTests().catch(error => {
  console.error('Критическая ошибка при выполнении тестов:', error);
  process.exit(1);
}); 