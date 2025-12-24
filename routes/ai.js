const express = require('express');
const { VectorOperations } = require('@aian-vector/core');
const path = require('path');

const router = express.Router();

module.exports = (dbService, vectorStore, embeddings) => {
    // Вспомогательная функция для получения шаблонов промптов
    function getPromptTemplates(fileType, objectType, level) {
        // Убедимся, что все параметры - строки
        const ft = (fileType || 'js').toString().toUpperCase();
        const ot = (objectType || 'function').toString().toUpperCase();
        const l = `L${level}`;

        // Нормализация objectType для разных языков
        let normalizedOt = ot;
        
        // SQL нормализация
        if (ft === 'SQL') {
            if (ot && (ot.includes('FUNCTION') || ot.includes('PROCEDURE'))) normalizedOt = 'FUNCTION';
            else if (ot && (ot.includes('TABLE') || ot.includes('TYPE') || ot.includes('DOMAIN') || ot.includes('SEQUENCE'))) normalizedOt = 'TABLE';
            else if (ot && ot.includes('VIEW')) normalizedOt = 'VIEW';
        } 
        // JavaScript нормализация
        else if (ft === 'JS') {
            if (ot && (ot.includes('METHOD') || ot.includes('FUNCTION'))) normalizedOt = 'FUNCTION';
            else if (ot && ot.includes('CLASS')) normalizedOt = 'CLASS';
            else normalizedOt = 'FUNCTION'; // По умолчанию для JS
        }
        // Markdown нормализация
        else if (ft === 'MD') {
            normalizedOt = 'SECTION';
        }

        const promptTemplateName = `${ft}_${l}_${normalizedOt}_PROMPT`;
        const inputTextTemplateName = `${ft}_${l}_${normalizedOt}_INPUT_TEXT`;

        const prompt = process.env[promptTemplateName];
        const inputText = process.env[inputTextTemplateName];

        if (!prompt || !inputText) {
            throw new Error(`Template variables not found in .env: ${promptTemplateName} or ${inputTextTemplateName}`);
        }

        return { prompt, inputText, promptTemplateName, inputTextTemplateName };
    }

    // Dummy function to simulate calling an external AI service
    async function callAiService(prompt, content, level) {
        console.log(`[MOCK] callAiService: level=${level}`);
        console.log(`[MOCK] content: "${content.substring(0, 150)}..."`);
        
        if (level === 1) {
            const hasCalculateTotal = content.includes('calculateTotal()');
            const hasItemsReduce = content.includes('items.reduce');
            
            console.log(`[MOCK] hasCalculateTotal: ${hasCalculateTotal}`);
            console.log(`[MOCK] hasItemsReduce: ${hasItemsReduce}`);
            
            if (hasCalculateTotal && hasItemsReduce) {
                // Это JavaScript код с реализацией метода calculateTotal
                console.log(`[MOCK] Возвращаем JS контент`);
                return "Эта функция реализует требования, описанные в документе shopping_cart_spec.md в разделе 'Расчет итоговой стоимости'. Она не имеет внешних вызовов.";
            } else {
                // Это спецификация или другой контент
                console.log(`[MOCK] Возвращаем спецификацию контент`);
                return "Эта спецификация реализована в функции calculateTotal в файле shoppingCart.js.";
            }
        }
        if (level === 2) {
            return "Функция суммирует стоимость всех товаров. Если итог превышает 1000, применяется скидка 10%.";
        }
        return `Generated content for level ${level} based on prompt: ${prompt}`;
    }

    // --- Роуты для RAG ---

    router.post('/ask', async (req, res) => {
        try {
            const { question, contextCode, showDetails, maxResults, chunkType, chunkLevel, model } = req.body;

            if (!question) {
                return res.status(400).json({ error: 'Question is required' });
            }
            
            // Устанавливаем фильтры в vectorStore
            vectorStore.setContextCode(contextCode);
            
            const result = await VectorOperations.answerQuestion(
                question,
                vectorStore,
                contextCode,
                showDetails
            );
            
            res.json({
                answer: result.text,
                filters: { contextCode, chunkType, chunkLevel, model },
                details: showDetails ? result : undefined
            });

        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });


    // --- Роуты для AI Items ---

    // Получение списка всех AI Items
    router.get('/ai-items', async (req, res) => {
        try {
            const { contextCode } = req.query;
            console.log(`[AI-ITEMS] Запрос AI Items с contextCode: "${contextCode}"`);
            
            const items = await dbService.getAllAiItems(contextCode);
            
            console.log(`[AI-ITEMS] Возвращаем ${items.length} AI Items клиенту`);
            res.json({ success: true, items });
        } catch (error) {
            console.error(`[AI-ITEMS] Ошибка при получении AI Items:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    // Получение AI Item по ID
    router.get('/ai-item/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const item = await dbService.getAiItemById(id);
            if (!item) {
                return res.status(404).json({ error: 'AI Item not found' });
            }
            res.json(item);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Получение чанков, связанных с AI Item
    router.get('/ai-item-chunks/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const { level } = req.query;
            const chunks = await dbService.getAiItemChunks(id, level);
            const aiItem = await dbService.getAiItemById(id);
            res.json({ aiItem, chunks });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Альтернативный маршрут для получения чанков AI Item
    router.get('/ai-item/:id/chunks', async (req, res) => {
        try {
            const { id } = req.params;
            const { level } = req.query;
            const chunks = await dbService.getAiItemChunks(id, level);
            const item = await dbService.getAiItemById(id);
            res.json({ success: true, item, chunks, level });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Обновление контекста для AI Item
    router.post('/ai-item/:id/update-context', async (req, res) => {
        try {
            const { id } = req.params;
            const { contextCode } = req.body;
            if (!contextCode) {
                return res.status(400).json({ error: 'contextCode is required' });
            }
            const item = await dbService.updateAiItemContext(id, contextCode);
            res.json({ success: true, message: 'Context updated', item });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Очистка неиспользуемых AI Items
    router.post('/ai-items/cleanup', async (req, res) => {
        try {
            const contextCode = req.body.contextCode || req.query.contextCode || req.query['context-code'] || null;
            const deletedItems = await dbService.cleanupOrphanedAiItems(contextCode);
            res.json({ success: true, message: `Deleted ${deletedItems.length} orphaned AI items.`, deletedItems });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Создание нового AI Item
    router.post('/create-ai-item', async (req, res) => {
        try {
            const { chunkId, full_name, contextCode, type, sName } = req.body;
            if (!chunkId || !full_name || !contextCode) {
                return res.status(400).json({ error: 'chunkId, full_name, and contextCode are required' });
            }
            const aiItem = await dbService.createAiItem({ chunkId, full_name, contextCode, type, sName });
            res.json({ success: true, aiItem });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Генерация чанков L1/L2 для AI Item
    router.post('/api/ai/ai-item/:id/generate-chunk', async (req, res) => {
        try {
            const { id: aiItemId } = req.params;
            // prompt и inputText теперь опциональны
            const { level, prompt: customPrompt, inputText: customInputText, model } = req.body;

            if (!level) {
                return res.status(400).json({ error: 'level is required' });
            }

            // 1. Получаем AI Item и его основной чанк (L0)
            const aiItem = await dbService.getAiItemById(aiItemId);
            if (!aiItem) {
                return res.status(404).json({ error: 'AI Item not found' });
            }

            const l0_chunks = await dbService.getAiItemChunks(aiItemId, '0-исходник');
            if (!l0_chunks || l0_chunks.length === 0) {
                return res.status(404).json({ error: 'Level 0 chunk for AI Item not found' });
            }
            const parentChunk = l0_chunks[0];
            
            // Получаем информацию о файле, но проверяем на ошибки
            const contextCode = req.body.contextCode || req.query.contextCode || req.query['context-code'] || null;
            const fileInfo = await dbService.getFileById(parentChunk.file_id, contextCode);
            // Получаем тип файла и тип объекта
            let fileType;
            const aiItemType = (aiItem.type || '').toLowerCase();
            
            // Для Markdown AI Item всегда используем тип 'md'
            if (aiItemType === 'markdown' || aiItemType === 'md' || aiItemType.includes('markdown') || aiItemType.includes('section')) {
                fileType = 'md';
                console.log(`[GENERATE] Определен тип файла как 'md' на основе типа AI Item: ${aiItemType}`);
            } else if (!fileInfo || !fileInfo.file_name) {
                console.error(`[GENERATE] Не удалось получить информацию о файле для чанка ${parentChunk.id}`);
                // Используем тип из AI Item, если не можем определить по расширению файла
                fileType = aiItemType.includes('function') || aiItemType.includes('class') || aiItemType.includes('method') ? 'js' : 
                          aiItemType.includes('table') ? 'sql' : 'js';
            } else {
                // Определяем тип файла по расширению
                const ext = path.extname(fileInfo.file_name).substring(1).toLowerCase();
                fileType = ext || 'js';
                
                // Для Markdown-документа всегда используем тип 'md' независимо от AI Item
                if (ext === 'md' || ext === 'markdown') {
                    fileType = 'md';
                }
            }
            
            console.log(`[GENERATE] AI Item ID: ${aiItemId}, name: ${aiItem.full_name}, type: ${aiItem.type}`);
            console.log(`[GENERATE] Определен тип файла: ${fileType}, тип объекта: ${aiItemType}`);
            
            // Для Markdown всегда используем специальный тип 'section'
            const objectTypeForTemplate = fileType === 'md' ? 'section' : aiItem.type;

            let prompt;
            let inputText;
            let promptInfo;

            if (customPrompt && customInputText) {
                // Пользовательский режим
                prompt = customPrompt;
                inputText = customInputText;
                promptInfo = {
                    type: 'custom',
                    prompt,
                    inputText
                };
                console.log(`[GENERATE] Using custom prompt for AI Item ${aiItemId}`);

            } else {
                // Автоматический режим
                console.log(`[GENERATE] Using automatic prompt selection for AI Item ${aiItemId}`);
                console.log(`[GENERATE] File type: ${fileType}, object type for template: ${objectTypeForTemplate}`);
                const templates = getPromptTemplates(fileType, objectTypeForTemplate || 'function', level);
                prompt = templates.prompt;
                inputText = templates.inputText;
                promptInfo = {
                    type: 'auto',
                    promptTemplate: templates.promptTemplateName,
                    inputTextTemplate: templates.inputTextTemplateName
                };
            }

            // 2. Удаляем существующие чанки этого уровня для данного AI Item
            const levelName = level === 1 ? '1-связи' : '2-логика';
            console.log(`[GENERATE] Удаляем существующие чанки уровня ${levelName} для AI Item ${aiItemId}`);
            await dbService.deleteChildChunks(parentChunk.id, levelName);

            // 3. Вызываем (мокированный) AI сервис для генерации контента
            const fullPrompt = `${prompt}\n\n${inputText}`; // Можем передать полный промпт или разделить
            const generatedContent = await callAiService(fullPrompt, parentChunk.chunk_content, level);

            // 4. Создаем embedding для нового контента
            const [embedding] = await embeddings.embedDocuments([generatedContent]);

            // 5. Сохраняем новый чанк как дочерний
            // Обертываем generatedContent в JSON объект для JSONB
            const newChunk = await dbService.saveChildChunk(
                parentChunk.file_id,
                parentChunk.id,
                { text: generatedContent },
                embedding,
                levelName, 
                `generated-${level}`,
                {},
                aiItemId
            );

            res.json({ success: true, newChunk, promptInfo });

        } catch (error) {
            console.error(`Error generating chunk for AI Item ${req.params.id}:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};
