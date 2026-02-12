// RAGRetriever.js
// Класс для интеллектуального поиска и сборки контекста из базы знаний для RAG

/**
 * RAGRetriever - основной класс для поиска релевантного контекста
 * Поддерживает различные стратегии поиска с учётом иерархии чанков (L0/L1/L2)
 */
class RAGRetriever {
  /**
   * @param {Object} dbService - Экземпляр DbService для работы с БД
   * @param {Object} embeddings - Модель эмбеддингов (SimpleEmbeddings или OpenAIEmbeddings)
   * @param {Object} config - Конфигурация RAG
   */
  constructor(dbService, embeddings, config = {}) {
    this.dbService = dbService;
    this.embeddings = embeddings;
    
    // Конфигурация по умолчанию
    this.config = {
      strategy: 'hierarchical',
      maxChunks: 10,
      maxTokens: 4000,
      levels: ['0-исходник', '1-связи', '2-логика'],
      includeRelations: true,
      expandGraph: false,
      similarityThreshold: 0.7,
      ...config, // Перезаписываем только переданными значениями
    };
    
    // Обеспечиваем, что levels всегда массив
    if (!Array.isArray(this.config.levels) || this.config.levels.length === 0) {
      this.config.levels = ['0-исходник', '1-связи', '2-логика'];
    }
    
    console.log('[RAGRetriever] Инициализирован со стратегией:', this.config.strategy);
    console.log('[RAGRetriever] Конфиг:', {
      strategy: this.config.strategy,
      maxChunks: this.config.maxChunks,
      levels: this.config.levels,
      includeRelations: this.config.includeRelations
    });
  }

  /**
   * Главный метод для получения контекста по запросу
   * @param {string} query - Запрос пользователя
   * @param {string} contextCode - Код контекста для фильтрации
   * @param {Object} options - Дополнительные параметры
   * @returns {Promise<Object>} Объект с найденными чанками и метаданными
   */
  async retrieve(query, contextCode, options = {}) {
    const startTime = Date.now();
    
    try {
      console.log(`[RAGRetriever] Запрос: "${query.substring(0, 100)}..."`);
      console.log(`[RAGRetriever] Контекст: ${contextCode}, Стратегия: ${this.config.strategy}`);
      
      // Создаём эмбеддинг для запроса
      const queryEmbedding = await this.embeddings.embedQuery(query);
      
      // Применяем стратегию поиска
      let chunks;
      switch (this.config.strategy) {
        case 'simple':
          chunks = await this._simpleStrategy(queryEmbedding, contextCode, options);
          break;
        case 'hierarchical':
          chunks = await this._hierarchicalStrategy(queryEmbedding, contextCode, options);
          break;
        case 'aiitem':
          chunks = await this._aiItemStrategy(queryEmbedding, contextCode, options);
          break;
        case 'hybrid':
          chunks = await this._hybridStrategy(queryEmbedding, contextCode, options);
          break;
        default:
          throw new Error(`Неизвестная стратегия: ${this.config.strategy}`);
      }
      
      const retrievalTime = Date.now() - startTime;
      
      console.log(`[RAGRetriever] Найдено ${chunks.length} чанков за ${retrievalTime}мс`);
      
      return {
        chunks,
        metadata: {
          query,
          contextCode,
          strategy: this.config.strategy,
          totalChunks: chunks.length,
          retrievalTime,
          timestamp: new Date().toISOString()
        }
      };
      
    } catch (error) {
      console.error('[RAGRetriever] Ошибка при поиске контекста:', error.message);
      console.error('[RAGRetriever] Stack:', error.stack);
      throw error;
    }
  }

  /**
   * Собрать объект фильтров для similaritySearch из options.itemFilter
   * @private
   */
  _itemFilterToDbFilters(options) {
    const itemFilter = options.itemFilter || {};
    const filters = {};
    if (Array.isArray(itemFilter.typeCodes) && itemFilter.typeCodes.length > 0) {
      filters.typeCodes = itemFilter.typeCodes;
    }
    if (Array.isArray(itemFilter.tagCodes) && itemFilter.tagCodes.length > 0) {
      filters.tagCodes = itemFilter.tagCodes;
    }
    return filters;
  }

