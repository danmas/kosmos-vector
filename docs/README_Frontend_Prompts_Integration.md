# Frontend Integration Guide: Prompts Config API

**Версия API:** 2.9.0  
**Дата:** 08.02.2026  
**Для:** Frontend-разработчиков

---

## 📋 Содержание

1. [Обзор](#обзор)
2. [Quick Start](#quick-start)
3. [TypeScript Interfaces](#typescript-interfaces)
4. [API Endpoints](#api-endpoints)
5. [React Integration](#react-integration)
6. [Vue 3 Integration](#vue-3-integration)
7. [Валидация](#валидация)
8. [Управление историей](#управление-историей)
9. [Error Handling](#error-handling)
10. [Best Practices](#best-practices)
11. [Примеры UI компонентов](#примеры-ui-компонентов)

---

## Обзор

Prompts Config API позволяет управлять конфигурацией промптов LLM через веб-интерфейс с полной поддержкой истории изменений.

### Основные возможности

✅ **CRUD операции** с промптами  
✅ **История изменений** с версионированием  
✅ **Восстановление** из любой версии  
✅ **Комментарии** к изменениям  
✅ **Валидация** на клиенте и сервере  
✅ **TypeScript** типизация из коробки

### Архитектура

```
Frontend (React/Vue)
     ↓ HTTP Requests
REST API (/api/prompts-config)
     ↓
Backend Service (promptsConfigService.js)
     ↓
PostgreSQL (prompt_config_history) + prompts.json
```

---

## Quick Start

### 1. Получить текущую конфигурацию

```javascript
const response = await fetch('/api/prompts-config');
const data = await response.json();

if (data.success) {
  console.log('Текущие промпты:', data.config);
}
```

### 2. Обновить конфигурацию

```javascript
const response = await fetch('/api/prompts-config', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    updates: {
      rag: {
        systemPrompt: 'Новый системный промпт',
        userPromptTemplate: 'Новый шаблон'
      },
      naturalQuery: { ... },
      l1l2Templates: { ... },
      vectorOperations: { ... }
    },
    comment: 'Улучшил RAG промпт'
  })
});

const data = await response.json();
if (data.success) {
  console.log('Сохранено! Версия:', data.historyEntry.version);
}
```

### 3. Просмотреть историю

```javascript
const response = await fetch('/api/prompts-config/history?limit=10');
const data = await response.json();

if (data.success) {
  console.log('История:', data.history);
}
```

---

## TypeScript Interfaces

### Основные типы

```typescript
/**
 * Уровень промпта (L1 - связи, L2 - логика)
 */
interface L1L2PromptLevel {
  prompt: string;
  inputText: string;
}

/**
 * Промпты для конкретного типа объекта (function, table, view, class)
 */
interface L1L2ObjectPrompts {
  l1: L1L2PromptLevel;
  l2: L1L2PromptLevel;
}

/**
 * Промпты для конкретного языка (sql, js, md)
 */
interface L1L2LanguagePrompts {
  [objectType: string]: L1L2ObjectPrompts;
}

/**
 * Все L1/L2 промпты
 */
interface L1L2Templates {
  sql?: {
    function?: L1L2ObjectPrompts;
    table?: L1L2ObjectPrompts;
    view?: L1L2ObjectPrompts;
  };
  js?: {
    function?: L1L2ObjectPrompts;
    class?: L1L2ObjectPrompts;
  };
  md?: {
    section?: L1L2ObjectPrompts;
  };
  [language: string]: L1L2LanguagePrompts | undefined;
}

/**
 * RAG промпты
 */
interface RagPrompts {
  systemPrompt: string;
  userPromptTemplate: string;
}

/**
 * Natural Query промпты
 */
interface NaturalQueryPrompts {
  scriptGeneration: string;
  humanize: string;
}

/**
 * Vector Operations промпты
 */
interface VectorOperationsPrompts {
  qaPromptTemplate: string;
}

/**
 * Полная конфигурация промптов
 */
interface PromptsConfig {
  l1l2Templates: L1L2Templates;
  rag: RagPrompts;
  naturalQuery: NaturalQueryPrompts;
  vectorOperations: VectorOperationsPrompts;
}

/**
 * Запись в истории изменений (краткая)
 */
interface PromptsHistoryEntry {
  id: number;
  version: number;
  createdAt: string; // ISO 8601
  comment: string | null;
}

/**
 * Запись в истории изменений (полная)
 */
interface PromptsHistoryEntryFull extends PromptsHistoryEntry {
  config: PromptsConfig;
}

/**
 * Запрос на обновление конфигурации
 */
interface PromptsConfigUpdateRequest {
  updates: Partial<PromptsConfig>;
  comment?: string;
}

/**
 * Ответ API при получении конфигурации
 */
interface PromptsConfigResponse {
  success: true;
  config: PromptsConfig;
}

/**
 * Ответ API при обновлении конфигурации
 */
interface PromptsConfigUpdateResponse {
  success: true;
  config: PromptsConfig;
  historyEntry: PromptsHistoryEntry;
  message: string;
}

/**
 * Ответ API при получении истории
 */
interface PromptsConfigHistoryResponse {
  success: true;
  history: PromptsHistoryEntry[];
  count: number;
}

/**
 * Ответ API при получении конкретной версии
 */
interface PromptsConfigHistoryEntryResponse {
  success: true;
  historyEntry: PromptsHistoryEntryFull;
}

/**
 * Ответ API с ошибкой
 */
interface PromptsConfigErrorResponse {
  success: false;
  error: string;
  validationErrors?: string[];
}

/**
 * Общий тип ответа
 */
type PromptsConfigApiResponse =
  | PromptsConfigResponse
  | PromptsConfigUpdateResponse
  | PromptsConfigHistoryResponse
  | PromptsConfigHistoryEntryResponse
  | PromptsConfigErrorResponse;
```

---

## API Endpoints

### Base URL

```typescript
const BASE_URL = 'http://localhost:3200'; // замените на ваш
```

### 1. GET /api/prompts-config

Получить текущую конфигурацию промптов.

```typescript
async function getPromptsConfig(): Promise<PromptsConfigResponse> {
  const response = await fetch(`${BASE_URL}/api/prompts-config`);
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error);
  }
  
  return data;
}

// Использование
const { config } = await getPromptsConfig();
console.log('RAG systemPrompt:', config.rag.systemPrompt);
```

### 2. PATCH /api/prompts-config

Обновить конфигурацию с сохранением в историю.

```typescript
async function updatePromptsConfig(
  updates: Partial<PromptsConfig>,
  comment?: string
): Promise<PromptsConfigUpdateResponse> {
  const response = await fetch(`${BASE_URL}/api/prompts-config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates, comment })
  });
  
  const data = await response.json();
  
  if (!data.success) {
    if (data.validationErrors) {
      throw new Error(`Validation failed: ${data.validationErrors.join(', ')}`);
    }
    throw new Error(data.error);
  }
  
  return data;
}

// Использование
const result = await updatePromptsConfig(
  {
    rag: {
      systemPrompt: 'Новый промпт',
      userPromptTemplate: 'Шаблон'
    },
    naturalQuery: currentConfig.naturalQuery,
    l1l2Templates: currentConfig.l1l2Templates,
    vectorOperations: currentConfig.vectorOperations
  },
  'Улучшил RAG промпт'
);
console.log('Сохранено! Версия:', result.historyEntry.version);
```

### 3. GET /api/prompts-config/history

Получить список истории изменений.

```typescript
async function getPromptsConfigHistory(
  limit: number = 50,
  offset: number = 0
): Promise<PromptsConfigHistoryResponse> {
  const response = await fetch(
    `${BASE_URL}/api/prompts-config/history?limit=${limit}&offset=${offset}`
  );
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error);
  }
  
  return data;
}

// Использование
const { history, count } = await getPromptsConfigHistory(10);
console.log(`Загружено ${count} записей истории`);
```

### 4. GET /api/prompts-config/history/:id

Получить конкретную версию из истории.

```typescript
async function getPromptsConfigHistoryEntry(
  id: number
): Promise<PromptsConfigHistoryEntryResponse> {
  const response = await fetch(`${BASE_URL}/api/prompts-config/history/${id}`);
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error);
  }
  
  return data;
}

// Использование
const { historyEntry } = await getPromptsConfigHistoryEntry(15);
console.log('Версия:', historyEntry.version);
console.log('Конфигурация:', historyEntry.config);
```

### 5. POST /api/prompts-config/restore/:id

Восстановить конфигурацию из истории.

```typescript
async function restorePromptsConfig(
  id: number,
  comment?: string
): Promise<PromptsConfigUpdateResponse> {
  const response = await fetch(`${BASE_URL}/api/prompts-config/restore/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment })
  });
  
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error);
  }
  
  return data;
}

// Использование
const result = await restorePromptsConfig(5, 'Откат к рабочей версии');
console.log('Восстановлено! Новая версия:', result.historyEntry.version);
```

### 6. POST /api/prompts-config/reset

Сбросить конфигурацию к дефолтным значениям.

```typescript
async function resetPromptsConfig(
  comment?: string
): Promise<PromptsConfigUpdateResponse> {
  const response = await fetch(`${BASE_URL}/api/prompts-config/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment })
  });
  
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error);
  }
  
  return data;
}

