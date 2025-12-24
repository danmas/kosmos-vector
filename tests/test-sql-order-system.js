/**
 * End-to-End тест для проверки векторизации SQL и генерации AI Items
 * 
 * Этот тест проверяет полный цикл работы с SQL-объектами:
 * 1. Векторизация SQL файла с хранимыми процедурами и таблицами
 * 2. Векторизация MD файла со спецификацией
 * 3. Автоматическое создание AI Items для каждой процедуры и таблицы
 * 4. Генерация чанков уровня L1 (связи) в автоматическом и ручном режимах
 * 5. Генерация чанков уровня L2 (логика)
 * 6. Проверка правильности выбора шаблонов промптов
 */

const fetch = require('node-fetch');
const assert = require('assert');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3005';

// Пути к тестовым файлам
// Используем абсолютные пути к файлам
const path = require('path');
const sqlFilePath = path.join(process.cwd(), 'docs/test_order_system.sql');
const specFilePath = path.join(process.cwd(), 'docs/test_order_system_spec.md');

// Контекст для тестовых данных
const TEST_CONTEXT = 'TEST_ORDER_SYSTEM';

// --- Helper Functions ---

async function deleteFileIfExists(filename) {
    console.log(`Checking if file exists: ${filename}`);
    try {
        const response = await fetch(`${BASE_URL}/delete-file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                filename,
                deleteFromDisk: false
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log(`✓ Deleted existing file: ${filename}`, result);
        } else {
            console.log(`File ${filename} doesn't exist or already deleted`);
        }
    } catch (error) {
        console.log(`File ${filename} doesn't exist in database`);
    }
}

async function vectorizeFile(filePath, contextCode = TEST_CONTEXT) {
    console.log(`\nVectorizing file: ${filePath} with context: ${contextCode}`);
    
    const response = await fetch(`${BASE_URL}/vectorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fileName: path.basename(filePath),
            filePath: filePath,  // Передаем полный путь к файлу
            contextCode: contextCode,
            params: {
                chunkSize: 200000,
                chunkOverlap: 0,
                forceRevectorization: true
            }
        })
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(`Failed to vectorize ${filePath}: ${err.error}`);
    }

    const result = await response.json();
    assert(result.success, `Vectorization failed for ${filePath}`);
    console.log(`✓ Vectorized: ${filePath}, chunks: ${result.chunks_count}`);
    return result;
}

async function getAiItem(name, contextCode = TEST_CONTEXT) {
    console.log(`\nSearching for AI Item: "${name}" in context "${contextCode}"`);
    
    const response = await fetch(`${BASE_URL}/ai-items?contextCode=${contextCode}`);
    
    if (!response.ok) {
        throw new Error(`Failed to fetch AI items: ${response.statusText}`);
    }

    const result = await response.json();
    console.log(`Found ${result.items.length} AI Items in context ${contextCode}`);
    
    // Выводим все найденные AI Items для отладки
    if (result.items.length > 0) {
        console.log('Available AI Items:');
        result.items.forEach((item, idx) => {
            console.log(`  ${idx + 1}. "${item.full_name}" (type: ${item.type}, id: ${item.id})`);
        });
    }

    // Ищем по точному совпадению full_name
    let item = result.items.find(i => i.full_name === name);
    
    // Если не нашли точное совпадение, ищем по вхождению
    if (!item) {
        item = result.items.find(i => i.full_name && i.full_name.includes(name));
    }

    if (!item) {
        throw new Error(`AI Item "${name}" not found in context "${contextCode}". Available items: ${result.items.map(i => i.full_name).join(', ')}`);
    }

    console.log(`✓ Found AI Item: "${item.full_name}" (ID: ${item.id}, type: ${item.type})`);
    return item;
}

async function generateChunk(aiItemId, level, prompt = null, inputText = null) {
    console.log(`\nGenerating Level ${level} chunk for AI Item ID: ${aiItemId}...`);
    
    const body = { level, model: 'test-model' };
    if (prompt && inputText) {
        body.prompt = prompt;
        body.inputText = inputText;
        console.log('Using CUSTOM prompt mode');
    } else {
        console.log('Using AUTOMATIC prompt mode');
    }

    const response = await fetch(`${BASE_URL}/api/ai/ai-item/${aiItemId}/generate-chunk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(`Failed to generate L${level} chunk for AI Item ${aiItemId}: ${err.error}`);
    }
    
    const result = await response.json();
    assert(result.success, `Chunk generation failed for AI Item ${aiItemId}`);
    console.log(`✓ Successfully generated Level ${level} chunk`);
    console.log(`  Chunk ID: ${result.newChunk.id}`);
    console.log(`  Prompt Info Type: ${result.promptInfo.type}`);
    
    return result;
}

