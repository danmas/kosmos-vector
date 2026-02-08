# RAG API Integration Guide для фронтенд-разработчиков

> Руководство по интеграции Advanced RAG API (v2.7.0) в пользовательский интерфейс

## 📋 Содержание

1. [Обзор новых возможностей](#обзор-новых-возможностей)
2. [Архитектура RAG](#архитектура-rag)
3. [Новые API эндпоинты](#новые-api-эндпоинты)
4. [TypeScript типы](#typescript-типы)
5. [Примеры интеграции](#примеры-интеграции)
6. [UI/UX рекомендации](#uiux-рекомендации)
7. [React Hooks](#react-hooks)
8. [Миграция существующего кода](#миграция-существующего-кода)

---

## 🎯 Обзор новых возможностей

### Версия API: 2.7.0

В версии 2.7.0 добавлена расширенная система RAG (Retrieval Augmented Generation) с поддержкой:

- **4 стратегии поиска контекста**: Simple, Hierarchical, AI Item, Hybrid
- **Многоуровневая иерархия чанков**: L0 (код), L1 (зависимости), L2 (описание)
- **4 стиля форматирования**: Compact, Standard, Full, Markdown
- **Интеграция со связями**: автоматическое включение связей между элементами
- **Гибкая настройка**: количество чанков, токенов, включение файлов и связей

### Обратная совместимость

✅ Существующий эндпоинт `/api/chat` продолжает работать  
✅ Под капотом используется улучшенный RAG-движок  
✅ Никаких breaking changes для текущего UI

---

## 🏗 Архитектура RAG

```
┌─────────────┐
│ User Query  │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────┐
│   RAGRetriever                  │
│   ┌──────────────────────────┐  │
│   │ Strategy Selection:      │  │
│   │ • Simple                 │  │
│   │ • Hierarchical (рек.)    │  │
│   │ • AI Item                │  │
│   │ • Hybrid                 │  │
│   └──────────────────────────┘  │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│   Vector Search (pgvector)      │
│   • Cosine similarity           │
│   • IVFFlat indexing            │
│   • Context filtering           │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│   Context Assembly              │
│   • L0: Source code             │
│   • L1: Dependencies            │
│   • L2: Logic description       │
│   • Relations from link table   │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│   ContextBuilder                │
│   • Formatting styles           │
│   • Token estimation            │
│   • Smart truncation            │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│   LLM Response (optional)       │
│   • Uses formatted context      │
│   • Configurable model/temp     │
└─────────────────────────────────┘
```

---

## 🔌 Новые API эндпоинты

### 1. `POST /api/rag/retrieve` - Получение контекста без LLM

**Назначение**: Получить структурированный контекст для превью или отладки.

**Запрос**:
```typescript
interface RetrieveRequest {
  query: string;              // "Как работает validateEmployee?"
  contextCode: string;        // "FULL_TEST"
  strategy?: 'simple' | 'hierarchical' | 'aiitem' | 'hybrid';
  maxChunks?: number;         // 1-20, default: 5
  levels?: Array<'0-исходник' | '1-связи' | '2-логика'>;
  includeRelations?: boolean; // default: true
  formatting?: {
    style?: 'compact' | 'standard' | 'full' | 'markdown';
    includeFileNames?: boolean;
    includeRelations?: boolean;
    maxTokens?: number;       // default: 4000
  };
}
```

**Ответ**:
```typescript
interface RetrieveResponse {
  success: true;
  context: {
    formatted: string;        // Готовый текст для LLM
    sections: Section[];      // Структурированные данные
    metadata: {
      totalChunks: number;
      totalTokens: number;
      usedChunkIds: string[];
      strategy: string;
      formattingStyle: string;
    };
  };
  retrievalTime: number;      // мс
  timestamp: string;
}
```

---

### 2. `POST /api/rag/ask` - Полный RAG с ответом LLM

**Назначение**: Получить ответ LLM с использованием оптимального контекста.

**Запрос**:
```typescript
interface AskRequest {
  query: string;              // "Какие методы есть в EmployeeService?"
  contextCode: string;        // "FULL_TEST"
  ragConfig?: {
    strategy?: string;
    maxChunks?: number;
    formatting?: {
      style?: string;
      maxTokens?: number;
    };
  };
  llmConfig?: {
    model?: string;           // "RICH", "GPT4", etc.
    temperature?: number;     // 0-2, default: 0.3
    systemPrompt?: string;
  };
}
```

**Ответ**:
```typescript
interface AskResponse {
  success: true;
  answer: string;             // Ответ LLM
  context: {
    totalChunks: number;
    totalTokens: number;
    usedChunkIds: string[];
    strategy: string;
    formattingStyle: string;
  };
  retrievalTime: number;
  timestamp: string;
}
```

---

### 3. `POST /api/rag/compare-strategies` - Сравнение стратегий

**Назначение**: Сравнить эффективность разных стратегий для отладки.

**Запрос**:
```typescript
interface CompareRequest {
  query: string;
  contextCode: string;
  strategies?: string[];      // default: ["simple", "hierarchical", "aiitem"]
  maxChunks?: number;
}
```

**Ответ**:
```typescript
interface CompareResponse {
  success: true;
  results: Array<{
    strategy: string;
    totalChunks: number;
    totalTokens: number;
    retrievalTime: number;
    chunksPreview: any[];
  }>;
  timestamp: string;
}
```

---

### 4. `GET /api/rag/strategies` - Список стратегий

**Назначение**: Получить информацию о доступных стратегиях.

**Ответ**:
```typescript
interface StrategiesResponse {
  success: true;
  strategies: Array<{
    name: string;
    description: string;
    useCases: string[];
    performance: 'Высокая' | 'Средняя' | 'Низкая';
    complexity: 'Низкая' | 'Средняя' | 'Высокая';
  }>;
}
```

---

## 📘 TypeScript типы

Создайте файл `types/rag.ts`:

```typescript
// types/rag.ts

export type RAGStrategy = 'simple' | 'hierarchical' | 'aiitem' | 'hybrid';
export type ChunkLevel = '0-исходник' | '1-связи' | '2-логика';
export type FormattingStyle = 'compact' | 'standard' | 'full' | 'markdown';

export interface RAGFormattingConfig {
  style?: FormattingStyle;
  includeFileNames?: boolean;
  includeRelations?: boolean;
  maxTokens?: number;
}

export interface RAGRetrieveRequest {
  query: string;
  contextCode: string;
  strategy?: RAGStrategy;
  maxChunks?: number;
  levels?: ChunkLevel[];
  includeRelations?: boolean;
  formatting?: RAGFormattingConfig;
}

export interface ContextSection {
  aiItem?: {
    id: string;
    type: string;
    full_name: string;
  };
  source?: {
    id: string;
    content: string;
    level: string;
  };
  description?: {
    id: string;
    content: string;
    level: string;
  };
  dependencies?: Array<{
    id: string;
    content: string;
    level: string;
  }>;
  relations?: Array<{
    target: string;
    type: string;
  }>;
}

export interface RAGContextMetadata {
  totalChunks: number;
  totalTokens: number;
  usedChunkIds: string[];
  strategy: RAGStrategy;
  formattingStyle: FormattingStyle;
}

export interface RAGRetrieveResponse {
  success: boolean;
  context: {
    formatted: string;
    sections: ContextSection[];
    metadata: RAGContextMetadata;
  };
  retrievalTime: number;
  timestamp: string;
}

export interface RAGAskRequest {
  query: string;
  contextCode: string;
  ragConfig?: Partial<RAGRetrieveRequest>;
  llmConfig?: {
    model?: string;
    temperature?: number;
    systemPrompt?: string;
  };
}

export interface RAGAskResponse {
  success: boolean;
  answer: string;
  context: RAGContextMetadata;
  retrievalTime: number;
  timestamp: string;
}

export interface StrategyInfo {
  name: string;
  description: string;
  useCases: string[];
  performance: 'Высокая' | 'Средняя' | 'Низкая';
  complexity: 'Низкая' | 'Средняя' | 'Высокая';
}

export interface StrategiesResponse {
  success: boolean;
  strategies: StrategyInfo[];
}
```

---

## 💻 Примеры интеграции

### Пример 1: Получение контекста для превью

```typescript
// components/ContextPreview.tsx
import { useState } from 'react';
import { RAGRetrieveRequest, RAGRetrieveResponse } from '@/types/rag';

export function ContextPreview({ query, contextCode }: Props) {
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<any>(null);

  const fetchContext = async () => {
    setLoading(true);
    try {
      const request: RAGRetrieveRequest = {
        query,
        contextCode,
        strategy: 'hierarchical',
        maxChunks: 5,
        formatting: {
          style: 'markdown',
          includeFileNames: true,
          includeRelations: true
        }
      };

      const response = await fetch('/api/rag/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });

      const data: RAGRetrieveResponse = await response.json();
      
      if (data.success) {
        setContext(data.context.formatted);
        setMetadata(data.context.metadata);
      }
    } catch (error) {
      console.error('Ошибка получения контекста:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="context-preview">
      <button onClick={fetchContext} disabled={loading}>
        {loading ? 'Загрузка...' : 'Показать контекст'}
      </button>
      
      {metadata && (
        <div className="metadata">
          <span>Чанков: {metadata.totalChunks}</span>
          <span>Токенов: {metadata.totalTokens}</span>
          <span>Время: {metadata.retrievalTime}мс</span>
        </div>
      )}
      
      {context && (
        <pre className="context-content">{context}</pre>
      )}
    </div>
  );
}
```

---

### Пример 2: Чат с настройками RAG

```typescript
// components/ChatInterface.tsx
import { useState } from 'react';
import { RAGAskRequest, RAGAskResponse, RAGStrategy } from '@/types/rag';

export function ChatInterface({ contextCode }: Props) {
  const [message, setMessage] = useState('');
  const [strategy, setStrategy] = useState<RAGStrategy>('hierarchical');
  const [maxChunks, setMaxChunks] = useState(10);
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const request: RAGAskRequest = {
        query: message,
        contextCode,
        ragConfig: {
          strategy,
          maxChunks,
          formatting: {
            style: 'standard',
            maxTokens: 4000
          }
        },
        llmConfig: {
          model: 'RICH',
          temperature: 0.3
        }
      };

      const res = await fetch('/api/rag/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });

      const data: RAGAskResponse = await res.json();
      
      if (data.success) {
        setResponse(data.answer);
      }
    } catch (error) {
      console.error('Ошибка:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-interface">
      <div className="rag-settings">
        <label>
          Стратегия:
          <select value={strategy} onChange={e => setStrategy(e.target.value as RAGStrategy)}>
            <option value="simple">Simple</option>
            <option value="hierarchical">Hierarchical</option>
            <option value="aiitem">AI Item</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </label>
        
        <label>
          Чанков: {maxChunks}
          <input
            type="range"
            min="1"
            max="20"
            value={maxChunks}
            onChange={e => setMaxChunks(parseInt(e.target.value))}
          />
        </label>
      </div>

      <form onSubmit={handleSubmit}>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Задайте вопрос..."
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Обработка...' : 'Отправить'}
        </button>
      </form>

      {response && (
        <div className="response">
          <h3>Ответ:</h3>
          <p>{response}</p>
        </div>
      )}
    </div>
  );
}
```

---

### Пример 3: Сравнение стратегий

```typescript
// components/StrategyComparison.tsx
import { useState } from 'react';

export function StrategyComparison({ query, contextCode }: Props) {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const compareStrategies = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/rag/compare-strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          contextCode,
          strategies: ['simple', 'hierarchical', 'aiitem']
        })
      });

      const data = await response.json();
      if (data.success) {
        setResults(data.results);
      }
    } catch (error) {
      console.error('Ошибка:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="strategy-comparison">
      <button onClick={compareStrategies} disabled={loading}>
        Сравнить стратегии
      </button>

      {results.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Стратегия</th>
              <th>Чанков</th>
              <th>Токенов</th>
              <th>Время (мс)</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, i) => (
              <tr key={i}>
                <td>{result.strategy}</td>
                <td>{result.totalChunks}</td>
                <td>{result.totalTokens}</td>
                <td>{result.retrievalTime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

---

## 🎨 UI/UX Рекомендации

### 1. RAG Settings Panel

Добавьте панель настроек RAG в существующий интерфейс чата:

```
┌─────────────────────────────────────────┐
│  ⚙ RAG Configuration                   │
├─────────────────────────────────────────┤
│  Стратегия:     [Hierarchical ▼]       │
│  Чанков:        [●────────] 10         │
│  Уровни:        ☑L0 ☑L1 ☑L2          │
│  Стиль:         [Standard ▼]           │
│  Включить связи: ☑                     │
└─────────────────────────────────────────┘
```

### 2. Context Metadata Display

Показывайте метаданные контекста:

```
┌─────────────────────────────────────────┐
│  📊 Найденный контекст                  │
├─────────────────────────────────────────┤
│  • Чанков: 5                            │
│  • Токенов: 2,450                       │
│  • Время: 1,234 мс                      │
│  • Стратегия: Hierarchical              │
└─────────────────────────────────────────┘
```

### 3. Progress Indicators

Показывайте прогресс для длительных операций:

```typescript
<div className="rag-progress">
  {loading && (
    <>
      <Spinner />
      <span>Поиск релевантного контекста...</span>
      {retrievalTime && <span>({retrievalTime}мс)</span>}
    </>
  )}
</div>
```

---

## 🪝 React Hooks

### useRAG Hook

Создайте переиспользуемый хук для RAG операций:

```typescript
// hooks/useRAG.ts
import { useState, useCallback } from 'react';
import type { RAGRetrieveRequest, RAGAskRequest } from '@/types/rag';

export function useRAG() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retrieveContext = useCallback(async (
    query: string,
    contextCode: string,
    config?: Partial<RAGRetrieveRequest>
  ) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/rag/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          contextCode,
          ...config
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const askQuestion = useCallback(async (
    query: string,
    contextCode: string,
    ragConfig?: any,
    llmConfig?: any
  ) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/rag/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          contextCode,
          ragConfig,
          llmConfig
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const compareStrategies = useCallback(async (
    query: string,
    contextCode: string,
    strategies?: string[]
  ) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/rag/compare-strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          contextCode,
          strategies
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    retrieveContext,
    askQuestion,
    compareStrategies,
    loading,
    error
  };
}
```

### Использование хука

```typescript
// components/ChatPage.tsx
import { useRAG } from '@/hooks/useRAG';

export function ChatPage() {
  const { askQuestion, loading, error } = useRAG();
  const [answer, setAnswer] = useState('');

  const handleSubmit = async (query: string) => {
    try {
      const result = await askQuestion(
        query,
        'FULL_TEST',
        { strategy: 'hierarchical', maxChunks: 10 },
        { model: 'RICH', temperature: 0.3 }
      );
      
      setAnswer(result.answer);
    } catch (err) {
      console.error('Ошибка:', err);
    }
  };

  return (
    <div>
      {loading && <Spinner />}
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {answer && <Answer>{answer}</Answer>}
    </div>
  );
}
```

---

## 🔄 Миграция существующего кода

### До (старый API):

```typescript
// Старый подход - прямой вызов /api/chat
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: query,
    contextCode: 'FULL_TEST'
  })
});
```

### После (новый API):

```typescript
// Новый подход - использование RAG API
const response = await fetch('/api/rag/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query,
    contextCode: 'FULL_TEST',
    ragConfig: {
      strategy: 'hierarchical',  // Выбор стратегии
      maxChunks: 10,
      formatting: {
        style: 'standard',
        maxTokens: 4000
      }
    },
    llmConfig: {
      model: 'RICH',
      temperature: 0.3
    }
  })
});
```

### Поэтапная миграция

1. **Этап 1**: Оставить существующий `/api/chat` без изменений
2. **Этап 2**: Добавить новые UI компоненты для RAG настроек
3. **Этап 3**: Использовать `/api/rag/ask` для новых запросов
4. **Этап 4**: Постепенно мигрировать старый код

---

## 📊 Рекомендации по стратегиям

| Стратегия | Скорость | Качество | Использование |
|-----------|----------|----------|---------------|
| **Simple** | ⚡⚡⚡ Быстрая | ⭐⭐ Базовое | Простые вопросы, быстрый поиск |
| **Hierarchical** | ⚡⚡ Средняя | ⭐⭐⭐ Хорошее | Анализ функций, понимание логики (рекомендуется) |
| **AI Item** | ⚡ Медленная | ⭐⭐⭐⭐ Отличное | Глубокий анализ, полный контекст |
| **Hybrid** | ⚡⚡ Средняя | ⭐⭐⭐ Хорошее | Экспериментальная, комбинированный подход |

---

## 🎯 Чек-лист интеграции

- [ ] Добавить TypeScript типы из `types/rag.ts`
- [ ] Создать `useRAG` hook
- [ ] Обновить существующий чат для использования нового API
- [ ] Добавить RAG Settings Panel в UI
- [ ] Создать Context Preview компонент
- [ ] Показывать метаданные (время, чанки, токены)
- [ ] Добавить Strategy Comparison Dashboard (опционально)
- [ ] Обновить документацию для пользователей
- [ ] Провести A/B тестирование стратегий
- [ ] Собрать обратную связь от пользователей

---

## 📞 Поддержка

При возникновении вопросов:

1. Проверьте API контракт: `docs/api-contract.yaml`
2. Изучите примеры: `example-usage-rag.js`
3. Запустите тесты: `bun tests/test_rag_retrieval.js`
4. Проверьте логи сервера в `logs/combined-*.log`

---

**Версия документа**: 1.0.0  
**Дата**: 2026-02-08  
**API Version**: 2.7.0