  /**
   * Простая стратегия: векторный поиск Top-K чанков
   * @private
   */
  async _simpleStrategy(queryEmbedding, contextCode, options) {
    const limit = options.maxChunks || this.config.maxChunks;
    const levels = options.levels || this.config.levels;
    const itemFilters = this._itemFilterToDbFilters(options);
    
    // Защита от undefined/null
    if (!Array.isArray(levels) || levels.length === 0) {
      console.warn('[RAGRetriever] levels не массив или пустой, используем дефолтные');
      const defaultLevels = ['0-исходник', '1-связи', '2-логика'];
      return this._simpleStrategy(queryEmbedding, contextCode, { ...options, levels: defaultLevels });
    }
    
    console.log(`[RAGRetriever] Simple Strategy: limit=${limit}, levels=${levels.join(',')}`);
    
    // Поиск по каждому уровню отдельно
    const allChunks = [];
    
    for (const level of levels) {
      const chunks = await this.dbService.similaritySearch(
        queryEmbedding,
        Math.ceil(limit / levels.length),
        contextCode,
        { chunkLevel: level, ...itemFilters }
      );
      
      allChunks.push(...chunks);
    }
    
    // Сортируем по similarity и обрезаем до лимита
    allChunks.sort((a, b) => b.similarity - a.similarity);
    const topChunks = allChunks.slice(0, limit);
    
    // Обогащаем чанки метаданными
    return await this._enrichChunks(topChunks);
  }

  /**
   * Иерархическая стратегия: находим L0, затем подтягиваем L1 и L2
   * @private
   */
  async _hierarchicalStrategy(queryEmbedding, contextCode, options) {
    const limit = options.maxChunks || this.config.maxChunks;
    const itemFilters = this._itemFilterToDbFilters(options);
    
    console.log(`[RAGRetriever] Hierarchical Strategy: limit=${limit}`);
    
    // 1. Находим релевантные L0-чанки (исходный код)
    const l0Chunks = await this.dbService.similaritySearch(
      queryEmbedding,
      Math.min(limit, 5), // Ограничиваем количество базовых чанков
      contextCode,
      { chunkLevel: '0-исходник', ...itemFilters }
    );
    
    console.log(`[RAGRetriever] Найдено ${l0Chunks.length} L0-чанков`);
    
    if (l0Chunks.length === 0) {
      return [];
    }
    
    // 2. Для каждого L0-чанка получаем его дочерние L1 и L2
    const enrichedResults = [];
    
    for (const l0Chunk of l0Chunks) {
      const result = {
        l0: l0Chunk,
        l1: [],
        l2: [],
        ai_item: null,
        relations: []
      };
      
      // Получаем информацию о чанке из БД
      const chunkInfo = await this.dbService.getChunkById(l0Chunk.id);
      
      if (chunkInfo && chunkInfo.ai_item_id) {
        // Получаем AI Item
        result.ai_item = await this.dbService.getAiItemById(chunkInfo.ai_item_id);
        
        // Получаем все чанки этого AI Item
        const aiItemChunks = await this.dbService.getAiItemChunks(chunkInfo.ai_item_id);
        
        // Разделяем по уровням
        result.l1 = aiItemChunks.filter(c => c.level === '1-связи');
        result.l2 = aiItemChunks.filter(c => c.level === '2-логика');
        
        // Получаем связи, если требуется
        if (this.config.includeRelations && result.ai_item) {
          result.relations = await this._getAiItemRelations(
            result.ai_item.full_name,
            contextCode
          );
        }
      }
      
      enrichedResults.push(result);
    }
    
    console.log(`[RAGRetriever] Обогащено ${enrichedResults.length} результатов иерархией`);
    
    return enrichedResults;
  }

