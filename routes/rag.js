// routes/rag.js
// Расширенные RAG-эндпоинты с различными стратегиями поиска
const express = require('express');
const RAGRetriever = require('../packages/core/RAGRetriever');
const ContextBuilder = require('../packages/core/ContextBuilder');
const { callLLM } = require('../packages/core/llmClient');
const promptsService = require('../packages/core/promptsService');

const router = express.Router();

module.exports = (dbService, vectorStore, embeddings) => {
    /**
     * POST /api/rag/retrieve
     * Получить релевантный контекст без генерации ответа
     * 
     * Body:
     *   - query (required): Запрос пользователя
     *   - contextCode (required): Код контекста
     *   - strategy (optional): simple | hierarchical | aiitem | hybrid (default: hierarchical)
     *   - maxChunks (optional): Максимальное количество чанков (default: 10)
     *   - levels (optional): Массив уровней ["0-исходник", "1-связи", "2-логика"]
     *   - formatting (optional): Настройки форматирования
     *     - style: compact | standard | full | markdown
     *     - includeFileNames: boolean
     *     - includeRelations: boolean
     *     - maxTokens: number
     */
    router.post('/retrieve', async (req, res) => {
        try {
            const { 
                query, 
                contextCode, 
                strategy = 'hierarchical',
                maxChunks = 10,
                levels,
                formatting = {},
                includeRelations = true,
                expandGraph = false
            } = req.body;

            // Валидация
            if (!query || typeof query !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'Поле query обязательно и должно быть строкой'
                });
            }

            if (!contextCode) {
                return res.status(400).json({
                    success: false,
                    error: 'Поле contextCode обязательно'
                });
            }

            console.log(`[RAG/RETRIEVE] Query: "${query.substring(0, 100)}..."`);
            console.log(`[RAG/RETRIEVE] Strategy: ${strategy}, Context: ${contextCode}`);

            // Создаём RAGRetriever
            const ragRetriever = new RAGRetriever(dbService, embeddings, {
                strategy,
                maxChunks,
                levels,
                includeRelations,
                expandGraph
            });

            // Получаем контекст
            const retrievalResult = await ragRetriever.retrieve(query, contextCode);

            // Форматируем контекст
            const contextBuilder = new ContextBuilder({
                style: formatting.style || 'standard',
                includeFileNames: formatting.includeFileNames !== false,
                includeRelations: formatting.includeRelations !== false,
                maxTokens: formatting.maxTokens || 4000
            });

            const context = contextBuilder.build(retrievalResult, strategy);

            res.json({
                success: true,
                context,
                retrievalTime: retrievalResult.metadata.retrievalTime,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('[RAG/RETRIEVE] Ошибка:', error.message);
            console.error('[RAG/RETRIEVE] Stack:', error.stack);
            res.status(500).json({
                success: false,
                error: error.message || 'Внутренняя ошибка сервера'
            });
        }
    });

    /**
     * POST /api/rag/ask
     * Получить ответ LLM на основе RAG-контекста
     * 
     * Body:
     *   - query (required): Вопрос пользователя
     *   - contextCode (required): Код контекста
     *   - ragConfig (optional): Конфигурация RAG
     *     - strategy: simple | hierarchical | aiitem | hybrid
     *     - maxChunks: number
     *     - levels: string[]
     *     - formatting: object
     *   - llmConfig (optional): Конфигурация LLM
     *     - model: string
     *     - temperature: number
     *     - systemPrompt: string (перезаписывает стандартный)
     */
    router.post('/ask', async (req, res) => {
        try {
            const { 
                query, 
                contextCode, 
                ragConfig = {},
                llmConfig = {}
            } = req.body;

            // Валидация
            if (!query || typeof query !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'Поле query обязательно и должно быть строкой'
                });
            }

            if (!contextCode) {
                return res.status(400).json({
                    success: false,
                    error: 'Поле contextCode обязательно'
                });
            }

            console.log(`[RAG/ASK] Query: "${query.substring(0, 100)}..."`);
            console.log(`[RAG/ASK] RAG Strategy: ${ragConfig.strategy || 'hierarchical'}`);

            // 1. Получаем контекст через RAG
            const ragRetriever = new RAGRetriever(dbService, embeddings, {
                strategy: ragConfig.strategy || 'hierarchical',
                maxChunks: ragConfig.maxChunks || 10,
                levels: ragConfig.levels,
                includeRelations: ragConfig.includeRelations !== false,
                expandGraph: ragConfig.expandGraph || false
            });

            const retrievalResult = await ragRetriever.retrieve(query, contextCode);

            // 2. Форматируем контекст
            const formattingConfig = ragConfig.formatting || {};
            const contextBuilder = new ContextBuilder({
                style: formattingConfig.style || 'standard',
                includeFileNames: formattingConfig.includeFileNames !== false,
                includeRelations: formattingConfig.includeRelations !== false,
                maxTokens: formattingConfig.maxTokens || 4000
            });

            const contextData = contextBuilder.build(retrievalResult, ragConfig.strategy || 'hierarchical');

            // 3. Формируем промпт для LLM
            const ragPrompts = promptsService.getRagPrompts();
            const systemPrompt = llmConfig.systemPrompt || ragPrompts.systemPrompt;
            const userPrompt = ragPrompts.userPromptTemplate
                .replace('{context}', contextData.formatted)
                .replace('{question}', query);

            // 4. Вызываем LLM
            const messages = [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ];

            const llmResponse = await callLLM(messages, llmConfig.model);

            // 5. Формируем ответ
            res.json({
                success: true,
                answer: llmResponse,
                context: {
                    totalChunks: contextData.metadata.totalChunks,
                    totalTokens: contextData.metadata.totalTokens,
                    usedChunkIds: contextData.metadata.usedChunkIds,
                    strategy: ragConfig.strategy || 'hierarchical',
                    formattingStyle: contextData.metadata.formattingStyle
                },
                retrievalTime: retrievalResult.metadata.retrievalTime,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('[RAG/ASK] Ошибка:', error.message);
            console.error('[RAG/ASK] Stack:', error.stack);
            res.status(500).json({
                success: false,
                error: error.message || 'Внутренняя ошибка сервера'
            });
        }
    });

    /**
     * POST /api/rag/compare-strategies
     * Сравнить результаты разных стратегий RAG
     * Полезно для отладки и оптимизации
     * 
     * Body:
     *   - query (required): Запрос
     *   - contextCode (required): Код контекста
     *   - strategies (optional): Массив стратегий для сравнения (default: all)
     */
    router.post('/compare-strategies', async (req, res) => {
        try {
            const { 
                query, 
                contextCode,
                strategies = ['simple', 'hierarchical', 'aiitem']
            } = req.body;

            if (!query || !contextCode) {
                return res.status(400).json({
                    success: false,
                    error: 'Поля query и contextCode обязательны'
                });
            }

            console.log(`[RAG/COMPARE] Сравнение стратегий: ${strategies.join(', ')}`);

            const results = {};

            for (const strategy of strategies) {
                try {
                    const ragRetriever = new RAGRetriever(dbService, embeddings, {
                        strategy,
                        maxChunks: 5
                    });

                    const retrievalResult = await ragRetriever.retrieve(query, contextCode);

                    const contextBuilder = new ContextBuilder({
                        style: 'compact'
                    });

                    const contextData = contextBuilder.build(retrievalResult, strategy);

                    results[strategy] = {
                        success: true,
                        chunks: retrievalResult.chunks.length,
                        tokens: contextData.metadata.totalTokens,
                        retrievalTime: retrievalResult.metadata.retrievalTime,
                        preview: contextData.formatted.substring(0, 500) + '...'
                    };

                } catch (error) {
                    results[strategy] = {
                        success: false,
                        error: error.message
                    };
                }
            }

            res.json({
                success: true,
                query,
                contextCode,
                results,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('[RAG/COMPARE] Ошибка:', error.message);
            console.error('[RAG/COMPARE] Stack:', error.stack);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * GET /api/rag/strategies
     * Получить список доступных стратегий RAG с описанием
     */
    router.get('/strategies', (req, res) => {
        res.json({
            success: true,
            strategies: {
                simple: {
                    name: 'Simple',
                    description: 'Простой векторный поиск Top-K чанков',
                    useCases: ['Быстрый поиск', 'Общие вопросы'],
                    performance: 'Высокая',
                    complexity: 'Низкая'
                },
                hierarchical: {
                    name: 'Hierarchical',
                    description: 'Поиск с учётом иерархии чанков L0/L1/L2',
                    useCases: ['Анализ кода', 'Понимание зависимостей', 'Глубокое изучение'],
                    performance: 'Средняя',
                    complexity: 'Средняя'
                },
                aiitem: {
                    name: 'AI Item Based',
                    description: 'Поиск через AI Items с полным контекстом',
                    useCases: ['Анализ функций', 'Поиск связей', 'Граф зависимостей'],
                    performance: 'Средняя',
                    complexity: 'Высокая'
                },
                hybrid: {
                    name: 'Hybrid',
                    description: 'Комбинация векторного и keyword-поиска',
                    useCases: ['Сложные запросы', 'Максимальная точность'],
                    performance: 'Низкая',
                    complexity: 'Высокая'
                }
            }
        });
    });

    return router;
};