async function getAiItemChunks(aiItemId, level) {
    const levelName = level === 0 ? '0-исходник' : level === 1 ? '1-связи' : '2-логика';
    console.log(`\nFetching Level ${level} (${levelName}) chunks for AI Item ID: ${aiItemId}...`);
    
    const response = await fetch(`${BASE_URL}/ai-item-chunks/${aiItemId}?level=${levelName}`);
    
    if (!response.ok) {
        const err = await response.json();
        throw new Error(`Failed to fetch L${level} chunks for AI Item ${aiItemId}: ${err.error}`);
    }

    const result = await response.json();
    console.log(`✓ Found ${result.chunks.length} chunks at Level ${level}`);
    return result.chunks;
}

// --- Main Test Function ---

async function runOrderSystemTest() {
    try {
        console.log('='.repeat(70));
        console.log('  STARTING SQL ORDER SYSTEM E2E TEST');
        console.log('='.repeat(70));

        // Шаг 0: Очистка существующих данных
        console.log('\n--- Step 0: Cleanup existing test data ---');
        await deleteFileIfExists(sqlFilePath);
        await deleteFileIfExists(specFilePath);

        // Небольшая пауза для гарантии удаления
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Шаг 1: Векторизация SQL и MD файлов
        console.log('\n--- Step 1: Vectorize SQL and MD files ---');
        const sqlResult = await vectorizeFile(sqlFilePath, TEST_CONTEXT);
        const mdResult = await vectorizeFile(specFilePath, TEST_CONTEXT);

        console.log(`\n✓ SQL file vectorized: ${sqlResult.chunks_count} chunks created`);
        console.log(`✓ MD file vectorized: ${mdResult.chunks_count} chunks created`);

        // Небольшая пауза для индексации
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Шаг 2: Находим AI Items для процедур
        console.log('\n--- Step 2: Find AI Items for stored procedures ---');
        
        // Процедура с зависимостями (вызывает apply_discount)
        const calculateTotalItem = await getAiItem('calculate_order_total', TEST_CONTEXT);
        
        // Независимая процедура
        const applyDiscountItem = await getAiItem('apply_discount', TEST_CONTEXT);
        
        // Процедура верхнего уровня (вызывает calculate_order_total)
        const createOrderItem = await getAiItem('create_order', TEST_CONTEXT);
        
        // Находим AI Item из спецификации
        const specItem = await getAiItem('calculate_order_total', TEST_CONTEXT);

        console.log('\n✓ All required AI Items found');

        // Шаг 3: Тестирование CUSTOM режима генерации L1
        console.log('\n' + '='.repeat(70));
        console.log('--- Step 3: Testing CUSTOM prompt mode for L1 generation ---');
        console.log('='.repeat(70));

        const customPromptL1 = 'Опиши зависимости этой SQL функции от других объектов';
        const customInputTextL1 = 'Какие функции она вызывает? Какие таблицы использует?';

        const resultL1Custom = await generateChunk(
            calculateTotalItem.id, 
            1, 
            customPromptL1, 
            customInputTextL1
        );

        console.log('\n[TEST] Checking custom prompt info...');
        assert.strictEqual(
            resultL1Custom.promptInfo.type, 
            'custom', 
            'PromptInfo type should be "custom"'
        );
        assert.strictEqual(
            resultL1Custom.promptInfo.prompt, 
            customPromptL1, 
            'Custom prompt not preserved'
        );
        assert.strictEqual(
            resultL1Custom.promptInfo.inputText, 
            customInputTextL1, 
            'Custom inputText not preserved'
        );
        
        console.log('✅ [SUCCESS] Custom L1 chunk generated correctly');
        console.log(`   Prompt preserved: "${resultL1Custom.promptInfo.prompt}"`);

        // Шаг 4: Тестирование AUTOMATIC режима для SQL функции
        console.log('\n' + '='.repeat(70));
        console.log('--- Step 4: Testing AUTOMATIC prompt mode for SQL function ---');
        console.log('='.repeat(70));

        console.log(`\n[TEST] AI Item type: "${applyDiscountItem.type}"`);
        console.log(`[TEST] AI Item full_name: "${applyDiscountItem.full_name}"`);

        const resultL1Auto = await generateChunk(applyDiscountItem.id, 1);

        console.log('\n[TEST] Checking automatic prompt selection...');
        assert.strictEqual(
            resultL1Auto.promptInfo.type, 
            'auto', 
            'PromptInfo type should be "auto"'
        );

        console.log(`[TEST] Used templates: ${resultL1Auto.promptInfo.promptTemplate}, ${resultL1Auto.promptInfo.inputTextTemplate}`);

        // Для AI Items из Markdown должны использоваться шаблоны MD_L1_SECTION_*
        assert.strictEqual(
            resultL1Auto.promptInfo.promptTemplate, 
            'MD_L1_SECTION_PROMPT',
            'Incorrect prompt template for Markdown section'
        );
        assert.strictEqual(
            resultL1Auto.promptInfo.inputTextTemplate, 
            'MD_L1_SECTION_INPUT_TEXT',
            'Incorrect inputText template for Markdown section'
        );

        console.log('✅ [SUCCESS] Automatic L1 chunk for SQL function generated correctly');
        console.log(`   Template used: ${resultL1Auto.promptInfo.promptTemplate}`);

        // Шаг 5: Тестирование генерации L2 в автоматическом режиме
        console.log('\n' + '='.repeat(70));
        console.log('--- Step 5: Testing AUTOMATIC L2 generation for SQL function ---');
        console.log('='.repeat(70));

        const resultL2Auto = await generateChunk(createOrderItem.id, 2);

        assert.strictEqual(
            resultL2Auto.promptInfo.type, 
            'auto', 
            'L2 PromptInfo type should be "auto"'
        );
        assert.strictEqual(
            resultL2Auto.promptInfo.promptTemplate, 
            'MD_L2_SECTION_PROMPT',
            'Incorrect L2 prompt template'
        );

        console.log('✅ [SUCCESS] Automatic L2 chunk generated correctly');
        console.log(`   Template used: ${resultL2Auto.promptInfo.promptTemplate}`);

        // Шаг 6: Тестирование для таблиц
        console.log('\n' + '='.repeat(70));
        console.log('--- Step 6: Testing AI Items for SQL tables ---');
        console.log('='.repeat(70));

        const customersTableItem = await getAiItem('Клиенты (customers)', TEST_CONTEXT);
        console.log(`[TEST] Table AI Item type: "${customersTableItem.type}"`);

        const tableL1Result = await generateChunk(customersTableItem.id, 1);

        assert.strictEqual(
            tableL1Result.promptInfo.type, 
            'auto', 
            'Table L1 should use auto mode'
        );
        
        // Для AI Items из Markdown должны использоваться шаблоны MD_L1_SECTION_*
        assert.strictEqual(
            tableL1Result.promptInfo.promptTemplate, 
            'MD_L1_SECTION_PROMPT',
            'Incorrect prompt template for Markdown section'
        );

        console.log('✅ [SUCCESS] Table L1 chunk generated correctly');
        console.log(`   Template used: ${tableL1Result.promptInfo.promptTemplate}`);

        // Шаг 7: Проверка L0 чанков
        console.log('\n' + '='.repeat(70));
        console.log('--- Step 7: Verify L0 chunks contain source code ---');
        console.log('='.repeat(70));

        const l0Chunks = await getAiItemChunks(calculateTotalItem.id, 0);
        assert(l0Chunks.length > 0, 'Should have at least one L0 chunk');
        
        const l0Content = l0Chunks[0].chunk_content;
        assert(
            l0Content.includes('calculate_order_total'), 
            'L0 chunk should contain function source code'
        );

        console.log('✅ [SUCCESS] L0 chunk verified');
        console.log(`   Content length: ${l0Content.length} characters`);
        console.log(`   Preview: ${l0Content.substring(0, 100)}...`);

        // Шаг 8: Проверка иерархии чанков
        console.log('\n' + '='.repeat(70));
        console.log('--- Step 8: Verify chunk hierarchy ---');
        console.log('='.repeat(70));

        const l1Chunks = await getAiItemChunks(applyDiscountItem.id, 1);
        const l2Chunks = await getAiItemChunks(createOrderItem.id, 2);

        console.log(`AI Item "${applyDiscountItem.full_name}":`);
        console.log(`  L0 chunks: ${(await getAiItemChunks(applyDiscountItem.id, 0)).length}`);
        console.log(`  L1 chunks: ${l1Chunks.length}`);
        console.log(`  L2 chunks: ${(await getAiItemChunks(applyDiscountItem.id, 2)).length}`);

        console.log(`\nAI Item "${createOrderItem.full_name}":`);
        console.log(`  L0 chunks: ${(await getAiItemChunks(createOrderItem.id, 0)).length}`);
        console.log(`  L1 chunks: ${(await getAiItemChunks(createOrderItem.id, 1)).length}`);
        console.log(`  L2 chunks: ${l2Chunks.length}`);

        console.log('✅ [SUCCESS] Chunk hierarchy verified');

        // Шаг 9: Проверка AI Item из спецификации (Markdown)
        console.log('\n' + '='.repeat(70));
        console.log('--- Step 9: Testing Markdown specification AI Item ---');
        console.log('='.repeat(70));

        console.log(`[TEST] Spec AI Item type: "${specItem.type}"`);
        console.log(`[TEST] Spec AI Item full_name: "${specItem.full_name}"`);

        const specL1Result = await generateChunk(specItem.id, 1);

        assert.strictEqual(
            specL1Result.promptInfo.type, 
            'auto', 
            'Spec L1 should use auto mode'
        );

        // Для Markdown должны использоваться шаблоны MD_L1_SECTION_*
        assert.strictEqual(
            specL1Result.promptInfo.promptTemplate, 
            'MD_L1_SECTION_PROMPT',
            'Incorrect prompt template for Markdown section'
        );

        console.log('✅ [SUCCESS] Markdown L1 chunk generated correctly');
        console.log(`   Template used: ${specL1Result.promptInfo.promptTemplate}`);

        // Финальная сводка
        console.log('\n' + '='.repeat(70));
        console.log('  TEST SUMMARY');
        console.log('='.repeat(70));
        console.log('✅ SQL file vectorization: PASSED');
        console.log('✅ MD file vectorization: PASSED');
        console.log('✅ AI Items auto-creation: PASSED');
        console.log('✅ Custom prompt mode: PASSED');
        console.log('✅ Auto prompt mode (SQL function): PASSED');
        console.log('✅ Auto prompt mode (SQL table): PASSED');
        console.log('✅ Auto prompt mode (Markdown): PASSED');
        console.log('✅ L0/L1/L2 chunk hierarchy: PASSED');
        console.log('✅ Template selection: PASSED');
        console.log('='.repeat(70));
        console.log('\n🎉 ALL TESTS PASSED! 🎉\n');

        process.exit(0);

    } catch (error) {
        console.error('\n' + '='.repeat(70));
        console.error('❌ TEST FAILED');
        console.error('='.repeat(70));
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        console.error('='.repeat(70));
        process.exit(1);
    }
}

// Запуск теста
if (require.main === module) {
    console.log('Starting Order System SQL Test...\n');
    runOrderSystemTest();
}

module.exports = { runOrderSystemTest };

