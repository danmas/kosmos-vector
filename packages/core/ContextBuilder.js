// ContextBuilder.js
// Форматирование контекста для оптимального потребления LLM

/**
 * ContextBuilder - класс для форматирования найденного контекста
 * Преобразует сырые чанки в структурированный текст для LLM
 */
class ContextBuilder {
  /**
   * @param {Object} config - Конфигурация форматирования
   */
  constructor(config = {}) {
    this.config = {
      style: config.style || 'standard', // compact | standard | full | markdown
      includeMetadata: config.includeMetadata !== false,
      includeFileNames: config.includeFileNames !== false,
      groupByAiItem: config.groupByAiItem !== false,
      maxTokens: config.maxTokens || 4000,
      includeSimilarity: config.includeSimilarity || false,
      includeRelations: config.includeRelations !== false,
      ...config
    };
    
    console.log('[ContextBuilder] Инициализирован со стилем:', this.config.style);
  }

  /**
   * Главный метод для построения контекста из результатов RAGRetriever
   * @param {Object} retrievalResult - Результат от RAGRetriever.retrieve()
   * @param {string} strategy - Стратегия, которая использовалась
   * @returns {Object} Объект с форматированным контекстом
   */
  build(retrievalResult, strategy = 'hierarchical') {
    const { chunks, metadata } = retrievalResult;
    
    console.log(`[ContextBuilder] Построение контекста из ${chunks.length} чанков`);
    
    let formatted;
    let sections = [];
    
    // Форматируем в зависимости от стратегии
    if (strategy === 'hierarchical' || strategy === 'aiitem') {
      sections = this._buildHierarchicalSections(chunks);
      formatted = this._formatSections(sections);
    } else {
      sections = this._buildSimpleSections(chunks);
      formatted = this._formatSections(sections);
    }
    
    // Обрезаем по лимиту токенов
    const { trimmed, actualTokens } = this._trimToTokenLimit(formatted);
    
    const usedChunkIds = this._extractChunkIds(sections);
    
    console.log(`[ContextBuilder] Контекст построен: ${actualTokens} токенов, ${usedChunkIds.length} чанков`);
    
    return {
      formatted: trimmed,
      sections,
      metadata: {
        ...metadata,
        totalTokens: actualTokens,
        usedChunkIds,
        formattingStyle: this.config.style
      }
    };
  }

  /**
   * Построение иерархических секций (для hierarchical/aiitem стратегий)
   * @private
   */
  _buildHierarchicalSections(results) {
    const sections = [];
    
    for (const result of results) {
      const section = {
        aiItem: null,
        source: null,
        dependencies: null,
        description: null,
        relations: []
      };
      
      // Обрабатываем в зависимости от структуры
      if (result.ai_item || result.l0) {
        // Hierarchical strategy result
        section.aiItem = result.ai_item;
        
        if (result.l0) {
          section.source = {
            level: 'L0',
            content: result.l0.content,
            similarity: result.l0.similarity,
            metadata: result.l0.metadata
          };
        }
        
        if (result.l1 && result.l1.length > 0) {
          section.dependencies = {
            level: 'L1',
            chunks: result.l1.map(c => ({
              content: c.chunk_content,
              type: c.type,
              filename: c.filename
            }))
          };
        }
        
        if (result.l2 && result.l2.length > 0) {
          section.description = {
            level: 'L2',
            chunks: result.l2.map(c => ({
              content: c.chunk_content,
              type: c.type,
              filename: c.filename
            }))
          };
        }
        
        section.relations = result.relations || [];
      } else if (result.chunks) {
        // AI Item strategy result
        section.aiItem = result.ai_item;
        
        // Группируем чанки по уровням
        const l0Chunks = result.chunks.filter(c => c.level === '0-исходник');
        const l1Chunks = result.chunks.filter(c => c.level === '1-связи');
        const l2Chunks = result.chunks.filter(c => c.level === '2-логика');
        
        if (l0Chunks.length > 0) {
          section.source = {
            level: 'L0',
            content: l0Chunks[0].chunk_content,
            metadata: { filename: l0Chunks[0].filename }
          };
        }
        
        if (l1Chunks.length > 0) {
          section.dependencies = {
            level: 'L1',
            chunks: l1Chunks.map(c => ({
              content: c.chunk_content,
              type: c.type,
              filename: c.filename
            }))
          };
        }
        
        if (l2Chunks.length > 0) {
          section.description = {
            level: 'L2',
            chunks: l2Chunks.map(c => ({
              content: c.chunk_content,
              type: c.type,
              filename: c.filename
            }))
          };
        }
        
        section.relations = result.relations || [];
      }
      
      sections.push(section);
    }
    
    return sections;
  }

