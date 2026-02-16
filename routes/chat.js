// routes/chat.js
// Роутер для RAG-чата с интеграцией kosmos-model LLM
const express = require('express');
const { callLLM } = require('../packages/core/llmClient');
const promptsService = require('../packages/core/promptsService');
const RAGRetriever = require('../packages/core/RAGRetriever');
const ContextBuilder = require('../packages/core/ContextBuilder');

const router = express.Router();

module.exports = (dbService, vectorStore, embeddings) => {
    /**
     * POST /api/chat
     * Задать вопрос по коду с использованием RAG
     * 
     * Query params:
     *   - context-code (required): Контекстный код для изоляции данных
     * 
     * Body:
     *   - message (required): Вопрос пользователя
     * 
     * Response:
     *   - response: Ответ от LLM
     *   - usedContextIds: Массив ID чанков, использованных как контекст
     *   - timestamp: Время ответа
     */
    router.post('/chat', async (req, res) => {
        try {
            // Валидация параметров
            const contextCode = req.query['context-code'] || req.query.contextCode;
            if (!contextCode) {
                return res.status(400).json({
                    success: false,
                    error: 'Параметр context-code обязателен'
                });
            }

            const { message, useRAG = false } = req.body;
            if (!message || typeof message !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'Поле message обязательно и должно быть строкой'
                });
            }

            if (useRAG) {
                console.log('[CHAT] Используется RAG-поиск контекста');
                
                // Используем RAGRetriever для интеллектуального поиска контекста
                const ragRetriever = new RAGRetriever(dbService, embeddings, {
                    strategy: 'hierarchical',
                    maxChunks: parseInt(process.env.MAX_RESULTS) || 5,
                    includeRelations: true
                });
                
                const retrievalResult = await ragRetriever.retrieve(message, contextCode);
                
                // Форматируем контекст с помощью ContextBuilder
                const contextBuilder = new ContextBuilder({
                    style: 'standard',
                    includeFileNames: true,
                    includeRelations: true
                });
                
                const contextData = contextBuilder.build(retrievalResult, 'hierarchical');
                const contextText = contextData.formatted;
                const usedContextIds = contextData.metadata.usedChunkIds;

                // Формируем промпт для LLM из prompts.json
                const ragPrompts = promptsService.getRagPrompts();
                const systemPrompt = ragPrompts.systemPrompt;
                const userPrompt = ragPrompts.userPromptTemplate
                    .replace('{context}', contextText)
                    .replace('{question}', message);

                // Формируем сообщения для LLM
                const messages = [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ];

                // Вызываем LLM
                const response = await callLLM(messages);

                // Формируем ответ согласно контракту
                res.json({
                    response: response,
                    usedContextIds: usedContextIds,
                    timestamp: new Date().toISOString()
                });
            } else {
                console.log('[CHAT] RAG отключён, отправка message напрямую в LLM');
                
                // Отправляем message напрямую в LLM без RAG-поиска и векторизации
                const messages = [
                    { role: "user", content: message }
                ];

                // Вызываем LLM
                const response = await callLLM(messages);

                // Формируем ответ согласно контракту
                res.json({
                    response: response,
                    usedContextIds: [],
                    timestamp: new Date().toISOString()
                });
            }

        } catch (error) {
            console.error('[CHAT] Ошибка:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Внутренняя ошибка сервера'
            });
        }
    });

    /**
     * POST /api/ask
     * Прямой запрос к LLM без RAG/векторизации
     * 
     * Body:
     *   - message (required): Сообщение пользователя
     *   - systemPrompt (optional): Системный промпт
     *   - model (optional): Имя модели
     * 
     * Response:
     *   - response: Ответ от LLM
     *   - timestamp: Время ответа
     */
    router.post('/ask', async (req, res) => {
        try {
            const { message, systemPrompt, model } = req.body;

            if (!message || typeof message !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'Поле message обязательно и должно быть строкой'
                });
            }

            // Формируем сообщения для LLM
            const messages = [];
            
            if (systemPrompt) {
                messages.push({ role: "system", content: systemPrompt });
            }
            
            messages.push({ role: "user", content: message });

            // Вызываем LLM
            const response = await callLLM(messages, model);

            res.json({
                response: response,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('[ASK] Ошибка:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Внутренняя ошибка сервера'
            });
        }
    });

    return router;
};

