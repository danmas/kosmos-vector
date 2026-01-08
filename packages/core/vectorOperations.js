// vectorOperations.js
const SimpleChatModel = require("./SimpleChatModel");
const { RetrievalQAChain, loadQAStuffChain } = require("langchain/chains");
const { PromptTemplate } = require("@langchain/core/prompts");
const promptsService = require("./promptsService");


/**
 * Эта модифицированная версия функции answerQuestion позволяет получить доступ 
 * к документам, которые выбрал ретривер, 
 * и к промпту, который передается языковой модели.
 * 
 * Функция для ответа на вопросы с использованием RAG с возможностью просмотра документов и промпта
 * @param {string} question - Вопрос пользователя
 * @param {Object} vectorStore - Экземпляр векторного хранилища
 * @param {string|null} contextCode - Код контекста для фильтрации результатов (опционально)
 * @param {boolean} returnDocumentsAndPrompt - Флаг для возврата документов и промпта (по умолчанию false)
 * @returns {Promise<Object>} Ответ на вопрос и опционально документы и промпт
 */
async function answerQuestion(question, vectorStore, contextCode = null, returnDocumentsAndPrompt = false) {
  
  try {
    // Инициализация модели
    // const model = new ChatOpenAI({
    //   modelName: "gpt-3.5-turbo",
    //   temperature: 0,
    // });
    
    // Используем локальную модель Ollama вместо OpenAI
    // const model = new ChatOllama({
    //   baseUrl: "http://localhost:11434", // URL Ollama API
    //   model: "llama2", // или другая доступная модель
    //   temperature: 0,
    // });
    
    // Используем нашу простую модель
    const model = new SimpleChatModel();
    
    // Установка контекстного кода для векторного хранилища, если задан
    if (contextCode) {
      vectorStore.setContextCode(contextCode);
    } else {
      vectorStore.setContextCode(null);
    }
    
    // Получаем ретривер из векторного хранилища
    const retriever = vectorStore.asRetriever();
    
    // Если нужно вернуть документы, получаем их напрямую из ретривера
    let documents = [];
    if (returnDocumentsAndPrompt) {
      documents = await retriever.getRelevantDocuments(question);
      console.log("Найденные документы:", documents);
    }
    
    // Создаём кастомный промпт-шаблон, чтобы можно было его вернуть
    let promptTemplate;
    if (returnDocumentsAndPrompt) {
      const qaPromptTemplate = promptsService.getQaPromptTemplate();
      promptTemplate = PromptTemplate.fromTemplate(qaPromptTemplate);
    }
    
    // Создание цепочки для ответа на вопросы
    let chain;
    let prompt;
    
    if (returnDocumentsAndPrompt) {
      // Создаём цепочку с возможностью получить промпт
      const loadedVectorStore = {
        vectorStore,
        retriever,
        docStore: { search: async () => documents }
      };
      
      chain = new RetrievalQAChain({
        retriever: loadedVectorStore.retriever,
        combineDocumentsChain: loadQAStuffChain(model, { prompt: promptTemplate }),
        returnSourceDocuments: true
      });
      
      // Формируем промпт вручную для просмотра
      const context = documents.map(doc => doc.pageContent).join('\n\n');
      prompt = await promptTemplate.format({ context, question });
      console.log("Промпт для модели:", prompt);
    } else {
      // Стандартная цепочка, если не нужны детали
      chain = RetrievalQAChain.fromLLM(model, retriever);
    }
    
    // Получение ответа
    console.log("Поиск ответа...");
    const response = await chain.call({
      query: question,
    });
    
    const result = {
      text: response.text,
      source: "postgres",
      contextCode: contextCode
    };
    
    // Добавляем документы и промпт, если требуется
    if (returnDocumentsAndPrompt) {
      result.documents = documents;
      result.prompt = prompt;
      
      // Если ответ содержит ссылки на источники, добавляем их
      if (response.sourceDocuments) {
        result.sourceDocuments = response.sourceDocuments;
      }
    }
    
    return result;
  } catch (error) {
    console.error("Ошибка при ответе на вопрос:", error);
    throw error;
  }
}


/**
 * Функция для ответа на вопросы с использованием RAG
 * @param {string} question - Вопрос пользователя
 * @param {Object} vectorStore - Экземпляр векторного хранилища
 * @param {string|null} contextCode - Код контекста для фильтрации результатов (опционально)
 * @returns {Promise<Object>} Ответ на вопрос
 */
async function answerQuestion_OLD(question, vectorStore, contextCode = null) {
  console.log(`Вопрос: ${question}`);
  
  try {
    // Инициализация модели
    const model = new SimpleChatModel();
    
    // Установка контекстного кода для векторного хранилища, если задан
    if (contextCode) {
      vectorStore.setContextCode(contextCode);
    } else {
      vectorStore.setContextCode(null);
    }
    
    // Создание цепочки для ответа на вопросы
    const chain = RetrievalQAChain.fromLLM(model, vectorStore.asRetriever());
    
    // Получение ответа
    console.log("Поиск ответа...");
    const response = await chain.call({
      query: question,
    });
    
    return {
      text: response.text,
      source: "postgres",
      contextCode: contextCode
    };
  } catch (error) {
    console.error("Ошибка при ответе на вопрос:", error);
    throw error;
  }
}

module.exports = {
  answerQuestion,
  answerQuestion_OLD
};