  /**
   * AI Item стратегия: поиск через AI Items и все их чанки
   * @private
   */
  async _aiItemStrategy(queryEmbedding, contextCode, options) {
    const limit = options.maxChunks || this.config.maxChunks;
    const itemFilters = this._itemFilterToDbFilters(options);
    
    console.log(`[RAGRetriever] AI Item Strategy: limit=${limit}`);
    
    // 1. Находим релевантные чанки
    const foundChunks = await this.dbService.similaritySearch(
      queryEmbedding,
      limit * 2, // Берём с запасом
      contextCode,
      itemFilters
    );
    
    // 2. Группируем по AI Item
    const aiItemsMap = new Map();
    
    for (const chunk of foundChunks) {
      const chunkInfo = await this.dbService.getChunkById(chunk.id);
      
      if (chunkInfo && chunkInfo.ai_item_id) {
        if (!aiItemsMap.has(chunkInfo.ai_item_id)) {
          const aiItem = await this.dbService.getAiItemById(chunkInfo.ai_item_id);
          const allChunks = await this.dbService.getAiItemChunks(chunkInfo.ai_item_id);
          const relations = this.config.includeRelations 
            ? await this._getAiItemRelations(aiItem.full_name, contextCode)
            : [];
          
          aiItemsMap.set(chunkInfo.ai_item_id, {
            ai_item: aiItem,
            chunks: allChunks,
            relations,
            maxSimilarity: chunk.similarity
          });
        }
      }
    }
    
    // 3. Сортируем по максимальной similarity и обрезаем
    const results = Array.from(aiItemsMap.values())
      .sort((a, b) => b.maxSimilarity - a.maxSimilarity)
      .slice(0, Math.ceil(limit / 3)); // Примерно по 3 чанка на AI Item
    
    console.log(`[RAGRetriever] Найдено ${results.length} релевантных AI Items`);
    
    return results;
  }

  /**
   * Гибридная стратегия: комбинация векторного и keyword-поиска
   * @private
   */
  async _hybridStrategy(queryEmbedding, contextCode, options) {
    console.log(`[RAGRetriever] Hybrid Strategy`);
    
    // Пока используем иерархическую стратегию как базу
    // TODO: Добавить FTS-поиск и graph expansion
    return await this._hierarchicalStrategy(queryEmbedding, contextCode, options);
  }

  /**
   * Получение связей AI Item из таблицы link
   * @private
   */
  async _getAiItemRelations(fullName, contextCode) {
    try {
      const relations = await this.dbService.pgClient.query(`
        SELECT 
          l.source,
          l.target,
          lt.code as link_type,
          lt.label as link_label
        FROM link l
        JOIN link_type lt ON l.link_type_id = lt.id
        WHERE l.context_code = $1 
          AND (l.source = $2 OR l.target = $2)
        LIMIT 50
      `, [contextCode, fullName]);
      
      return relations.rows;
    } catch (error) {
      console.warn('[RAGRetriever] Ошибка при получении связей:', error.message);
      return [];
    }
  }

  /**
   * Обогащение чанков дополнительными метаданными
   * @private
   */
  async _enrichChunks(chunks) {
    const enriched = [];
    
    for (const chunk of chunks) {
      try {
        const chunkInfo = await this.dbService.getChunkById(chunk.id);
        
        enriched.push({
          ...chunk,
          chunk_info: chunkInfo,
          ai_item: chunkInfo?.ai_item_id 
            ? await this.dbService.getAiItemById(chunkInfo.ai_item_id)
            : null
        });
      } catch (error) {
        console.warn(`[RAGRetriever] Не удалось обогатить чанк ${chunk.id}:`, error.message);
        enriched.push(chunk);
      }
    }
    
    return enriched;
  }

  /**
   * Фильтрация чанков по порогу similarity
   * @private
   */
  _filterBySimilarity(chunks, threshold) {
    return chunks.filter(chunk => 
      chunk.similarity >= (threshold || this.config.similarityThreshold)
    );
  }

  /**
   * Оценка общего размера контекста в токенах (приблизительно)
   * @private
   */
  _estimateTokens(text) {
    // Приблизительная оценка: 1 токен ≈ 4 символа для русского текста
    return Math.ceil(text.length / 4);
  }
}

module.exports = RAGRetriever;
