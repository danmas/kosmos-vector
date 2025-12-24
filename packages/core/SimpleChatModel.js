// SimpleChatModel.js
const { BaseChatModel } = require("@langchain/core/language_models/chat_models");
const { AIMessage, BaseMessage, ChatMessage, HumanMessage, SystemMessage } = require("@langchain/core/messages");

/**
 * Простая реализация чат-модели для тестирования
 * Возвращает предопределенные ответы на основе ключевых слов в запросе
 */
class SimpleChatModel extends BaseChatModel {
  constructor(params = {}) {
    super(params);
    this.responses = params.responses || {
      "нейронные сети": "Нейронные сети - это вычислительные системы, вдохновленные биологическими нейронными сетями. Глубокое обучение использует многослойные нейронные сети для обработки данных.",
      "история искусственного интеллекта": "История искусственного интеллекта началась в середине 20-го века. Первые системы ИИ были созданы в 1950-х годах. Алан Тьюринг предложил тест Тьюринга как способ определения интеллекта машины.",
      "обработка естественного языка": "Обработка естественного языка (NLP) - это способность компьютера понимать человеческий язык. Современные модели, такие как GPT и BERT, используют трансформеры для обработки текста.",
      "default": "Извините, я не могу найти информацию по вашему запросу в доступных документах."
    };
    console.log("Инициализирована SimpleChatModel");
  }

  _llmType() {
    return "simple-chat-model";
  }

  /**
   * Генерирует ответ на основе сообщений
   * @param {BaseMessage[]} messages - Массив сообщений
   * @returns {Promise<AIMessage>} - Ответ модели
   */
  async _generate(messages) {
    // В RAG-цепочке LangChain передает найденные документы в виде SystemMessage.
    // Для нашего теста мы просто вернем содержимое первого системного сообщения.
    
    const systemMessage = messages.find(msg => msg instanceof SystemMessage);
    
    let responseText = this.responses.default; // Ответ по умолчанию

    if (systemMessage && systemMessage.content) {
      console.log(`[SimpleChatModel] Найден контекст: ${systemMessage.content.substring(0, 200)}...`);
      // Просто возвращаем первый документ/контекст, который нам передали.
      // В реальной модели здесь была бы сложная логика.
      responseText = `На основе найденного контекста: ${systemMessage.content}`;
    } else {
      console.log(`[SimpleChatModel] Контекст не найден, возвращаем ответ по умолчанию.`);
    }
    
    return {
      generations: [{
        text: responseText,
        message: new AIMessage(responseText)
      }]
    };
  }
}

module.exports = SimpleChatModel; 