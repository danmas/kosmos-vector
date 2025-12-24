/**
 * Тестовый JavaScript файл для демонстрации работы функции разбиения на чанки
 * 
 * Этот файл содержит примеры всех типов JavaScript объектов, которые распознаются 
 * функцией splitJsByObjects:
 * - import
 * - export_named
 * - export_default
 * - comment
 * - function
 * - arrow_function
 * - class
 * - interface
 * - variable
 */

// Импорты (тип: import)
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { formatDate, capitalize } from './utils';

// Комментарий в начале файла (тип: comment)
/**
 * Этот модуль предоставляет набор функций и классов для работы с данными.
 * Он демонстрирует различные типы объектов JavaScript, которые могут быть 
 * обнаружены при векторизации файла.
 * 
 * @module TestModule
 * @author Test Author
 * @version 1.0.0
 */

// Переменные (тип: variable)
const API_URL = 'https://api.example.com';
let counter = 0;
var legacyOption = true;

// Обычная функция (тип: function)
function fetchData(endpoint, params) {
  const url = `${API_URL}/${endpoint}`;
  
  return axios.get(url, { params })
    .then(response => {
      console.log('Данные получены:', response.data);
      return response.data;
    })
    .catch(error => {
      console.error('Ошибка при получении данных:', error);
      throw error;
    });
}

// Асинхронная функция (тип: function)
async function processItems(items) {
  let results = [];
  
  for (const item of items) {
    try {
      const processedItem = await processItem(item);
      results.push(processedItem);
    } catch (error) {
      console.error(`Ошибка при обработке элемента ${item.id}:`, error);
    }
  }
  
  return results;
}

// Стрелочная функция (тип: arrow_function)
const processItem = async (item) => {
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return {
    ...item,
    processed: true,
    processedAt: new Date()
  };
};

// Стрелочная функция без async (тип: arrow_function)
const formatItem = (item) => {
  const { id, name, createdAt } = item;
  
  return {
    id,
    displayName: capitalize(name),
    formattedDate: formatDate(createdAt)
  };
};

// Класс (тип: class)
class DataProcessor {
  constructor(options) {
    this.options = options;
    this.cache = new Map();
  }
  
  process(data) {
    if (this.cache.has(data.id)) {
      return this.cache.get(data.id);
    }
    
    const result = this._processInternal(data);
    this.cache.set(data.id, result);
    
    return result;
  }
  
  _processInternal(data) {
    // Внутренняя логика обработки
    return {
      ...data,
      processed: true
    };
  }
  
  static createDefault() {
    return new DataProcessor({ useCache: true });
  }
}

// Интерфейс TypeScript (тип: interface)
interface ProcessorOptions {
  useCache: boolean;
  timeout?: number;
  retryCount?: number;
}

// Экспорт по умолчанию (тип: export_default)
export default DataProcessor;

// Именованный экспорт (тип: export_named)
export {
  fetchData,
  processItems,
  processItem,
  formatItem,
  API_URL,
  counter
}; 