  /**
   * Построение простых секций (для simple стратегии)
   * @private
   */
  _buildSimpleSections(chunks) {
    return chunks.map(chunk => ({
      content: chunk.content,
      similarity: chunk.similarity,
      metadata: chunk.metadata,
      aiItem: chunk.ai_item || null,
      chunkInfo: chunk.chunk_info || null
    }));
  }

  /**
   * Форматирование секций в текст
   * @private
   */
  _formatSections(sections) {
    switch (this.config.style) {
      case 'compact':
        return this._formatCompact(sections);
      case 'standard':
        return this._formatStandard(sections);
      case 'full':
        return this._formatFull(sections);
      case 'markdown':
        return this._formatMarkdown(sections);
      default:
        return this._formatStandard(sections);
    }
  }

  /**
   * Компактное форматирование - только ключевая информация
   * @private
   */
  _formatCompact(sections) {
    const parts = [];
    
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      
      if (section.aiItem) {
        parts.push(`[${i + 1}] ${section.aiItem.full_name} (${section.aiItem.type})`);
        
        if (section.description && section.description.chunks.length > 0) {
          parts.push(section.description.chunks[0].content);
        } else if (section.source) {
          // Обрезаем исходный код
          const snippet = section.source.content.substring(0, 200);
          parts.push(snippet + (section.source.content.length > 200 ? '...' : ''));
        }
      } else if (section.content) {
        parts.push(`[${i + 1}] ${section.content}`);
      }
      
      parts.push(''); // Пустая строка между секциями
    }
    
