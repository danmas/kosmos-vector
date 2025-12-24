// EmbeddingsFactory.js
const SimpleEmbeddings = require('./SimpleEmbeddings');
const { OpenAIEmbeddings } = require("@langchain/openai");

/**
 * Фабрика для создания моделей эмбеддингов
 * Позволяет переключаться между различными моделями эмбеддингов
 * на основе настроек в .env файле
 */
class EmbeddingsFactory {
  /**
   * Создает экземпляр фабрики эмбеддингов
   * @param {Object} config - Конфигурация фабрики
   */
  constructor(config = {}) {
    this.config = config;
    this.openAIApiKey = config.openAIApiKey || process.env.OPENAI_API_KEY;
    this.defaultModel = config.defaultModel || process.env.EMBEDDINGS_MODEL || 'simple';
    
    console.log(`Инициализирована EmbeddingsFactory с моделью по умолчанию: ${this.defaultModel}`);
  }
  
  /**
   * Создает модель эмбеддингов на основе указанного типа
   * @param {string} type - Тип модели эмбеддингов ('simple' или 'openai')
   * @returns {Object} - Экземпляр модели эмбеддингов
   */
  createEmbeddings(type = null) {
    // Если тип не указан, используем значение по умолчанию
    const embeddingsType = type || this.defaultModel;
    
    // Создаем соответствующую модель эмбеддингов
    if (embeddingsType === 'openai') {
      if (!this.openAIApiKey) {
        throw new Error('OpenAI API ключ не указан. Укажите OPENAI_API_KEY в .env файле.');
      }
      
      console.log('Создание OpenAIEmbeddings...');
      return new OpenAIEmbeddings({
        openAIApiKey: this.openAIApiKey,
        modelName: "text-embedding-ada-002"
      });
    } else {
      console.log('Создание SimpleEmbeddings...');
      return new SimpleEmbeddings();
    }
  }
}

module.exports = EmbeddingsFactory; 