// SimpleEmbeddings.js
const { Embeddings } = require("@langchain/core/embeddings");

/**
 * Простая реализация эмбеддингов для тестирования
 * Генерирует случайные векторы фиксированной размерности
 */
class SimpleEmbeddings extends Embeddings {
  constructor(params = {}) {
    super(params);
    this.dimensions = params.dimensions || 1536; // Изменено с 384 на 1536 для соответствия ожиданиям БД
    console.log(`Инициализирована SimpleEmbeddings с размерностью ${this.dimensions}`);
  }

  /**
   * Генерирует эмбеддинг для одного текста
   * @param {string} text - Текст для эмбеддинга
   * @returns {Promise<number[]>} - Вектор эмбеддинга
   */
  async embedQuery(text) {
    console.log(`Создание эмбеддинга для запроса: ${text.substring(0, 50)}...`);
    return this._generateVector(text);
  }

  /**
   * Генерирует эмбеддинги для массива текстов
   * @param {string[]} documents - Массив текстов
   * @returns {Promise<number[][]>} - Массив векторов эмбеддингов
   */
  async embedDocuments(documents) {
    console.log(`Создание эмбеддингов для ${documents.length} документов`);
    return Promise.all(documents.map(doc => this._generateVector(doc)));
  }

  /**
   * Генерирует детерминированный вектор на основе хеша текста
   * @param {string} text - Исходный текст
   * @returns {number[]} - Вектор эмбеддинга
   * @private
   */
  _generateVector(text) {
    // Создаем "глупый", но предсказуемый вектор для тестов
    // Первый элемент - нормализованная длина, остальные - нули
    const vector = new Array(this.dimensions).fill(0.0);
    
    // Простое, предсказуемое значение, чтобы избежать слишком больших чисел
    const normalizedLength = Math.min(text.length / 500.0, 1.0);
    vector[0] = normalizedLength;

    return vector;
  }
}

module.exports = SimpleEmbeddings; 