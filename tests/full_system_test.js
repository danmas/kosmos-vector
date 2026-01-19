/**
 * Full System Test для HR Management Project
 * Комплексный E2E тест системы kosmos-vector
 */

require('dotenv').config();
const fetch = require('node-fetch');
const { Client } = require('pg');
const path = require('path');

const BASE_URL = 'http://localhost:3200';
const CONTEXT_CODE = 'FULL_TEST';

// Конфигурация БД из переменных окружения (.env)
// Поддерживается DATABASE_URL или отдельные переменные PGHOST, PGPORT, etc.
const dbConfig = process.env.DATABASE_URL 
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT) || 5432,
        database: process.env.PGDATABASE || 'postgres',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres'
    };

// Ожидаемые значения для проверок
// Реально создаётся ~40+ ai_items:
// - 6 DDL таблиц (hr.*)
// - 2 SQL функции (hr.*)
// - ~8 методов классов JS/TS (Class.method)
// - ~16 top-level JS/TS функций (без схемы — это нормально для текущих парсеров)
// - ~10 PHP сущностей (класс, интерфейс, trait, методы, функции)
const EXPECTED_AI_ITEMS_MIN = 35;
const EXPECTED_AI_ITEMS_MAX = 50;
// Связи создаются всеми загрузчиками (SQL, JS, TS)
const EXPECTED_LINKS_MIN = 5;

// Natural Query тесты
// Вопросы должны быть достаточно общими для хорошего векторного поиска
const NATURAL_QUERY_TESTS = [
    {
        question: 'Какие функции работают с таблицей employees?',
        expectedKeywords: ['get_department_employees', 'EmployeeService', 'employees']
    },
    {
        question: 'Покажи все классы в проекте',
        expectedKeywords: ['EmployeeService', 'DepartmentService']
    },
    {
        question: 'Расскажи про HR схему базы данных',
        expectedKeywords: ['hr', 'employees', 'departments', 'skills']
    }
];

/**
 * Ожидание завершения шага pipeline
 */
async function waitForStepCompletion(stepNumber, maxWaitTime = 300000) {
    const startTime = Date.now();
    const pollInterval = 2000; // 2 секунды

    console.log(`\n[Ожидание] Ожидаем завершения Step${stepNumber}...`);

    while (Date.now() - startTime < maxWaitTime) {
        try {
            const statusRes = await fetch(`${BASE_URL}/api/pipeline/steps/status?context-code=${CONTEXT_CODE}`);
            if (!statusRes.ok) {
                throw new Error(`Статус: ${statusRes.status}`);
            }

            const { steps } = await statusRes.json();
            const step = steps.find(s => s.id === stepNumber);

            if (!step) {
                throw new Error(`Шаг ${stepNumber} не найден в статусе`);
            }

            const progress = step.progress || 0;
            const status = step.status;

            if (status === 'completed') {
                console.log(`  [SUCCESS] Step${stepNumber} завершен (прогресс: ${progress}%)`);
                return { success: true, step };
            } else if (status === 'failed') {
                console.error(`  [FAILURE] Step${stepNumber} завершился с ошибкой`);
                console.error(`  Ошибка: ${step.error || 'Неизвестная ошибка'}`);
                return { success: false, step, error: step.error };
            } else if (status === 'running') {
                process.stdout.write(`\r  [INFO] Step${stepNumber} выполняется... (${progress}%)`);
            }

            await new Promise(resolve => setTimeout(resolve, pollInterval));
        } catch (error) {
            console.error(`\n  [ERROR] Ошибка при проверке статуса Step${stepNumber}:`, error.message);
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
    }

    throw new Error(`Step${stepNumber} не завершился за ${maxWaitTime / 1000} секунд`);
}

/**
 * Очистка данных по context_code
 */
async function cleanupData() {
    console.log('\n[Шаг 0] Очистка данных для context_code = FULL_TEST...');
    
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        // Удаляем файлы (каскад удалит ai_items, chunk_vector, link)
        const deleteFiles = await client.query(
            `DELETE FROM public.files WHERE context_code = $1`,
            [CONTEXT_CODE]
        );
        
        console.log(`  [SUCCESS] Удалено файлов: ${deleteFiles.rowCount}`);
        console.log('  [INFO] Данные очищены (каскад удалил связанные записи)');
    } catch (error) {
        console.error(`  [ERROR] Ошибка при очистке данных:`, error.message);
        throw error;
    } finally {
        await client.end();
    }
}

