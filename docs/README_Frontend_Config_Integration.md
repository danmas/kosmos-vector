# Frontend Integration Guide: App Config API

## Версия API: 2.8.0

Руководство по интеграции API управления глобальной конфигурацией приложения в пользовательский интерфейс.

---

## 📋 Содержание

1. [Обзор функционала](#обзор-функционала)
2. [API Endpoints](#api-endpoints)
3. [Типы данных](#типы-данных)
4. [Примеры интеграции](#примеры-интеграции)
5. [Обработка ошибок](#обработка-ошибок)
6. [Валидация на клиенте](#валидация-на-клиенте)
7. [UI/UX рекомендации](#uiux-рекомендации)
8. [Примеры компонентов](#примеры-компонентов)

---

## Обзор функционала

App Config API позволяет фронтенду управлять глобальными настройками приложения (`config.json`):

- 🔧 **KOSMOS_BASE_URL** — URL внешнего LLM сервера (kosmos-model)
- 🤖 **KOSMOS_MODEL** — модель по умолчанию для LLM запросов
- 🧠 **KOSMOS_LOGIC_ARHITECT_MODEL** — модель для анализа логики функций
- 📊 **LOG_LEVEL** — уровень логирования (debug/info/warn/error)
- 🔍 **NATURAL_QUERY_SUGGEST_LIMIT** — количество подсказок для natural query
- 📏 **NATURAL_QUERY_SIMILARITY_THRESHOLD** — порог схожести для поиска
- ✨ **NATURAL_QUERY_AUTO_USE_THRESHOLD** — порог для авто-использования cached скриптов

### Ключевые особенности:
- ✅ **Не требует `context-code`** — настройки глобальные
- ✅ **Частичное обновление** — можно менять только нужные поля
- ✅ **Валидация на сервере** — с детальными сообщениями об ошибках
- ✅ **Без перезагрузки сервера** — изменения применяются динамически

---

## API Endpoints

### Base URL
```
http://localhost:3200
```

### 1. GET /api/config
Получить текущую конфигурацию.

**Request:**
```http
GET /api/config HTTP/1.1
```

**Response 200:**
```json
{
  "success": true,
  "config": {
    "KOSMOS_BASE_URL": "http://localhost:3002/v1",
    "KOSMOS_MODEL": "FAST",
    "KOSMOS_LOGIC_ARHITECT_MODEL": "INSTRUCT",
    "LOG_LEVEL": "info",
    "NATURAL_QUERY_SUGGEST_LIMIT": 5,
    "NATURAL_QUERY_SIMILARITY_THRESHOLD": 0.8,
    "NATURAL_QUERY_AUTO_USE_THRESHOLD": 0.95
  }
}
```

---

### 2. PATCH /api/config
Частично обновить конфигурацию.

**Request:**
```http
PATCH /api/config HTTP/1.1
Content-Type: application/json

{
  "KOSMOS_MODEL": "RICH",
  "LOG_LEVEL": "debug"
}
```

**Response 200 (успех):**
```json
{
  "success": true,
  "config": {
    "KOSMOS_BASE_URL": "http://localhost:3002/v1",
    "KOSMOS_MODEL": "RICH",
    "KOSMOS_LOGIC_ARHITECT_MODEL": "INSTRUCT",
    "LOG_LEVEL": "debug",
    "NATURAL_QUERY_SUGGEST_LIMIT": 5,
    "NATURAL_QUERY_SIMILARITY_THRESHOLD": 0.8,
    "NATURAL_QUERY_AUTO_USE_THRESHOLD": 0.95
  },
  "message": "Configuration updated successfully"
}
```

**Response 400 (ошибка валидации):**
```json
{
  "success": false,
  "error": "Configuration validation failed",
  "validationErrors": [
    "KOSMOS_BASE_URL must be a valid URL",
    "LOG_LEVEL must be one of: debug, info, warn, error"
  ]
}
```

---

### 3. POST /api/config/reset
Сбросить конфигурацию к значениям по умолчанию.

**⚠️ Используйте с осторожностью! Требуется подтверждение пользователя.**

**Request:**
```http
POST /api/config/reset HTTP/1.1
```

**Response 200:**
```json
{
  "success": true,
  "config": {
    "KOSMOS_BASE_URL": "http://localhost:3002/v1",
    "KOSMOS_MODEL": "FAST",
    "KOSMOS_LOGIC_ARHITECT_MODEL": "INSTRUCT",
    "LOG_LEVEL": "info",
    "NATURAL_QUERY_SUGGEST_LIMIT": 5,
    "NATURAL_QUERY_SIMILARITY_THRESHOLD": 0.8,
    "NATURAL_QUERY_AUTO_USE_THRESHOLD": 0.95
  },
  "message": "Configuration reset to defaults"
}
```

---

## Типы данных

### TypeScript интерфейсы

```typescript
// Основной тип конфигурации
interface AppConfig {
  KOSMOS_BASE_URL: string;           // URL формат
  KOSMOS_MODEL: string;              // Строка (TODO: enum после согласования)
  KOSMOS_LOGIC_ARHITECT_MODEL: string | null;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  NATURAL_QUERY_SUGGEST_LIMIT: number;        // 1-100
  NATURAL_QUERY_SIMILARITY_THRESHOLD: number;  // 0-1
  NATURAL_QUERY_AUTO_USE_THRESHOLD: number;    // 0-1
}

// Ответ при получении конфигурации
interface AppConfigResponse {
  success: true;
  config: AppConfig;
}

// Запрос на обновление (все поля опциональны)
interface AppConfigUpdateRequest {
  KOSMOS_BASE_URL?: string;
  KOSMOS_MODEL?: string;
  KOSMOS_LOGIC_ARHITECT_MODEL?: string | null;
  LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
  NATURAL_QUERY_SUGGEST_LIMIT?: number;
  NATURAL_QUERY_SIMILARITY_THRESHOLD?: number;
  NATURAL_QUERY_AUTO_USE_THRESHOLD?: number;
}

// Ответ при обновлении
interface AppConfigUpdateResponse {
  success: true;
  config: AppConfig;
  message: string;
}

// Ошибка валидации
interface AppConfigValidationError {
  success: false;
  error: string;
  validationErrors: string[];
}

// Общая ошибка
interface ErrorResponse {
  success: false;
  error: string;
}
```

---

## Примеры интеграции

### Vanilla JavaScript

```javascript
// Получить конфигурацию
async function getConfig() {
  const response = await fetch('/api/config');
  const data = await response.json();
  
  if (data.success) {
    console.log('Current config:', data.config);
    return data.config;
  } else {
    console.error('Error:', data.error);
    throw new Error(data.error);
  }
}

// Обновить конфигурацию
async function updateConfig(updates) {
  const response = await fetch('/api/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  
  const data = await response.json();
  
  if (response.status === 400) {
    // Ошибки валидации
    console.error('Validation errors:', data.validationErrors);
    return { success: false, errors: data.validationErrors };
  }
  
  if (data.success) {
    console.log('Config updated:', data.config);
    return { success: true, config: data.config };
  } else {
    console.error('Error:', data.error);
    return { success: false, error: data.error };
  }
}

// Сбросить конфигурацию
async function resetConfig() {
  if (!confirm('Вы уверены? Все настройки будут сброшены к значениям по умолчанию.')) {
    return;
  }
  
  const response = await fetch('/api/config/reset', {
    method: 'POST'
  });
  
  const data = await response.json();
  
  if (data.success) {
    console.log('Config reset to defaults:', data.config);
    return data.config;
  } else {
    console.error('Error:', data.error);
    throw new Error(data.error);
  }
}

// Пример использования
async function main() {
  // Получить текущую конфигурацию
  const config = await getConfig();
  
  // Изменить модель и уровень логирования
  const result = await updateConfig({
    KOSMOS_MODEL: 'RICH',
    LOG_LEVEL: 'debug'
  });
  
  if (result.success) {
    console.log('✅ Настройки сохранены!');
  } else {
    console.error('❌ Ошибка:', result.errors || result.error);
  }
}
```

---

### React Hook

```typescript
// useAppConfig.ts
import { useState, useEffect, useCallback } from 'react';

interface AppConfig {
  KOSMOS_BASE_URL: string;
  KOSMOS_MODEL: string;
  KOSMOS_LOGIC_ARHITECT_MODEL: string | null;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  NATURAL_QUERY_SUGGEST_LIMIT: number;
  NATURAL_QUERY_SIMILARITY_THRESHOLD: number;
  NATURAL_QUERY_AUTO_USE_THRESHOLD: number;
}

interface UseAppConfigReturn {
  config: AppConfig | null;
  loading: boolean;
  error: string | null;
  validationErrors: string[];
  updateConfig: (updates: Partial<AppConfig>) => Promise<boolean>;
  resetConfig: () => Promise<boolean>;
  refresh: () => Promise<void>;
}

export function useAppConfig(): UseAppConfigReturn {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Загрузить конфигурацию
  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/config');
      const data = await response.json();
      
      if (data.success) {
        setConfig(data.config);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config');
    } finally {
      setLoading(false);
    }
  }, []);

  // Обновить конфигурацию
  const updateConfig = useCallback(async (updates: Partial<AppConfig>): Promise<boolean> => {
    try {
      setError(null);
      setValidationErrors([]);
      
      const response = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      
      const data = await response.json();
      
      if (response.status === 400) {
        setValidationErrors(data.validationErrors || []);
        return false;
      }
      
      if (data.success) {
        setConfig(data.config);
        return true;
      } else {
        setError(data.error);
        return false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update config');
      return false;
    }
  }, []);

  // Сбросить конфигурацию
  const resetConfig = useCallback(async (): Promise<boolean> => {
    try {
      setError(null);
      
      const response = await fetch('/api/config/reset', {
        method: 'POST'
      });
      
      const data = await response.json();
      
      if (data.success) {
        setConfig(data.config);
        return true;
      } else {
        setError(data.error);
        return false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset config');
      return false;
    }
  }, []);

  // Загрузить при монтировании
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  return {
    config,
    loading,
    error,
    validationErrors,
    updateConfig,
    resetConfig,
    refresh: loadConfig
  };
}
```

**Использование в компоненте:**

```typescript
// SettingsPage.tsx
import React, { useState } from 'react';
import { useAppConfig } from './useAppConfig';

export function SettingsPage() {
  const { config, loading, error, validationErrors, updateConfig, resetConfig } = useAppConfig();
  const [saving, setSaving] = useState(false);

  if (loading) return <div>Загрузка настроек...</div>;
  if (error) return <div>Ошибка: {error}</div>;
  if (!config) return null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    
    const formData = new FormData(e.currentTarget);
    const updates = {
      KOSMOS_BASE_URL: formData.get('baseUrl') as string,
      KOSMOS_MODEL: formData.get('model') as string,
      LOG_LEVEL: formData.get('logLevel') as 'debug' | 'info' | 'warn' | 'error'
    };
    
    const success = await updateConfig(updates);
    setSaving(false);
    
    if (success) {
      alert('✅ Настройки сохранены!');
    }
  };

  const handleReset = async () => {
    if (window.confirm('Сбросить все настройки к значениям по умолчанию?')) {
      const success = await resetConfig();
      if (success) {
        alert('✅ Настройки сброшены!');
      }
    }
  };

  return (
    <div>
      <h1>Настройки приложения</h1>
      
      {validationErrors.length > 0 && (
        <div className="error-box">
          <h3>Ошибки валидации:</h3>
          <ul>
            {validationErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}
      
      <form onSubmit={handleSubmit}>
        <label>
          Base URL:
          <input 
            name="baseUrl" 
            type="url" 
            defaultValue={config.KOSMOS_BASE_URL} 
            required 
          />
        </label>
        
        <label>
          Model:
          <input 
            name="model" 
            type="text" 
            defaultValue={config.KOSMOS_MODEL} 
            required 
          />
        </label>
        
        <label>
          Log Level:
          <select name="logLevel" defaultValue={config.LOG_LEVEL}>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>
        </label>
        
        <button type="submit" disabled={saving}>
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
        
        <button type="button" onClick={handleReset}>
          Сбросить к умолчаниям
        </button>
      </form>
    </div>
  );
}
```

---

### Vue 3 Composition API

```typescript
// useAppConfig.ts
import { ref, onMounted } from 'vue';

interface AppConfig {
  KOSMOS_BASE_URL: string;
  KOSMOS_MODEL: string;
  KOSMOS_LOGIC_ARHITECT_MODEL: string | null;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  NATURAL_QUERY_SUGGEST_LIMIT: number;
  NATURAL_QUERY_SIMILARITY_THRESHOLD: number;
  NATURAL_QUERY_AUTO_USE_THRESHOLD: number;
}

export function useAppConfig() {
  const config = ref<AppConfig | null>(null);
  const loading = ref(true);
  const error = ref<string | null>(null);
  const validationErrors = ref<string[]>([]);

  async function loadConfig() {
    try {
      loading.value = true;
      error.value = null;
      
      const response = await fetch('/api/config');
      const data = await response.json();
      
      if (data.success) {
        config.value = data.config;
      } else {
        error.value = data.error;
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load config';
    } finally {
      loading.value = false;
    }
  }

  async function updateConfig(updates: Partial<AppConfig>): Promise<boolean> {
    try {
      error.value = null;
      validationErrors.value = [];
      
      const response = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      
      const data = await response.json();
      
      if (response.status === 400) {
        validationErrors.value = data.validationErrors || [];
        return false;
      }
      
      if (data.success) {
        config.value = data.config;
        return true;
      } else {
        error.value = data.error;
        return false;
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update config';
      return false;
    }
  }

  async function resetConfig(): Promise<boolean> {
    try {
      error.value = null;
      
      const response = await fetch('/api/config/reset', {
        method: 'POST'
      });
      
      const data = await response.json();
      
      if (data.success) {
        config.value = data.config;
        return true;
      } else {
        error.value = data.error;
        return false;
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to reset config';
      return false;
    }
  }

  onMounted(() => {
    loadConfig();
  });

  return {
    config,
    loading,
    error,
    validationErrors,
    updateConfig,
    resetConfig,
    refresh: loadConfig
  };
}
```

---

## Обработка ошибок

### Типы ошибок

1. **Ошибки валидации (400)** - неверные данные
2. **Ошибки сервера (500)** - проблемы с сохранением/чтением конфига

### Пример обработки

```typescript
async function saveSettings(updates: Partial<AppConfig>) {
  try {
    const response = await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    
    const data = await response.json();
    
    // Ошибка валидации
    if (response.status === 400) {
      return {
        success: false,
        type: 'validation',
        errors: data.validationErrors || []
      };
    }
    
    // Ошибка сервера
    if (response.status === 500) {
      return {
        success: false,
        type: 'server',
        error: data.error || 'Internal server error'
      };
    }
    
    // Успех
    if (data.success) {
      return {
        success: true,
        config: data.config
      };
    }
    
    // Неизвестная ошибка
    return {
      success: false,
      type: 'unknown',
      error: data.error || 'Unknown error'
    };
    
  } catch (err) {
    // Сетевая ошибка
    return {
      success: false,
      type: 'network',
      error: err instanceof Error ? err.message : 'Network error'
    };
  }
}
```

---

## Валидация на клиенте

### Правила валидации

```typescript
interface ValidationRule {
  field: keyof AppConfig;
  validate: (value: any) => string | null; // null = valid, string = error
}

const validationRules: ValidationRule[] = [
  {
    field: 'KOSMOS_BASE_URL',
    validate: (value: string) => {
      try {
        new URL(value);
        return null;
      } catch {
        return 'Должен быть валидный URL (например: http://localhost:3002/v1)';
      }
    }
  },
  {
    field: 'LOG_LEVEL',
    validate: (value: string) => {
      const validLevels = ['debug', 'info', 'warn', 'error'];
      return validLevels.includes(value) 
        ? null 
        : `Должен быть один из: ${validLevels.join(', ')}`;
    }
  },
  {
    field: 'NATURAL_QUERY_SUGGEST_LIMIT',
    validate: (value: number) => {
      const num = Number(value);
      if (isNaN(num)) return 'Должно быть числом';
      if (num < 1 || num > 100) return 'Должно быть от 1 до 100';
      return null;
    }
  },
  {
    field: 'NATURAL_QUERY_SIMILARITY_THRESHOLD',
    validate: (value: number) => {
      const num = Number(value);
      if (isNaN(num)) return 'Должно быть числом';
      if (num < 0 || num > 1) return 'Должно быть от 0 до 1';
      return null;
    }
  },
  {
    field: 'NATURAL_QUERY_AUTO_USE_THRESHOLD',
    validate: (value: number) => {
      const num = Number(value);
      if (isNaN(num)) return 'Должно быть числом';
      if (num < 0 || num > 1) return 'Должно быть от 0 до 1';
      return null;
    }
  }
];

// Функция валидации формы
function validateForm(formData: Partial<AppConfig>): Record<string, string> {
  const errors: Record<string, string> = {};
  
  for (const rule of validationRules) {
    const value = formData[rule.field];
    if (value !== undefined) {
      const error = rule.validate(value);
      if (error) {
        errors[rule.field] = error;
      }
    }
  }
  
  return errors;
}
```

---

## UI/UX рекомендации

### 1. Индикация изменений
```typescript
// Показывать, что есть несохранённые изменения
const [hasChanges, setHasChanges] = useState(false);

// При изменении полей
const handleFieldChange = () => {
  setHasChanges(true);
};

// После сохранения
const handleSave = async () => {
  const success = await updateConfig(changes);
  if (success) {
    setHasChanges(false);
  }
};
```

### 2. Подтверждение опасных действий
```typescript
// Сброс к умолчаниям
const handleReset = async () => {
  const confirmed = window.confirm(
    '⚠️ Вы уверены?\n\n' +
    'Все настройки будут сброшены к значениям по умолчанию.\n' +
    'Это действие нельзя отменить.'
  );
  
  if (confirmed) {
    await resetConfig();
  }
};
```

### 3. Уведомления об успехе/ошибке
```typescript
// Toast/Snackbar уведомления
const showNotification = (type: 'success' | 'error', message: string) => {
  // Ваша реализация toast/snackbar
};

const handleSave = async () => {
  const success = await updateConfig(changes);
  
  if (success) {
    showNotification('success', '✅ Настройки успешно сохранены!');
  } else {
    showNotification('error', '❌ Не удалось сохранить настройки');
  }
};
```

### 4. Дебаунс при вводе
```typescript
import { debounce } from 'lodash';

// Автосохранение с задержкой
const debouncedSave = debounce(async (updates) => {
  await updateConfig(updates);
}, 1000);

const handleInputChange = (field: string, value: any) => {
  setFormData({ ...formData, [field]: value });
  debouncedSave({ [field]: value });
};
```

---

## Примеры компонентов

### Простая форма настроек (HTML + JS)

```html
<!DOCTYPE html>
<html>
<head>
  <title>Настройки</title>
  <style>
    .form-group { margin-bottom: 1rem; }
    .error-box { background: #fee; border: 1px solid #f00; padding: 1rem; margin-bottom: 1rem; }
    .success-box { background: #efe; border: 1px solid #0f0; padding: 1rem; margin-bottom: 1rem; }
    input, select { width: 100%; padding: 0.5rem; }
    button { padding: 0.5rem 1rem; margin-right: 0.5rem; }
  </style>
</head>
<body>
  <h1>Настройки приложения</h1>
  
  <div id="messages"></div>
  
  <form id="configForm">
    <div class="form-group">
      <label>Base URL:</label>
      <input type="url" name="KOSMOS_BASE_URL" required />
    </div>
    
    <div class="form-group">
      <label>Model:</label>
      <input type="text" name="KOSMOS_MODEL" required />
      <small>TODO: Согласовать список моделей с kosmos-model</small>
    </div>
    
    <div class="form-group">
      <label>Logic Architect Model:</label>
      <input type="text" name="KOSMOS_LOGIC_ARHITECT_MODEL" />
    </div>
    
    <div class="form-group">
      <label>Log Level:</label>
      <select name="LOG_LEVEL">
        <option value="debug">Debug</option>
        <option value="info">Info</option>
        <option value="warn">Warning</option>
        <option value="error">Error</option>
      </select>
    </div>
    
    <div class="form-group">
      <label>Natural Query Suggest Limit (1-100):</label>
      <input type="number" name="NATURAL_QUERY_SUGGEST_LIMIT" min="1" max="100" required />
    </div>
    
    <div class="form-group">
      <label>Similarity Threshold (0-1):</label>
      <input type="number" name="NATURAL_QUERY_SIMILARITY_THRESHOLD" min="0" max="1" step="0.01" required />
    </div>
    
    <div class="form-group">
      <label>Auto Use Threshold (0-1):</label>
      <input type="number" name="NATURAL_QUERY_AUTO_USE_THRESHOLD" min="0" max="1" step="0.01" required />
    </div>
    
    <button type="submit">Сохранить</button>
    <button type="button" id="resetBtn">Сбросить к умолчаниям</button>
  </form>
  
  <script>
    const form = document.getElementById('configForm');
    const messages = document.getElementById('messages');
    const resetBtn = document.getElementById('resetBtn');
    
    // Загрузить конфигурацию
    async function loadConfig() {
      try {
        const response = await fetch('/api/config');
        const data = await response.json();
        
        if (data.success) {
          // Заполнить форму
          Object.keys(data.config).forEach(key => {
            const input = form.elements[key];
            if (input) {
              input.value = data.config[key] ?? '';
            }
          });
        }
      } catch (err) {
        showMessage('error', 'Ошибка загрузки настроек: ' + err.message);
      }
    }
    
    // Показать сообщение
    function showMessage(type, text) {
      const className = type === 'success' ? 'success-box' : 'error-box';
      messages.innerHTML = `<div class="${className}">${text}</div>`;
      setTimeout(() => { messages.innerHTML = ''; }, 5000);
    }
    
    // Сохранить настройки
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const formData = new FormData(form);
      const updates = Object.fromEntries(formData);
      
      // Преобразовать числовые поля
      updates.NATURAL_QUERY_SUGGEST_LIMIT = Number(updates.NATURAL_QUERY_SUGGEST_LIMIT);
      updates.NATURAL_QUERY_SIMILARITY_THRESHOLD = Number(updates.NATURAL_QUERY_SIMILARITY_THRESHOLD);
      updates.NATURAL_QUERY_AUTO_USE_THRESHOLD = Number(updates.NATURAL_QUERY_AUTO_USE_THRESHOLD);
      
      try {
        const response = await fetch('/api/config', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
        });
        
        const data = await response.json();
        
        if (response.status === 400) {
          showMessage('error', 'Ошибки валидации:<br>' + data.validationErrors.join('<br>'));
        } else if (data.success) {
          showMessage('success', '✅ Настройки успешно сохранены!');
        } else {
          showMessage('error', '❌ ' + data.error);
        }
      } catch (err) {
        showMessage('error', 'Ошибка сохранения: ' + err.message);
      }
    });
    
    // Сбросить настройки
    resetBtn.addEventListener('click', async () => {
      if (!confirm('Сбросить все настройки к значениям по умолчанию?')) {
        return;
      }
      
      try {
        const response = await fetch('/api/config/reset', { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
          showMessage('success', '✅ Настройки сброшены к умолчаниям!');
          await loadConfig(); // Перезагрузить форму
        } else {
          showMessage('error', '❌ ' + data.error);
        }
      } catch (err) {
        showMessage('error', 'Ошибка сброса: ' + err.message);
      }
    });
    
    // Загрузить при открытии страницы
    loadConfig();
  </script>
</body>
</html>
```

---

## Связанные документы

- **Backend API:** `KB/README_APP_CONFIG_API.md`
- **OpenAPI Contract:** `docs/api-contract.yaml` (версия 2.8.0)
- **Schemas:** `docs/openapi/schemas/common.yaml`
- **Paths:** `docs/openapi/paths/system.yaml`

---

## Changelog

### v2.8.0 (текущая версия)
- ✅ Добавлен App Config API
- ✅ GET /api/config
- ✅ PATCH /api/config
- ✅ POST /api/config/reset
- ✅ Валидация: URL, LOG_LEVEL enum
- ✅ Не требует context-code
