// Хранилище истории выполнения шагов pipeline
// routes/pipelineHistory.js

const fs = require('fs');
const path = require('path');

class PipelineHistoryManager {
  constructor() {
    // Путь к файлу истории
    this.historyFilePath = path.join(process.cwd(), 'data', 'pipeline_history.json');
    this.historyData = null;
    
    // Загружаем историю при инициализации
    this.loadHistory();
  }

  // Загрузить историю из файла
  loadHistory() {
    try {
      const historyDir = path.dirname(this.historyFilePath);
      if (!fs.existsSync(historyDir)) {
        fs.mkdirSync(historyDir, { recursive: true });
      }
      
      if (fs.existsSync(this.historyFilePath)) {
        const fileContent = fs.readFileSync(this.historyFilePath, 'utf8');
        this.historyData = JSON.parse(fileContent);
      } else {
        this.historyData = {};
        this.saveHistory();
      }
    } catch (err) {
      console.error('[PipelineHistory] Ошибка загрузки истории:', err.message);
      this.historyData = {};
    }
  }

  // Сохранить историю в файл
  saveHistory() {
    try {
      const historyDir = path.dirname(this.historyFilePath);
      if (!fs.existsSync(historyDir)) {
        fs.mkdirSync(historyDir, { recursive: true });
      }
      
      fs.writeFileSync(
        this.historyFilePath,
        JSON.stringify(this.historyData, null, 2),
        'utf8'
      );
    } catch (err) {
      console.error('[PipelineHistory] Ошибка сохранения истории:', err.message);
    }
  }

  // Добавить запись в историю
  addHistoryEntry(contextCode, stepId, stepData) {
    if (!contextCode) {
      return; // Не сохраняем историю без contextCode
    }

    if (!this.historyData[contextCode]) {
      this.historyData[contextCode] = {};
    }
    
    if (!this.historyData[contextCode][stepId]) {
      this.historyData[contextCode][stepId] = [];
    }
    
    const historyEntry = {
      timestamp: new Date().toISOString(),
      status: stepData.status || null,
      progress: stepData.progress !== undefined ? stepData.progress : null,
      itemsProcessed: stepData.itemsProcessed !== undefined ? stepData.itemsProcessed : null,
      totalItems: stepData.totalItems !== undefined ? stepData.totalItems : null,
      error: stepData.error || null,
      report: stepData.report || null
    };
    
    this.historyData[contextCode][stepId].push(historyEntry);
    
    // Ограничиваем количество записей (максимум 1000 на шаг)
    const maxEntries = 1000;
    if (this.historyData[contextCode][stepId].length > maxEntries) {
      this.historyData[contextCode][stepId] = 
        this.historyData[contextCode][stepId].slice(-maxEntries);
    }
    
    this.saveHistory();
  }

  // Получить историю шага
  getStepHistory(contextCode, stepId, limit = 100) {
    if (!contextCode || !this.historyData[contextCode] || !this.historyData[contextCode][stepId]) {
      return [];
    }
    
    const history = this.historyData[contextCode][stepId];
    // Возвращаем последние N записей (от старых к новым)
    return history.slice(-limit);
  }

  // Получить историю всех шагов
  getAllStepsHistory(contextCode, limit = 100, stepIdFilter = null) {
    if (!contextCode || !this.historyData[contextCode]) {
      return [];
    }
    
    const result = [];
    
    if (stepIdFilter) {
      // История конкретного шага
      const stepId = parseInt(stepIdFilter);
      if (stepId >= 1 && stepId <= 7) {
        const history = this.getStepHistory(contextCode, stepId, limit);
        result.push({
          stepId: stepId,
          stepName: `step_${stepId}`, // Будет заменено на реальное имя в маршруте
          history: history
        });
      }
    } else {
      // История всех шагов
      const stepIds = Object.keys(this.historyData[contextCode]);
      for (const stepIdStr of stepIds) {
        const stepId = parseInt(stepIdStr);
        // Проверяем, что это валидный ID шага (1-7)
        if (stepId >= 1 && stepId <= 7) {
          const history = this.getStepHistory(contextCode, stepId, limit);
          if (history.length > 0) {
            result.push({
              stepId: stepId,
              stepName: `step_${stepId}`, // Будет заменено на реальное имя в маршруте
              history: history
            });
          }
        }
      }
    }
    
    return result;
  }
}

// Создаем singleton экземпляр
const pipelineHistoryManager = new PipelineHistoryManager();

module.exports = pipelineHistoryManager;