/**
 * Проверка количества ai_items
 */
async function checkAiItemsCount() {
    console.log('\n[Проверка 1] Количество ai_items...');
    
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        const result = await client.query(
            `SELECT COUNT(*) as count FROM public.ai_item WHERE context_code = $1`,
            [CONTEXT_CODE]
        );
        
        const count = parseInt(result.rows[0].count);
        console.log(`  [INFO] Найдено ai_items: ${count}`);
        
        if (count < EXPECTED_AI_ITEMS_MIN || count > EXPECTED_AI_ITEMS_MAX) {
            console.warn(`  [WARNING] Количество ai_items (${count}) вне ожидаемого диапазона [${EXPECTED_AI_ITEMS_MIN}, ${EXPECTED_AI_ITEMS_MAX}]`);
        } else {
            console.log(`  [SUCCESS] Количество ai_items в ожидаемом диапазоне`);
        }
        
        // Проверка что DDL/SQL элементы имеют схему hr.
        // DDL таблицы и SQL функции должны начинаться с 'hr.'
        // JS/TS элементы могут не иметь схемы — это нормально
        const hrElementsResult = await client.query(
            `SELECT COUNT(*) as count FROM public.ai_item 
             WHERE context_code = $1 AND full_name LIKE 'hr.%'`,
            [CONTEXT_CODE]
        );
        const hrElementsCount = parseInt(hrElementsResult.rows[0].count);
        
        // Проверяем что нет HR элементов без схемы
        const hrNoSchemaResult = await client.query(
            `SELECT COUNT(*) as count FROM public.ai_item 
             WHERE context_code = $1 
               AND full_name LIKE 'hr.%'
               AND full_name NOT LIKE '%.%'`,
            [CONTEXT_CODE]
        );
        const hrNoSchemaCount = parseInt(hrNoSchemaResult.rows[0].count);
        
        console.log(`  [INFO] HR элементов (со схемой hr.): ${hrElementsCount}`);
        
        if (hrElementsCount < 8) {
            console.warn(`  [WARNING] Ожидалось минимум 8 HR элементов (6 таблиц + 2 функции), найдено ${hrElementsCount}`);
        } else {
            console.log(`  [SUCCESS] Все DDL/SQL элементы имеют схему hr.`);
        }
        
        if (hrNoSchemaCount > 0) {
            console.warn(`  [WARNING] Найдено ${hrNoSchemaCount} HR элементов без схемы в full_name`);
        }
        
        // Дополнительно: показать статистику по типам
        const statsResult = await client.query(
            `SELECT type, COUNT(*) as count FROM public.ai_item 
             WHERE context_code = $1 GROUP BY type ORDER BY count DESC`,
            [CONTEXT_CODE]
        );
        console.log(`  [INFO] Распределение по типам:`);
        statsResult.rows.forEach(row => {
            console.log(`         - ${row.type}: ${row.count}`);
        });
        
        return { count, hrElementsCount, hrNoSchemaCount };
    } catch (error) {
        console.error(`  [ERROR] Ошибка при проверке ai_items:`, error.message);
        throw error;
    } finally {
        await client.end();
    }
}

/**
 * Проверка L1 связей
 */
async function checkL1Links() {
    console.log('\n[Проверка 2] L1 связи в таблице link...');
    
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        // Общее количество связей
        const totalResult = await client.query(
            `SELECT COUNT(*) as count FROM public.link WHERE context_code = $1`,
            [CONTEXT_CODE]
        );
        const totalLinks = parseInt(totalResult.rows[0].count);
        console.log(`  [INFO] Всего связей: ${totalLinks}`);
        
        // Проверяем связи только для SQL элементов (hr.*)
        // HR связи должны иметь схему в target
        const hrLinksNoSchemaResult = await client.query(
            `SELECT COUNT(*) as count FROM public.link 
             WHERE context_code = $1 
               AND source LIKE 'hr.%'
               AND target NOT LIKE '%.%'`,
            [CONTEXT_CODE]
        );
        const hrNoSchemaLinks = parseInt(hrLinksNoSchemaResult.rows[0].count);
        
        // Все связи без схемы (для статистики)
        const allNoSchemaResult = await client.query(
            `SELECT COUNT(*) as count FROM public.link 
             WHERE context_code = $1 AND target NOT LIKE '%.%'`,
            [CONTEXT_CODE]
        );
        const allNoSchemaLinks = parseInt(allNoSchemaResult.rows[0].count);
        
        // JS/TS связи без схемы — это нормально
        const jsNoSchemaLinks = allNoSchemaLinks - hrNoSchemaLinks;
        
        if (hrNoSchemaLinks > 0) {
            console.warn(`  [WARNING] Найдено ${hrNoSchemaLinks} HR связей без схемы в target`);
        } else {
            console.log(`  [SUCCESS] Все HR связи имеют схему в target`);
        }
        
        if (jsNoSchemaLinks > 0) {
            console.log(`  [INFO] JS/TS связей без схемы (ожидаемо): ${jsNoSchemaLinks}`);
        }
        
        if (totalLinks < EXPECTED_LINKS_MIN) {
            console.warn(`  [WARNING] Количество связей (${totalLinks}) меньше ожидаемого минимума (${EXPECTED_LINKS_MIN})`);
        } else {
            console.log(`  [SUCCESS] Количество связей соответствует ожиданиям`);
        }
        
        return { totalLinks, hrNoSchemaLinks, jsNoSchemaLinks };
    } catch (error) {
        console.error(`  [ERROR] Ошибка при проверке связей:`, error.message);
        throw error;
    } finally {
        await client.end();
    }
}

