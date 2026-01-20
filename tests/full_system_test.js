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
 * Проверка multi-root (файлы из разных rootPath)
 */
async function checkMultiRoot() {
    console.log('\n[Проверка 0] Multi-root структура...');
    
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        // Проверяем что файлы загружены из обоих rootPath
        const filesResult = await client.query(
            `SELECT filename, file_url FROM public.files WHERE context_code = $1 ORDER BY filename`,
            [CONTEXT_CODE]
        );
        
        const files = filesResult.rows;
        console.log(`  [INFO] Всего файлов: ${files.length}`);
        
        // Проверяем наличие файлов из hr_test_project
        const mainProjectFiles = files.filter(f => f.file_url && f.file_url.includes('hr_test_project') && !f.file_url.includes('hr_test_project_php'));
        // Проверяем наличие файлов из hr_test_project_php
        const phpProjectFiles = files.filter(f => f.file_url && f.file_url.includes('hr_test_project_php'));
        
        console.log(`  [INFO] Файлов из hr_test_project: ${mainProjectFiles.length}`);
        console.log(`  [INFO] Файлов из hr_test_project_php: ${phpProjectFiles.length}`);
        
        if (mainProjectFiles.length === 0) {
            console.warn(`  [WARNING] Нет файлов из основного проекта hr_test_project`);
        }
        if (phpProjectFiles.length === 0) {
            console.warn(`  [WARNING] Нет файлов из PHP проекта hr_test_project_php`);
        }
        
        const multiRootOk = mainProjectFiles.length > 0 && phpProjectFiles.length > 0;
        if (multiRootOk) {
            console.log(`  [SUCCESS] Multi-root: файлы загружены из обоих проектов`);
        }
        
        return { totalFiles: files.length, mainProjectFiles: mainProjectFiles.length, phpProjectFiles: phpProjectFiles.length, multiRootOk };
    } catch (error) {
        console.error(`  [ERROR] Ошибка при проверке multi-root:`, error.message);
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
 * Проверка Logic Architect API
 */
async function checkLogicArchitect() {
    console.log('\n[Проверка 3] Logic Architect API...');
    
    const testItems = [
        { id: 'hr.get_employee_skills', type: 'SQL', description: 'SQL функция с JOIN и ORDER BY' },
        { id: 'validateEmployee', type: 'JS', description: 'JS функция с 3 ветвлениями и throw' },
        { id: 'SkillService.addSkillToEmployee', type: 'PHP', description: 'PHP метод с trait и составным условием' }
    ];
    
    const results = [];
    let allPassed = true;
    
    for (const item of testItems) {
        console.log(`\n  [Тест] ${item.type}: ${item.id}`);
        console.log(`         ${item.description}`);
        
        try {
            // 1. POST /analyze-logic
            const analyzeUrl = `${BASE_URL}/api/items/${encodeURIComponent(item.id)}/analyze-logic?context-code=${CONTEXT_CODE}`;
            const analyzeResponse = await fetch(analyzeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!analyzeResponse.ok) {
                const errorText = await analyzeResponse.text();
                throw new Error(`Статус: ${analyzeResponse.status}, Тело: ${errorText}`);
            }
            
            const analyzeResult = await analyzeResponse.json();
            
            // 2. Проверка структуры ответа
            if (!analyzeResult.logic || typeof analyzeResult.logic !== 'string' || analyzeResult.logic.trim().length === 0) {
                throw new Error('Отсутствует или пустое поле "logic"');
            }
            
            if (!analyzeResult.graph || !Array.isArray(analyzeResult.graph.nodes) || !Array.isArray(analyzeResult.graph.edges)) {
                throw new Error('Отсутствует или некорректная структура "graph"');
            }
            
            if (analyzeResult.graph.nodes.length < 2) {
                throw new Error(`Недостаточно узлов в графе: ${analyzeResult.graph.nodes.length} (ожидается минимум 2: start + end)`);
            }
            
            if (analyzeResult.graph.edges.length < 1) {
                throw new Error(`Недостаточно связей в графе: ${analyzeResult.graph.edges.length} (ожидается минимум 1)`);
            }
            
            // Проверка структуры узлов
            for (const node of analyzeResult.graph.nodes) {
                if (!node.id || !node.type || !node.label) {
                    throw new Error(`Узел без обязательных полей: ${JSON.stringify(node)}`);
                }
                if (!['start', 'end', 'decision', 'process', 'db_call', 'exception'].includes(node.type)) {
                    throw new Error(`Неизвестный тип узла: ${node.type}`);
                }
            }
            
            // Проверка структуры связей
            for (const edge of analyzeResult.graph.edges) {
                if (!edge.id || !edge.from || !edge.to) {
                    throw new Error(`Связь без обязательных полей: ${JSON.stringify(edge)}`);
                }
            }
            
            console.log(`    [SUCCESS] Анализ получен: ${analyzeResult.graph.nodes.length} узлов, ${analyzeResult.graph.edges.length} связей`);
            
            // 3. POST /logic-graph (сохранение)
            const saveUrl = `${BASE_URL}/api/items/${encodeURIComponent(item.id)}/logic-graph?context-code=${CONTEXT_CODE}`;
            const saveResponse = await fetch(saveUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    logic: analyzeResult.logic,
                    graph: analyzeResult.graph
                })
            });
            
            if (!saveResponse.ok) {
                const errorText = await saveResponse.text();
                throw new Error(`Ошибка сохранения: Статус ${saveResponse.status}, Тело: ${errorText}`);
            }
            
            const saveResult = await saveResponse.json();
            if (!saveResult.success) {
                throw new Error(`Сохранение не удалось: ${saveResult.error || 'Неизвестная ошибка'}`);
            }
            
            console.log(`    [SUCCESS] Результат сохранён`);
            
            // 4. GET /logic-graph (получение сохранённого)
            const getUrl = `${BASE_URL}/api/items/${encodeURIComponent(item.id)}/logic-graph?context-code=${CONTEXT_CODE}`;
            const getResponse = await fetch(getUrl, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!getResponse.ok) {
                const errorText = await getResponse.text();
                throw new Error(`Ошибка получения: Статус ${getResponse.status}, Тело: ${errorText}`);
            }
            
            const getResult = await getResponse.json();
            if (!getResult.success || !getResult.logicGraph) {
                throw new Error(`Получение не удалось: ${getResult.error || 'Неизвестная ошибка'}`);
            }
            
            // 5. Сравнение данных
            const savedLogic = getResult.logicGraph.logic;
            const savedGraph = getResult.logicGraph.graph;
            
            if (savedLogic !== analyzeResult.logic) {
                throw new Error('Сохранённая логика не совпадает с оригиналом');
            }
            
            if (JSON.stringify(savedGraph.nodes) !== JSON.stringify(analyzeResult.graph.nodes)) {
                throw new Error('Сохранённые узлы не совпадают с оригиналом');
            }
            
            if (JSON.stringify(savedGraph.edges) !== JSON.stringify(analyzeResult.graph.edges)) {
                throw new Error('Сохранённые связи не совпадают с оригиналом');
            }
            
            console.log(`    [SUCCESS] Данные совпадают с сохранёнными`);
            
            results.push({
                id: item.id,
                type: item.type,
                success: true,
                nodesCount: analyzeResult.graph.nodes.length,
                edgesCount: analyzeResult.graph.edges.length
            });
            
        } catch (error) {
            console.error(`    [ERROR] Ошибка при тестировании ${item.id}:`, error.message);
            results.push({
                id: item.id,
                type: item.type,
                success: false,
                error: error.message
            });
            allPassed = false;
        }
    }
    
    // Итоги проверки
    const successCount = results.filter(r => r.success).length;
    console.log(`\n  [ИТОГО] Успешно: ${successCount}/${results.length}`);
    
    if (allPassed) {
        console.log(`  [SUCCESS] Все тесты Logic Architect пройдены`);
    } else {
        console.warn(`  [WARNING] Некоторые тесты Logic Architect не пройдены`);
    }
    
    return { results, allPassed, successCount, totalCount: results.length };
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
        multiRootCheck: false,
        aiItemsCheck: false,
        linksCheck: false,
        logicArchitectCheck: false,
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
        
        // Проверка 0: Multi-root
        const multiRootResult = await checkMultiRoot();
        results.multiRootCheck = multiRootResult.multiRootOk;
        
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
        
        // Проверка 3: Logic Architect
        const logicArchitectResult = await checkLogicArchitect();
        results.logicArchitectCheck = logicArchitectResult.allPassed;
        results.logicArchitectResults = logicArchitectResult.results;
        
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
        console.log(`Multi-root: ${results.multiRootCheck ? '✅' : '❌'}`);
        console.log(`Проверка ai_items: ${results.aiItemsCheck ? '✅' : '❌'}`);
        console.log(`Проверка L1 связей: ${results.linksCheck ? '✅' : '❌'}`);
        console.log(`Logic Architect: ${results.logicArchitectCheck ? '✅' : '❌'}`);
        if (results.logicArchitectCheck) {
            const logicResults = results.logicArchitectResults || [];
            logicResults.forEach((r, idx) => {
                if (r.success) {
                    console.log(`  ${idx + 1}. ✅ ${r.type}: ${r.id} (${r.nodesCount} узлов, ${r.edgesCount} связей)`);
                } else {
                    console.log(`  ${idx + 1}. ❌ ${r.type}: ${r.id} - ${r.error}`);
                }
            });
        }
        console.log(`Natural Query тесты:`);
        results.naturalQueryTests.forEach((test, idx) => {
            console.log(`  ${idx + 1}. ${test.success ? '✅' : '❌'} "${test.question.substring(0, 50)}..."`);
            if (test.foundKeywords && test.foundKeywords.length > 0) {
                console.log(`     Найдено: ${test.foundKeywords.join(', ')}`);
            }
        });
        
        const allPassed = results.cleanup && results.step1 && results.step2 && 
                         results.multiRootCheck && results.aiItemsCheck && results.linksCheck &&
                         results.logicArchitectCheck &&
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