// Использование
const result = await resetPromptsConfig('Сброс к дефолтам');
console.log('Сброшено! Версия:', result.historyEntry.version);
```

### 7. DELETE /api/prompts-config/history/:id

Удалить запись из истории.

```typescript
async function deletePromptsConfigHistoryEntry(id: number): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/prompts-config/history/${id}`, {
    method: 'DELETE'
  });
  
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error);
  }
}

// Использование
await deletePromptsConfigHistoryEntry(15);
console.log('Запись удалена');
```

---

## React Integration

### Custom Hook: usePromptsConfig

```typescript
import { useState, useCallback, useEffect } from 'react';

interface UsePromptsConfigReturn {
  config: PromptsConfig | null;
  history: PromptsHistoryEntry[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  updateConfig: (updates: Partial<PromptsConfig>, comment?: string) => Promise<void>;
  loadHistory: (limit?: number, offset?: number) => Promise<void>;
  restoreFromHistory: (id: number, comment?: string) => Promise<void>;
  resetToDefaults: (comment?: string) => Promise<void>;
  deleteHistoryEntry: (id: number) => Promise<void>;
  
  // Utils
  refresh: () => Promise<void>;
  clearError: () => void;
}

export function usePromptsConfig(): UsePromptsConfigReturn {
  const [config, setConfig] = useState<PromptsConfig | null>(null);
  const [history, setHistory] = useState<PromptsHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const BASE_URL = 'http://localhost:3200';
  
  // Загрузка текущей конфигурации
  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${BASE_URL}/api/prompts-config`);
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error);
      }
      
      setConfig(data.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config');
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  // Обновление конфигурации
  const updateConfig = useCallback(async (
    updates: Partial<PromptsConfig>,
    comment?: string
  ) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${BASE_URL}/api/prompts-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates, comment })
      });
      
      const data = await response.json();
      
      if (!data.success) {
        if (data.validationErrors) {
          throw new Error(`Validation failed:\n${data.validationErrors.join('\n')}`);
        }
        throw new Error(data.error);
      }
      
      setConfig(data.config);
      
      // Перезагрузить историю
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update config');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  // Загрузка истории
  const loadHistory = useCallback(async (limit: number = 50, offset: number = 0) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(
        `${BASE_URL}/api/prompts-config/history?limit=${limit}&offset=${offset}`
      );
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error);
      }
      
      setHistory(data.history);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  // Восстановление из истории
  const restoreFromHistory = useCallback(async (id: number, comment?: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${BASE_URL}/api/prompts-config/restore/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment })
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error);
      }
      
      setConfig(data.config);
      
      // Перезагрузить историю
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore config');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [loadHistory]);
  
  // Сброс к дефолтным значениям
  const resetToDefaults = useCallback(async (comment?: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${BASE_URL}/api/prompts-config/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment })
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error);
      }
      
      setConfig(data.config);
      
      // Перезагрузить историю
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset config');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [loadHistory]);
  
  // Удаление записи из истории
  const deleteHistoryEntry = useCallback(async (id: number) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${BASE_URL}/api/prompts-config/history/${id}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error);
      }
      
      // Перезагрузить историю
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete history entry');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [loadHistory]);
  
  // Обновить всё
  const refresh = useCallback(async () => {
    await Promise.all([loadConfig(), loadHistory()]);
  }, [loadConfig, loadHistory]);
  
  // Очистить ошибку
  const clearError = useCallback(() => {
    setError(null);
  }, []);
  
  // Загрузить конфигурацию при монтировании
  useEffect(() => {
    refresh();
  }, [refresh]);
  
  return {
    config,
    history,
    isLoading,
    error,
    updateConfig,
    loadHistory,
    restoreFromHistory,
    resetToDefaults,
    deleteHistoryEntry,
    refresh,
    clearError
  };
}
```

### Использование Hook в компоненте

```typescript
import React, { useState } from 'react';
import { usePromptsConfig } from './usePromptsConfig';

