// routes/chat.js
// Роутер для RAG-чата с интеграцией kosmos-model LLM
const express = require('express');
const { callLLM } = require('../packages/core/llmClient');
const promptsService = require('../packages/core/promptsService');

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

            const { message } = req.body;
            if (!message || typeof message !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'Поле message обязательно и должно быть строкой'
                });
            }

            // Устанавливаем контекстный код для векторного хранилища
            vectorStore.setContextCode(contextCode);

            // Создаем эмбеддинг для запроса
            const queryEmbedding = await embeddings.embedQuery(message);

            // Поиск релевантных документов (по умолчанию 5, можно настроить)
            const maxResults = parseInt(process.env.MAX_RESULTS) || 5;
            const relevantDocs = await dbService.similaritySearch(
                queryEmbedding,
                maxResults,
                contextCode
            );

            // Формируем контекст из найденных документов
            const contextText = relevantDocs
                .map((doc, index) => `[Документ ${index + 1}]\n${doc.content}`)
                .join('\n\n');

            // Собираем ID использованных чанков
            const usedContextIds = relevantDocs.map(doc => doc.id);

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
            const chatResponse = {
                response: response,
                usedContextIds: usedContextIds,
                timestamp: new Date().toISOString()
            };

            res.json(chatResponse);

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

