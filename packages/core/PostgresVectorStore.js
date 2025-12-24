// PostgresVectorStore.js
const { VectorStore } = require("@langchain/core/vectorstores");
const { Document } = require("@langchain/core/documents");

/**
 * Класс для работы с векторами, хранящимися в PostgreSQL.
 * Реализует интерфейс VectorStore из LangChain.
 */
class PostgresVectorStore extends VectorStore {
  constructor(embeddings, dbService, options = {}) {
    super(embeddings, options);
    this._embeddings = embeddings;
    this._dbService = dbService;
    this._queryLimit = options.queryLimit || 5;
    this._contextCode = options.contextCode || null;
  }

  /**
   * Возвращает тип хранилища
   */
  _vectorstoreType() {
    return "postgres";
  }

  /**
   * Создание экземпляра PostgresVectorStore из документов
   */
  static async fromDocuments(docs, embeddings, dbService, options = {}) {
    try {
      const store = new this(embeddings, dbService, options);
      await store.addDocuments(docs);
      return store;
    } catch (error) {
      console.error("Ошибка создания PostgresVectorStore из документов:", error);
      throw error;
    }
  }

  /**
   * Добавление документов в хранилище
   */
  async addDocuments(documents) {
    const texts = documents.map((doc) => doc.pageContent);
    const metadatas = documents.map((doc) => doc.metadata);
    
    // Получение векторов для всех текстов
    const vectors = await this._embeddings.embedDocuments(texts);
    
    // Добавление векторов в хранилище
    return this.addVectors(vectors, documents);
  }

  /**
   * Добавление векторов в хранилище
   */
  async addVectors(vectors, documents) {
    if (vectors.length === 0) {
      return [];
    }

    const ids = [];
    
    // Группировка документов по файлам
    const documentsByFile = {};
    
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const metadata = doc.metadata || {};
      const source = metadata.source || null;
      
      if (source) {
        const filename = source.split('/').pop();
        
        if (!documentsByFile[filename]) {
          documentsByFile[filename] = {
            content: '',
            chunks: []
          };
        }
        
        // Добавление содержимого чанка к общему содержимому файла
        documentsByFile[filename].content += doc.pageContent + ' ';
        
        // Сохранение чанка и его вектора
        documentsByFile[filename].chunks.push({
          content: doc.pageContent,
          vector: vectors[i],
          index: documentsByFile[filename].chunks.length,
          metadata: metadata
        });
      }
    }
    
    // Обработка каждого файла
    for (const [filename, fileData] of Object.entries(documentsByFile)) {
      try {
        // Сохранение информации о файле
        const { id: fileId } = await this._dbService.saveFileInfo(filename, fileData.content.trim(), null, this._contextCode);
        
        // Сохранение векторов для каждого чанка
        for (const chunk of fileData.chunks) {
          // metadata должен содержать full_name для идентификации чанка
          // Обертываем content в JSON объект для JSONB
          await this._dbService.saveChunkVector(fileId, { text: chunk.content }, chunk.vector, chunk.metadata || {}, null, this._contextCode);
          ids.push(chunk.index || null);
        }
      } catch (error) {
        console.error(`Ошибка при сохранении векторов для файла ${filename}:`, error);
      }
    }
    
    return ids;
  }

  /**
   * Поиск похожих документов по запросу
   */
  async similaritySearch(query, k = 4) {
    const results = await this.similaritySearchVectorWithScore(
      await this._embeddings.embedQuery(query),
      k
    );
    
    return results.map(([doc, _score]) => doc);
  }

  /**
   * Поиск похожих документов по вектору с оценкой сходства
   */
  async similaritySearchVectorWithScore(vector, k = 4) {
    try {
      // Поиск наиболее похожих чанков
      const results = await this._dbService.similaritySearch(vector, k, this._contextCode);
      
      // Преобразование результатов в формат, ожидаемый LangChain
      return results.map((result) => {
        // Создание документа LangChain
        const doc = new Document({
          pageContent: result.content,
          metadata: result.metadata
        });
        
        // Возвращаем пару [документ, оценка]
        return [doc, result.similarity];
      });
    } catch (error) {
      console.error("Ошибка при поиске векторов в PostgreSQL:", error);
      throw error;
    }
  }

  /**
   * Получение ретривера для этого хранилища
   */
  asRetriever(options = {}) {
    // Использование метода из родительского класса
    const retrieverOptions = {
      k: options.k || this._queryLimit,
      ...options
    };
    
    return super.asRetriever(retrieverOptions);
  }

  /**
   * Переопределение метода _getRelevantDocuments для родительского класса
   */
  async _getRelevantDocuments(query) {
    const results = await this.similaritySearch(query, this._queryLimit);
    return results;
  }

  /**
   * Установка контекстного кода для фильтрации результатов
   */
  setContextCode(contextCode) {
    this._contextCode = contextCode;
  }
}

module.exports = PostgresVectorStore;