/**
 * Запуск всех тестов системы
 * 
 * Этот скрипт запускает все тесты системы:
 * 1. Тесты имен чанков
 * 2. Тесты доступа к индексу
 * 3. Тесты обработки запросов
 * 
 * Запуск:
 * node run_all_tests.js [--chunk-names] [--index-access] [--query-access] [--all]
 * 
 * Параметры:
 * --chunk-names: запуск только тестов имен чанков
 * --index-access: запуск только тестов доступа к индексу
 * --query-access: запуск только тестов обработки запросов
 * --all: запуск всех тестов (по умолчанию)
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

// Получаем реальный путь к директории скрипта
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Функция для форматированного вывода сообщений
function log(message, type = 'info') {
  const colors = {
    info: '\x1b[36m%s\x1b[0m',    // Голубой
    success: '\x1b[32m%s\x1b[0m', // Зеленый
    error: '\x1b[31m%s\x1b[0m',   // Красный
    warning: '\x1b[33m%s\x1b[0m', // Желтый
    header: '\x1b[1;35m%s\x1b[0m' // Фиолетовый жирный (для заголовков)
  };
  
  const timestamp = new Date().toLocaleTimeString();
  console.log(colors[type], `[${timestamp}] ${message}`);
}

// Функция для запуска теста как отдельного процесса
function runTest(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    log(`Запуск скрипта: node ${scriptPath} ${args.join(' ')}`, 'info');
    
    const childProcess = spawn('node', [scriptPath, ...args], { stdio: 'inherit' });
    
    childProcess.on('close', (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    
    childProcess.on('error', (error) => {
      reject(error);
    });
  });
}

// Функция для запуска всех тестов
async function runAllTests(options) {
  log('=============================================', 'header');
  log('          ЗАПУСК ВСЕХ ТЕСТОВ СИСТЕМЫ        ', 'header');
  log('=============================================', 'header');
  
  const results = {
    chunkNames: null,
    indexAccess: null,
    queryAccess: null
  };
  
  // Запуск тестов имен чанков
  if (options.chunkNames || options.all) {
    log('ЗАПУСК ТЕСТОВ ИМЕН ЧАНКОВ...', 'header');
    try {
      results.chunkNames = await runTest(path.join(__dirname, 'test_all_chunk_names.js'));
      log(`Тесты имен чанков ${results.chunkNames ? 'УСПЕШНО ЗАВЕРШЕНЫ' : 'ЗАВЕРШЕНЫ С ОШИБКАМИ'}`, 
          results.chunkNames ? 'success' : 'error');
    } catch (error) {
      log(`Ошибка при запуске тестов имен чанков: ${error.message}`, 'error');
      results.chunkNames = false;
    }
  }
  
  // Запуск тестов доступа к индексу
  if (options.indexAccess || options.all) {
    log('ЗАПУСК ТЕСТОВ ДОСТУПА К ИНДЕКСУ...', 'header');
    try {
      results.indexAccess = await runTest(path.join(__dirname, 'test_index_access.js'));
      log(`Тесты доступа к индексу ${results.indexAccess ? 'УСПЕШНО ЗАВЕРШЕНЫ' : 'ЗАВЕРШЕНЫ С ОШИБКАМИ'}`, 
          results.indexAccess ? 'success' : 'error');
    } catch (error) {
      log(`Ошибка при запуске тестов доступа к индексу: ${error.message}`, 'error');
      results.indexAccess = false;
    }
  }
  
  // Запуск тестов обработки запросов
  if (options.queryAccess || options.all) {
    log('ЗАПУСК ТЕСТОВ ОБРАБОТКИ ЗАПРОСОВ...', 'header');
    try {
      results.queryAccess = await runTest(path.join(__dirname, 'test_query_access.js'));
      log(`Тесты обработки запросов ${results.queryAccess ? 'УСПЕШНО ЗАВЕРШЕНЫ' : 'ЗАВЕРШЕНЫ С ОШИБКАМИ'}`, 
          results.queryAccess ? 'success' : 'error');
    } catch (error) {
      log(`Ошибка при запуске тестов обработки запросов: ${error.message}`, 'error');
      results.queryAccess = false;
    }
  }
  
  // Вывод итоговых результатов
  log('=============================================', 'header');
  log('            РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ         ', 'header');
  log('=============================================', 'header');
  
  if (options.chunkNames || options.all) {
    log(`Тесты имен чанков: ${results.chunkNames ? 'УСПЕШНО' : 'ОШИБКА'}`, 
        results.chunkNames ? 'success' : 'error');
  }
  
  if (options.indexAccess || options.all) {
    log(`Тесты доступа к индексу: ${results.indexAccess ? 'УСПЕШНО' : 'ОШИБКА'}`, 
        results.indexAccess ? 'success' : 'error');
  }
  
  if (options.queryAccess || options.all) {
    log(`Тесты обработки запросов: ${results.queryAccess ? 'УСПЕШНО' : 'ОШИБКА'}`, 
        results.queryAccess ? 'success' : 'error');
  }
  
  const overallSuccess = 
    ((options.chunkNames || options.all) ? results.chunkNames : true) && 
    ((options.indexAccess || options.all) ? results.indexAccess : true) && 
    ((options.queryAccess || options.all) ? results.queryAccess : true);
  
  log(`ОБЩИЙ РЕЗУЛЬТАТ: ${overallSuccess ? 'УСПЕШНО' : 'ОШИБКА'}`, 
      overallSuccess ? 'success' : 'error');
  
  return overallSuccess;
}

// Парсинг аргументов командной строки
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    chunkNames: args.includes('--chunk-names'),
    indexAccess: args.includes('--index-access'),
    queryAccess: args.includes('--query-access'),
    all: args.includes('--all') || 
         (!args.includes('--chunk-names') && 
          !args.includes('--index-access') && 
          !args.includes('--query-access'))
  };
  
  return options;
}

// Запуск программы
const options = parseArgs();
runAllTests(options).then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  log(`Критическая ошибка при выполнении тестов: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
}); 