    return parts.join('\n');
  }

  /**
   * Стандартное форматирование - код + описание
   * @private
   */
  _formatStandard(sections) {
    const parts = ['=== КОНТЕКСТ ИЗ КОДОВОЙ БАЗЫ ===\n'];
    
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      
      if (section.aiItem) {
        parts.push(`--- [${i + 1}] ${section.aiItem.full_name} ---`);
        parts.push(`Тип: ${section.aiItem.type}`);
        
        if (this.config.includeFileNames && section.source?.metadata?.filename) {
          parts.push(`Файл: ${section.source.metadata.filename}`);
        }
        
        parts.push('');
        
        // L0 - Исходный код (опционально)
        if (section.source && this.config.style === 'standard') {
          parts.push('Код:');
          parts.push(section.source.content);
          parts.push('');
        }
        
        // L2 - Описание (приоритетно)
        if (section.description && section.description.chunks.length > 0) {
          parts.push('Описание:');
          section.description.chunks.forEach(chunk => {
            parts.push(chunk.content);
          });
          parts.push('');
        }
        
        // L1 - Зависимости (если есть)
        if (section.dependencies && section.dependencies.chunks.length > 0 && this.config.includeRelations) {
          parts.push('Зависимости:');
          section.dependencies.chunks.forEach(chunk => {
            parts.push(chunk.content);
          });
          parts.push('');
        }
        
        // Связи из таблицы link
        if (section.relations && section.relations.length > 0 && this.config.includeRelations) {
          parts.push('Связи:');
          section.relations.slice(0, 5).forEach(rel => {
            if (rel.source === section.aiItem.full_name) {
              parts.push(`  → ${rel.link_type}: ${rel.target}`);
            } else {
              parts.push(`  ← ${rel.link_type}: ${rel.source}`);
            }
          });
          parts.push('');
        }
        
      } else if (section.content) {
        // Простая секция
        parts.push(`--- [${i + 1}] ---`);
        if (this.config.includeFileNames && section.metadata?.source) {
          parts.push(`Источник: ${section.metadata.source}`);
        }
        if (this.config.includeSimilarity && section.similarity) {
          parts.push(`Релевантность: ${(section.similarity * 100).toFixed(1)}%`);
        }
        parts.push('');
        parts.push(section.content);
        parts.push('');
      }
      
      parts.push('---\n');
    }
    
    return parts.join('\n');
  }

  /**
   * Полное форматирование - все уровни + связи
   * @private
   */
  _formatFull(sections) {
    const parts = ['=== ПОЛНЫЙ КОНТЕКСТ ИЗ КОДОВОЙ БАЗЫ ===\n'];
    
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      
      if (section.aiItem) {
        parts.push(`━━━ [${i + 1}] ${section.aiItem.full_name} ━━━`);
        parts.push(`Тип: ${section.aiItem.type}`);
        
        if (this.config.includeFileNames && section.source?.metadata?.filename) {
          parts.push(`Файл: ${section.source.metadata.filename}`);
        }
        
        parts.push('');
        
        // L0 - Исходный код
        if (section.source) {
          parts.push('▸ ИСХОДНЫЙ КОД (L0):');
          parts.push(section.source.content);
          parts.push('');
        }
        
        // L1 - Зависимости
        if (section.dependencies && section.dependencies.chunks.length > 0) {
          parts.push('▸ ЗАВИСИМОСТИ (L1):');
          section.dependencies.chunks.forEach((chunk, idx) => {
            parts.push(`  [${idx + 1}] ${chunk.content}`);
          });
          parts.push('');
        }
        
        // L2 - Описание
        if (section.description && section.description.chunks.length > 0) {
          parts.push('▸ ОПИСАНИЕ ЛОГИКИ (L2):');
          section.description.chunks.forEach((chunk, idx) => {
            parts.push(`  [${idx + 1}] ${chunk.content}`);
          });
          parts.push('');
        }
        
        // Связи
        if (section.relations && section.relations.length > 0) {
          parts.push('▸ СВЯЗИ С ДРУГИМИ ЭЛЕМЕНТАМИ:');
          section.relations.forEach(rel => {
            if (rel.source === section.aiItem.full_name) {
              parts.push(`  → ${rel.link_label}: ${rel.target}`);
            } else {
              parts.push(`  ← ${rel.link_label}: ${rel.source}`);
            }
          });
          parts.push('');
        }
        
      } else if (section.content) {
        parts.push(`━━━ [${i + 1}] ━━━`);
        parts.push(section.content);
        parts.push('');
      }
      
      parts.push('━━━━━━━━━━━━━━━━━━━━━━\n');
    }
    
    return parts.join('\n');
  }

  /**
   * Markdown форматирование
   * @private
   */
  _formatMarkdown(sections) {
    const parts = ['# Контекст из кодовой базы\n'];
    
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      
      if (section.aiItem) {
        parts.push(`## ${i + 1}. ${section.aiItem.full_name}`);
        parts.push(`\n**Тип:** \`${section.aiItem.type}\``);
        
        if (this.config.includeFileNames && section.source?.metadata?.filename) {
          parts.push(`**Файл:** \`${section.source.metadata.filename}\``);
        }
        
        parts.push('');
        
        // L0
        if (section.source) {
          parts.push('### Исходный код');
          parts.push('```');
          parts.push(section.source.content);
          parts.push('```\n');
        }
        
        // L2
        if (section.description && section.description.chunks.length > 0) {
          parts.push('### Описание');
          section.description.chunks.forEach(chunk => {
            parts.push(chunk.content);
          });
          parts.push('');
        }
        
        // L1
        if (section.dependencies && section.dependencies.chunks.length > 0) {
          parts.push('### Зависимости');
          section.dependencies.chunks.forEach(chunk => {
            parts.push(`- ${chunk.content}`);
          });
          parts.push('');
        }
        
        // Связи
        if (section.relations && section.relations.length > 0 && this.config.includeRelations) {
          parts.push('### Связи');
          section.relations.forEach(rel => {
            if (rel.source === section.aiItem.full_name) {
              parts.push(`- **${rel.link_label}** → \`${rel.target}\``);
            } else {
              parts.push(`- **${rel.link_label}** ← \`${rel.source}\``);
            }
          });
          parts.push('');
        }
        
      } else if (section.content) {
        parts.push(`## ${i + 1}. Фрагмент кода`);
        parts.push('```');
        parts.push(section.content);
        parts.push('```\n');
      }
      
      parts.push('---\n');
    }
    
    return parts.join('\n');
  }

  /**
   * Обрезка контекста до лимита токенов
   * @private
   */
  _trimToTokenLimit(text) {
    const maxTokens = this.config.maxTokens;
    const estimatedTokens = this._estimateTokens(text);
    
    if (estimatedTokens <= maxTokens) {
      return { trimmed: text, actualTokens: estimatedTokens };
    }
    
    console.log(`[ContextBuilder] Обрезка контекста: ${estimatedTokens} → ${maxTokens} токенов`);
    
    // Приблизительная обрезка по символам
    const maxChars = maxTokens * 4; // 1 токен ≈ 4 символа
    const trimmed = text.substring(0, maxChars) + '\n\n[... контекст обрезан ...]';
    
    return { trimmed, actualTokens: maxTokens };
  }

  /**
   * Оценка количества токенов
   * @private
   */
  _estimateTokens(text) {
    // Приблизительная оценка: 1 токен ≈ 4 символа для русского/английского текста
    return Math.ceil(text.length / 4);
  }

  /**
   * Извлечение ID всех использованных чанков
   * @private
   */
  _extractChunkIds(sections) {
    const ids = new Set();
    
    for (const section of sections) {
      if (section.source && section.source.metadata?.id) {
        ids.add(section.source.metadata.id);
      }
      
      if (section.dependencies && section.dependencies.chunks) {
        section.dependencies.chunks.forEach(c => {
          if (c.id) ids.add(c.id);
        });
      }
      
      if (section.description && section.description.chunks) {
        section.description.chunks.forEach(c => {
          if (c.id) ids.add(c.id);
        });
      }
      
      if (section.chunkInfo && section.chunkInfo.id) {
        ids.add(section.chunkInfo.id);
      }
    }
    
    return Array.from(ids);
  }
}

module.exports = ContextBuilder;