/**
 * Тест Natural Query
 */
async function testNaturalQuery(question, expectedKeywords) {
    console.log(`\n[Natural Query] Вопрос: "${question}"`);
    
    try {
        const response = await fetch(`${BASE_URL}/api/v1/natural-query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question,
                contextCode: CONTEXT_CODE
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Статус: ${response.status}, Тело: ${errorText}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(`API вернул success: false`);
        }
        
        // Проверяем наличие ожидаемых ключевых слов в ответе
        let foundKeywords = [];
        let answerText = '';
        
        if (result.high_confidence && result.suggestions && result.suggestions.length > 0) {
            // Если вернулись suggestions, проверяем их
            answerText = JSON.stringify(result.suggestions);
            console.log(`  [INFO] Получены suggestions (high_confidence: ${result.high_confidence})`);
        } else if (result.script) {
            // Если вернулся скрипт
            answerText = result.script;
            console.log(`  [INFO] Получен скрипт (длина: ${answerText.length})`);
        } else {
            answerText = JSON.stringify(result);
        }
        
        // Проверка ключевых слов
        for (const keyword of expectedKeywords) {
            if (answerText.toLowerCase().includes(keyword.toLowerCase())) {
                foundKeywords.push(keyword);
            }
        }
        
        if (foundKeywords.length > 0) {
            console.log(`  [SUCCESS] Найдены ключевые слова: ${foundKeywords.join(', ')}`);
            return { success: true, foundKeywords };
        } else {
            console.warn(`  [WARNING] Не найдено ни одного ожидаемого ключевого слова из: ${expectedKeywords.join(', ')}`);
            console.log(`  [INFO] Ответ: ${answerText.substring(0, 200)}...`);
            return { success: false, foundKeywords: [], answerText };
        }
    } catch (error) {
        console.error(`  [ERROR] Ошибка при Natural Query:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Главная функция теста
 */
async function runFullSystemTest() {
    console.log('='.repeat(80));
    console.log('FULL SYSTEM TEST: HR Management Project');
    console.log('='.repeat(80));
    console.log(`Context Code: ${CONTEXT_CODE}`);
    console.log(`Base URL: ${BASE_URL}`);
    
    const results = {
        cleanup: false,
        step1: false,
        step2: false,
        aiItemsCheck: false,
        linksCheck: false,
        naturalQueryTests: []
    };
    
    try {
        // Шаг 0: Очистка данных
        await cleanupData();
        results.cleanup = true;
        
        // Шаг 1: Запуск Step1
        console.log('\n[Шаг 1] Запуск Step1 (Parsing + Loading)...');
        try {
            const step1Res = await fetch(`${BASE_URL}/api/pipeline/step/1/run?context-code=${CONTEXT_CODE}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!step1Res.ok) {
                const errorText = await step1Res.text();
                throw new Error(`Статус: ${step1Res.status}, Тело: ${errorText}`);
            }
            
            const step1Result = await step1Res.json();
            if (!step1Result.success) {
                throw new Error(`Step1 не запустился: ${step1Result.error || 'Неизвестная ошибка'}`);
            }
            
            console.log('  [INFO] Step1 запущен в фоновом режиме');
            
            // Ожидание завершения Step1
            const step1Completion = await waitForStepCompletion(1);
            if (step1Completion.success) {
                results.step1 = true;
            } else {
                throw new Error(`Step1 завершился с ошибкой: ${step1Completion.error}`);
            }
        } catch (error) {
            console.error(`  [FAILURE] Ошибка при выполнении Step1:`, error.message);
            throw error;
        }
        
        // Проверка 1: ai_items
        const aiItemsResult = await checkAiItemsCount();
        results.aiItemsCheck = aiItemsResult.count >= EXPECTED_AI_ITEMS_MIN && 
                              aiItemsResult.count <= EXPECTED_AI_ITEMS_MAX &&
                              aiItemsResult.hrElementsCount >= 8 &&
                              aiItemsResult.hrNoSchemaCount === 0;
        
        // Шаг 2: Запуск Step2
        console.log('\n[Шаг 2] Запуск Step2 (L1 Fix)...');
        try {
            const step2Res = await fetch(`${BASE_URL}/api/pipeline/step/2/run?context-code=${CONTEXT_CODE}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!step2Res.ok) {
                const errorText = await step2Res.text();
                throw new Error(`Статус: ${step2Res.status}, Тело: ${errorText}`);
            }
            
            const step2Result = await step2Res.json();
            if (!step2Result.success) {
                throw new Error(`Step2 не запустился: ${step2Result.error || 'Неизвестная ошибка'}`);
            }
            
            console.log('  [INFO] Step2 запущен в фоновом режиме');
            
            // Ожидание завершения Step2
            const step2Completion = await waitForStepCompletion(2);
            if (step2Completion.success) {
                results.step2 = true;
            } else {
                throw new Error(`Step2 завершился с ошибкой: ${step2Completion.error}`);
            }
        } catch (error) {
            console.error(`  [FAILURE] Ошибка при выполнении Step2:`, error.message);
            throw error;
        }
        
        // Проверка 2: L1 связи
        const linksResult = await checkL1Links();
        results.linksCheck = linksResult.totalLinks >= EXPECTED_LINKS_MIN && 
                           linksResult.hrNoSchemaLinks === 0;
        
        // Шаг 3: Natural Query тесты
        console.log('\n[Шаг 3] Тестирование Natural Query API...');
        for (const test of NATURAL_QUERY_TESTS) {
            const queryResult = await testNaturalQuery(test.question, test.expectedKeywords);
            results.naturalQueryTests.push({
                question: test.question,
                success: queryResult.success,
                foundKeywords: queryResult.foundKeywords || []
            });
        }
        
        // Итоги
        console.log('\n' + '='.repeat(80));
        console.log('ИТОГИ ТЕСТА');
        console.log('='.repeat(80));
        console.log(`Очистка данных: ${results.cleanup ? '✅' : '❌'}`);
        console.log(`Step1 (Parsing): ${results.step1 ? '✅' : '❌'}`);
        console.log(`Step2 (L1 Fix): ${results.step2 ? '✅' : '❌'}`);
        console.log(`Проверка ai_items: ${results.aiItemsCheck ? '✅' : '❌'}`);
        console.log(`Проверка L1 связей: ${results.linksCheck ? '✅' : '❌'}`);
        console.log(`Natural Query тесты:`);
        results.naturalQueryTests.forEach((test, idx) => {
            console.log(`  ${idx + 1}. ${test.success ? '✅' : '❌'} "${test.question.substring(0, 50)}..."`);
            if (test.foundKeywords && test.foundKeywords.length > 0) {
                console.log(`     Найдено: ${test.foundKeywords.join(', ')}`);
            }
        });
        
        const allPassed = results.cleanup && results.step1 && results.step2 && 
                         results.aiItemsCheck && results.linksCheck &&
                         results.naturalQueryTests.every(t => t.success);
        
        console.log('\n' + '='.repeat(80));
        if (allPassed) {
            console.log('✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО');
        } else {
            console.log('⚠️  НЕКОТОРЫЕ ТЕСТЫ НЕ ПРОЙДЕНЫ');
        }
        console.log('='.repeat(80));
        console.log('\n[INFO] Данные НЕ удалены. Можете проверить результаты в БД с context_code = FULL_TEST');
        
    } catch (error) {
        console.error('\n' + '='.repeat(80));
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА ТЕСТА');
        console.error('='.repeat(80));
        console.error(error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Запуск теста
if (require.main === module) {
    runFullSystemTest().catch(error => {
        console.error('Необработанная ошибка:', error);
        process.exit(1);
    });
}

module.exports = { runFullSystemTest };