export function PromptsConfigEditor() {
  const {
    config,
    history,
    isLoading,
    error,
    updateConfig,
    restoreFromHistory,
    resetToDefaults,
    clearError
  } = usePromptsConfig();
  
  const [editedPrompt, setEditedPrompt] = useState('');
  const [comment, setComment] = useState('');
  
  const handleSave = async () => {
    if (!config) return;
    
    try {
      await updateConfig(
        {
          rag: {
            ...config.rag,
            systemPrompt: editedPrompt
          },
          naturalQuery: config.naturalQuery,
          l1l2Templates: config.l1l2Templates,
          vectorOperations: config.vectorOperations
        },
        comment
      );
      
      alert('Saved successfully!');
      setComment('');
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };
  
  const handleRestore = async (id: number) => {
    if (confirm(`Restore version ${id}?`)) {
      try {
        await restoreFromHistory(id, 'Restored from history');
        alert('Restored successfully!');
      } catch (err) {
        alert(`Error: ${err.message}`);
      }
    }
  };
  
  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!config) return <div>No config loaded</div>;
  
  return (
    <div>
      <h1>Prompts Config Editor</h1>
      
      <div>
        <h2>RAG System Prompt</h2>
        <textarea
          value={editedPrompt || config.rag.systemPrompt}
          onChange={(e) => setEditedPrompt(e.target.value)}
          rows={10}
          style={{ width: '100%' }}
        />
      </div>
      
      <div>
        <label>
          Comment:
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Describe your changes..."
          />
        </label>
      </div>
      
      <button onClick={handleSave}>Save</button>
      <button onClick={() => resetToDefaults('Reset to defaults')}>
        Reset to Defaults
      </button>
      
      <div>
        <h2>History</h2>
        <ul>
          {history.map((entry) => (
            <li key={entry.id}>
              Version {entry.version} - {new Date(entry.createdAt).toLocaleString()}
              {entry.comment && ` - ${entry.comment}`}
              <button onClick={() => handleRestore(entry.id)}>Restore</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

---

## Vue 3 Integration

### Composable: usePromptsConfig

```typescript
import { ref, onMounted } from 'vue';
import type { Ref } from 'vue';

export function usePromptsConfig() {
  const config: Ref<PromptsConfig | null> = ref(null);
  const history: Ref<PromptsHistoryEntry[]> = ref([]);
  const isLoading: Ref<boolean> = ref(false);
  const error: Ref<string | null> = ref(null);
  
  const BASE_URL = 'http://localhost:3200';
  
  // Загрузка конфигурации
  async function loadConfig() {
    isLoading.value = true;
    error.value = null;
    
    try {
      const response = await fetch(`${BASE_URL}/api/prompts-config`);
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error);
      }
      
      config.value = data.config;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load config';
    } finally {
      isLoading.value = false;
    }
  }
  
  // Обновление конфигурации
  async function updateConfig(updates: Partial<PromptsConfig>, comment?: string) {
    isLoading.value = true;
    error.value = null;
    
    try {
      const response = await fetch(`${BASE_URL}/api/prompts-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates, comment })
      });
      
      const data = await response.json();
      
      if (!data.success) {
        if (data.validationErrors) {
          throw new Error(`Validation failed:\n${data.validationErrors.join('\n')}`);
        }
        throw new Error(data.error);
      }
      
      config.value = data.config;
      await loadHistory();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update config';
      throw err;
    } finally {
      isLoading.value = false;
    }
  }
  
  // Загрузка истории
  async function loadHistory(limit: number = 50, offset: number = 0) {
    isLoading.value = true;
    error.value = null;
    
    try {
      const response = await fetch(
        `${BASE_URL}/api/prompts-config/history?limit=${limit}&offset=${offset}`
      );
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error);
      }
      
      history.value = data.history;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load history';
    } finally {
      isLoading.value = false;
    }
  }
  
  // Восстановление из истории
  async function restoreFromHistory(id: number, comment?: string) {
    isLoading.value = true;
    error.value = null;
    
    try {
      const response = await fetch(`${BASE_URL}/api/prompts-config/restore/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment })
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error);
      }
      
      config.value = data.config;
      await loadHistory();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to restore config';
      throw err;
    } finally {
      isLoading.value = false;
    }
  }
  
  // Сброс к дефолтным значениям
  async function resetToDefaults(comment?: string) {
    isLoading.value = true;
    error.value = null;
    
    try {
      const response = await fetch(`${BASE_URL}/api/prompts-config/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment })
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error);
      }
      
      config.value = data.config;
      await loadHistory();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to reset config';
      throw err;
    } finally {
      isLoading.value = false;
    }
  }
  
  // Удаление записи из истории
  async function deleteHistoryEntry(id: number) {
    isLoading.value = true;
    error.value = null;
    
    try {
      const response = await fetch(`${BASE_URL}/api/prompts-config/history/${id}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error);
      }
      
      await loadHistory();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete history entry';
      throw err;
    } finally {
      isLoading.value = false;
    }
  }
  
  // Обновить всё
  async function refresh() {
    await Promise.all([loadConfig(), loadHistory()]);
  }
  
  // Очистить ошибку
  function clearError() {
    error.value = null;
  }
  
  // Загрузить при монтировании
  onMounted(() => {
    refresh();
  });
  
  return {
    config,
    history,
    isLoading,
    error,
    updateConfig,
    loadHistory,
    restoreFromHistory,
    resetToDefaults,
    deleteHistoryEntry,
    refresh,
    clearError
  };
}
```

### Использование Composable в компоненте

```vue
<template>
  <div>
    <h1>Prompts Config Editor</h1>
    
    <div v-if="isLoading">Loading...</div>
    <div v-else-if="error">Error: {{ error }}</div>
    <div v-else-if="config">
      <div>
        <h2>RAG System Prompt</h2>
        <textarea
          v-model="editedPrompt"
          rows="10"
          style="width: 100%"
        />
      </div>
      
      <div>
        <label>
          Comment:
          <input
            v-model="comment"
            type="text"
            placeholder="Describe your changes..."
          />
        </label>
      </div>
      
      <button @click="handleSave">Save</button>
      <button @click="handleReset">Reset to Defaults</button>
      
      <div>
        <h2>History</h2>
        <ul>
          <li v-for="entry in history" :key="entry.id">
            Version {{ entry.version }} - {{ formatDate(entry.createdAt) }}
            <span v-if="entry.comment"> - {{ entry.comment }}</span>
            <button @click="handleRestore(entry.id)">Restore</button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { usePromptsConfig } from './usePromptsConfig';

const {
  config,
  history,
  isLoading,
  error,
  updateConfig,
  restoreFromHistory,
  resetToDefaults
} = usePromptsConfig();

const editedPrompt = ref('');
const comment = ref('');

// Синхронизировать editedPrompt с config
watch(config, (newConfig) => {
  if (newConfig) {
    editedPrompt.value = newConfig.rag.systemPrompt;
  }
}, { immediate: true });

async function handleSave() {
  if (!config.value) return;
  
  try {
    await updateConfig(
      {
        rag: {
          ...config.value.rag,
          systemPrompt: editedPrompt.value
        },
        naturalQuery: config.value.naturalQuery,
        l1l2Templates: config.value.l1l2Templates,
        vectorOperations: config.value.vectorOperations
      },
      comment.value
    );
    
    alert('Saved successfully!');
    comment.value = '';
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function handleRestore(id: number) {
  if (confirm(`Restore version ${id}?`)) {
    try {
      await restoreFromHistory(id, 'Restored from history');
      alert('Restored successfully!');
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  }
}

async function handleReset() {
  if (confirm('Reset to default prompts?')) {
    try {
      await resetToDefaults('Reset to defaults');
      alert('Reset successfully!');
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  }
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString();
}
</script>
```

---

## Валидация

### Клиентская валидация

```typescript
interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

function validatePromptsConfig(config: Partial<PromptsConfig>): ValidationResult {
  const errors: string[] = [];
  
  // Проверка наличия основных секций
  if (!config.l1l2Templates) {
    errors.push('l1l2Templates is required');
  }
  if (!config.rag) {
    errors.push('rag is required');
  }
  if (!config.naturalQuery) {
    errors.push('naturalQuery is required');
  }
  if (!config.vectorOperations) {
    errors.push('vectorOperations is required');
  }
  
  // Проверка RAG промптов
  if (config.rag) {
    if (!config.rag.systemPrompt || config.rag.systemPrompt.trim() === '') {
      errors.push('rag.systemPrompt must be a non-empty string');
    }
    if (!config.rag.userPromptTemplate || config.rag.userPromptTemplate.trim() === '') {
      errors.push('rag.userPromptTemplate must be a non-empty string');
    }
  }
  
  // Проверка Natural Query промптов
  if (config.naturalQuery) {
    if (!config.naturalQuery.scriptGeneration || config.naturalQuery.scriptGeneration.trim() === '') {
      errors.push('naturalQuery.scriptGeneration must be a non-empty string');
    }
    if (!config.naturalQuery.humanize || config.naturalQuery.humanize.trim() === '') {
      errors.push('naturalQuery.humanize must be a non-empty string');
    }
  }
  
  // Проверка Vector Operations промптов
  if (config.vectorOperations) {
    if (!config.vectorOperations.qaPromptTemplate || config.vectorOperations.qaPromptTemplate.trim() === '') {
      errors.push('vectorOperations.qaPromptTemplate must be a non-empty string');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// Использование
const validation = validatePromptsConfig(updatedConfig);
if (!validation.isValid) {
  alert(`Validation errors:\n${validation.errors.join('\n')}`);
  return;
}
```

### Проверка перед отправкой

```typescript
async function safeUpdateConfig(
  updates: Partial<PromptsConfig>,
  comment?: string
) {
  // Клиентская валидация
  const validation = validatePromptsConfig(updates);
  if (!validation.isValid) {
    throw new Error(`Validation failed:\n${validation.errors.join('\n')}`);
  }
  
  // Отправка на сервер
  try {
    const response = await fetch('/api/prompts-config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates, comment })
    });
    
    const data = await response.json();
    
    if (!data.success) {
      // Серверная валидация не прошла
      if (data.validationErrors) {
        throw new Error(`Server validation failed:\n${data.validationErrors.join('\n')}`);
      }
      throw new Error(data.error);
    }
    
    return data;
  } catch (err) {
    console.error('Update failed:', err);
    throw err;
  }
}
```

---

## Управление историей

### Пагинация истории

```typescript
interface HistoryPaginationState {
  currentPage: number;
  pageSize: number;
  totalPages: number;
}

function useHistoryPagination() {
  const [state, setState] = useState<HistoryPaginationState>({
    currentPage: 1,
    pageSize: 10,
    totalPages: 1
  });
  
  const [history, setHistory] = useState<PromptsHistoryEntry[]>([]);
  
  async function loadPage(page: number) {
    const offset = (page - 1) * state.pageSize;
    const response = await fetch(
      `/api/prompts-config/history?limit=${state.pageSize}&offset=${offset}`
    );
    const data = await response.json();
    
    if (data.success) {
      setHistory(data.history);
      setState(prev => ({
        ...prev,
        currentPage: page,
        totalPages: Math.ceil(data.count / state.pageSize)
      }));
    }
  }
  
  async function nextPage() {
    if (state.currentPage < state.totalPages) {
      await loadPage(state.currentPage + 1);
    }
  }
  
  async function prevPage() {
    if (state.currentPage > 1) {
      await loadPage(state.currentPage - 1);
    }
  }
  
  return {
    history,
    state,
    loadPage,
    nextPage,
    prevPage
  };
}
```

### Сравнение версий

```typescript
interface ConfigDiff {
  field: string;
  oldValue: any;
  newValue: any;
}

async function compareVersions(
  oldId: number,
  newId: number
): Promise<ConfigDiff[]> {
  const [oldResponse, newResponse] = await Promise.all([
    fetch(`/api/prompts-config/history/${oldId}`),
    fetch(`/api/prompts-config/history/${newId}`)
  ]);
  
  const oldData = await oldResponse.json();
  const newData = await newResponse.json();
  
  if (!oldData.success || !newData.success) {
    throw new Error('Failed to load versions');
  }
  
  const oldConfig = oldData.historyEntry.config;
  const newConfig = newData.historyEntry.config;
  
  const diffs: ConfigDiff[] = [];
  
  // Сравнение RAG промптов
  if (oldConfig.rag.systemPrompt !== newConfig.rag.systemPrompt) {
    diffs.push({
      field: 'rag.systemPrompt',
      oldValue: oldConfig.rag.systemPrompt,
      newValue: newConfig.rag.systemPrompt
    });
  }
  
  if (oldConfig.rag.userPromptTemplate !== newConfig.rag.userPromptTemplate) {
    diffs.push({
      field: 'rag.userPromptTemplate',
      oldValue: oldConfig.rag.userPromptTemplate,
      newValue: newConfig.rag.userPromptTemplate
    });
  }
  
  // Аналогично для других полей...
  
  return diffs;
}

// Использование
const diffs = await compareVersions(5, 6);
console.log('Изменения:', diffs);
```

---

## Error Handling

### Обработка ошибок сети

```typescript
async function fetchWithRetry<T>(
  url: string,
  options?: RequestInit,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Operation failed');
      }
      
      return data as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      // Ждём перед повтором (exponential backoff)
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
      }
    }
  }
  
  throw lastError!;
}

// Использование
const data = await fetchWithRetry<PromptsConfigResponse>('/api/prompts-config');
```

### Глобальный обработчик ошибок

```typescript
class PromptsConfigError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'PromptsConfigError';
  }
}

function handleApiError(error: any): never {
  if (error instanceof PromptsConfigError) {
    // Специфичная обработка
    console.error(`[${error.code}] ${error.message}`, error.details);
  } else if (error instanceof TypeError) {
    // Ошибка сети
    throw new PromptsConfigError(
      'Network error: Please check your connection',
      'NETWORK_ERROR',
      error
    );
  } else {
    // Прочие ошибки
    throw new PromptsConfigError(
      'Unknown error occurred',
      'UNKNOWN_ERROR',
      error
    );
  }
  
  throw error;
}

// Использование
try {
  await updateConfig(newConfig);
} catch (err) {
  handleApiError(err);
}
```

---

## Best Practices

### 1. Всегда валидируйте на клиенте

```typescript
// ❌ Плохо: отправка без валидации
await updateConfig({ rag: { systemPrompt: '' } });

// ✅ Хорошо: валидация перед отправкой
const validation = validatePromptsConfig(updates);
if (validation.isValid) {
  await updateConfig(updates);
} else {
  showErrors(validation.errors);
}
```

### 2. Используйте комментарии

```typescript
// ❌ Плохо: без комментария
await updateConfig(updates);

// ✅ Хорошо: с описательным комментарием
await updateConfig(updates, 'Улучшил RAG промпт для лучшей точности');
```

### 3. Обрабатывайте ошибки

```typescript
// ❌ Плохо: игнорирование ошибок
updateConfig(updates).catch(() => {});

// ✅ Хорошо: обработка и информирование пользователя
try {
  await updateConfig(updates);
  showSuccess('Configuration updated successfully');
} catch (err) {
  showError(`Failed to update: ${err.message}`);
}
```

### 4. Подтверждайте деструктивные операции

```typescript
// ❌ Плохо: удаление без подтверждения
await deleteHistoryEntry(id);

// ✅ Хорошо: с подтверждением
if (confirm(`Delete version ${id}? This cannot be undone.`)) {
  await deleteHistoryEntry(id);
}
```

### 5. Кэшируйте редко меняющиеся данные

```typescript
// Кэш для конфигурации
const configCache = {
  data: null as PromptsConfig | null,
  timestamp: 0,
  ttl: 60000 // 1 минута
};

async function getCachedConfig(): Promise<PromptsConfig> {
  const now = Date.now();
  
  if (configCache.data && (now - configCache.timestamp) < configCache.ttl) {
    return configCache.data;
  }
  
  const response = await fetch('/api/prompts-config');
  const data = await response.json();
  
  configCache.data = data.config;
  configCache.timestamp = now;
  
  return data.config;
}
```

---

## Примеры UI компонентов

### Компонент редактора промптов (React)

```tsx
import React, { useState } from 'react';
import { usePromptsConfig } from './usePromptsConfig';

interface PromptEditorProps {
  title: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}

function PromptEditor({ title, value, onChange, rows = 10 }: PromptEditorProps) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <h3>{title}</h3>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        style={{
          width: '100%',
          fontFamily: 'monospace',
          fontSize: '14px',
          padding: '10px',
          border: '1px solid #ccc',
          borderRadius: '4px'
        }}
      />
      <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
        {value.length} characters
      </div>
    </div>
  );
}

export function PromptsConfigManager() {
  const {
    config,
    history,
    isLoading,
    error,
    updateConfig,
    restoreFromHistory,
    resetToDefaults,
    clearError
  } = usePromptsConfig();
  
  const [editedConfig, setEditedConfig] = useState<PromptsConfig | null>(null);
  const [comment, setComment] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  
  // Синхронизировать editedConfig с config
  React.useEffect(() => {
    if (config && !editedConfig) {
      setEditedConfig(config);
    }
  }, [config, editedConfig]);
  
  const handleSave = async () => {
    if (!editedConfig) return;
    
    if (!comment.trim()) {
      alert('Please enter a comment describing your changes');
      return;
    }
    
    try {
      await updateConfig(editedConfig, comment);
      alert('✅ Configuration saved successfully!');
      setComment('');
    } catch (err) {
      alert(`❌ Error: ${err.message}`);
    }
  };
  
  const handleRestore = async (id: number, version: number) => {
    if (confirm(`Restore version ${version}? Current changes will be lost.`)) {
      try {
        await restoreFromHistory(id, `Restored from version ${version}`);
        alert(`✅ Restored version ${version} successfully!`);
        setEditedConfig(null); // Перезагрузить
      } catch (err) {
        alert(`❌ Error: ${err.message}`);
      }
    }
  };
  
  const handleReset = async () => {
    if (confirm('Reset to default prompts? Current changes will be lost.')) {
      try {
        await resetToDefaults('Reset to default prompts');
        alert('✅ Reset to defaults successfully!');
        setEditedConfig(null); // Перезагрузить
      } catch (err) {
        alert(`❌ Error: ${err.message}`);
      }
    }
  };
  
  if (isLoading) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>⏳ Loading...</div>;
  }
  
  if (error) {
    return (
      <div style={{ padding: '20px', color: 'red' }}>
        ❌ Error: {error}
        <button onClick={clearError}>Dismiss</button>
      </div>
    );
  }
  
  if (!editedConfig) {
    return <div style={{ padding: '20px' }}>No configuration loaded</div>;
  }
  
  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1>🤖 Prompts Configuration</h1>
        <button onClick={() => setShowHistory(!showHistory)}>
          {showHistory ? 'Hide' : 'Show'} History
        </button>
      </div>
      
      {showHistory && (
        <div style={{ marginBottom: '30px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
          <h2>📜 History</h2>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {history.length === 0 ? (
              <p>No history yet</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {history.map((entry) => (
                  <li
                    key={entry.id}
                    style={{
                      padding: '10px',
                      marginBottom: '10px',
                      backgroundColor: 'white',
                      borderRadius: '4px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <strong>Version {entry.version}</strong>
                      <br />
                      <small>{new Date(entry.createdAt).toLocaleString()}</small>
                      {entry.comment && (
                        <>
                          <br />
                          <small style={{ color: '#666' }}>{entry.comment}</small>
                        </>
                      )}
                    </div>
                    <button
                      onClick={() => handleRestore(entry.id, entry.version)}
                      style={{
                        padding: '5px 10px',
                        backgroundColor: '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      
      <div style={{ marginBottom: '30px' }}>
        <h2>📝 Edit Prompts</h2>
        
        <PromptEditor
          title="RAG System Prompt"
          value={editedConfig.rag.systemPrompt}
          onChange={(value) =>
            setEditedConfig({
              ...editedConfig,
              rag: { ...editedConfig.rag, systemPrompt: value }
            })
          }
        />
        
        <PromptEditor
          title="RAG User Prompt Template"
          value={editedConfig.rag.userPromptTemplate}
          onChange={(value) =>
            setEditedConfig({
              ...editedConfig,
              rag: { ...editedConfig.rag, userPromptTemplate: value }
            })
          }
          rows={5}
        />
        
        <PromptEditor
          title="Natural Query - Script Generation"
          value={editedConfig.naturalQuery.scriptGeneration}
          onChange={(value) =>
            setEditedConfig({
              ...editedConfig,
              naturalQuery: { ...editedConfig.naturalQuery, scriptGeneration: value }
            })
          }
          rows={15}
        />
        
        <PromptEditor
          title="Natural Query - Humanize"
          value={editedConfig.naturalQuery.humanize}
          onChange={(value) =>
            setEditedConfig({
              ...editedConfig,
              naturalQuery: { ...editedConfig.naturalQuery, humanize: value }
            })
          }
          rows={5}
        />
        
        <PromptEditor
          title="Vector Operations - QA Template"
          value={editedConfig.vectorOperations.qaPromptTemplate}
          onChange={(value) =>
            setEditedConfig({
              ...editedConfig,
              vectorOperations: { ...editedConfig.vectorOperations, qaPromptTemplate: value }
            })
          }
          rows={5}
        />
      </div>
      
      <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
        <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>
          💬 Comment (required)
        </label>
        <input
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Describe your changes..."
          style={{
            width: '100%',
            padding: '10px',
            fontSize: '14px',
            border: '1px solid #ccc',
            borderRadius: '4px'
          }}
        />
      </div>
      
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={handleSave}
          disabled={!comment.trim()}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            backgroundColor: comment.trim() ? '#28a745' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: comment.trim() ? 'pointer' : 'not-allowed'
          }}
        >
          💾 Save Changes
        </button>
        
        <button
          onClick={handleReset}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          🔄 Reset to Defaults
        </button>
      </div>
    </div>
  );
}
```

---

## Заключение

Prompts Config API предоставляет полноценное управление промптами LLM через веб-интерфейс с историей изменений, валидацией и удобными инструментами для интеграции.

### Основные преимущества

✅ **Простая интеграция** - готовые хуки для React и Vue  
✅ **TypeScript** - полная типизация из коробки  
✅ **История** - отслеживание всех изменений  
✅ **Безопасность** - валидация на клиенте и сервере  
✅ **Гибкость** - поддержка частичных обновлений

### Дополнительные ресурсы

- **Backend API:** `KB/README_PROMPTS_CONFIG_API.md`
- **REST API Overview:** `KB/README_REST.md`
- **OpenAPI Contract:** `docs/api-contract.yaml`
- **Tests:** `tests/test_prompts_config.js`

---

**Версия документа:** 1.0  
**Последнее обновление:** 08.02.2026
