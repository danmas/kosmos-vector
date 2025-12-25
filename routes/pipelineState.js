// Хранилище состояния шагов pipeline
// routes/pipelineState.js

class PipelineStateManager {
  constructor() {
    // Инициализация шагов согласно контракту
    this.steps = [
      {
        id: 1,
        name: 'parsing',
        label: 'Polyglot Parsing (L0)',
        status: 'pending',
        progress: 0,
        itemsProcessed: 0,
        totalItems: 0,
        startedAt: null,
        completedAt: null,
        error: null,
        report: null,
        sessionId: null
      },
      {
        id: 2,
        name: 'dependencies',
        label: 'Dependencies Extraction (L1)',
        status: 'pending',
        progress: 0,
        itemsProcessed: 0,
        totalItems: 0,
        startedAt: null,
        completedAt: null,
        error: null,
        report: null,
        sessionId: null
      },
      {
        id: 3,
        name: 'enrichment',
        label: 'Enrichment (L2)',
        status: 'pending',
        progress: 0,
        itemsProcessed: 0,
        totalItems: 0,
        startedAt: null,
        completedAt: null,
        error: null,
        report: null
      },
      {
        id: 4,
        name: 'vectorization',
        label: 'Vectorization',
        status: 'pending',
        progress: 0,
        itemsProcessed: 0,
        totalItems: 0,
        startedAt: null,
        completedAt: null,
        error: null,
        report: null
      },
      {
        id: 5,
        name: 'indexing',
        label: 'Indexing',
        status: 'pending',
        progress: 0,
        itemsProcessed: 0,
        totalItems: 0,
        startedAt: null,
        completedAt: null,
        error: null,
        report: null
      }
    ];
  }

  // Получить состояние всех шагов
  getStepsStatus() {
    return this.steps.map(step => ({ ...step }));
  }

  // Обновить состояние шага
  updateStep(stepId, updates) {
    const step = this.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Step with id ${stepId} not found`);
    }

    // Валидация статуса
    if (updates.status && !['pending', 'running', 'completed', 'failed'].includes(updates.status)) {
      throw new Error(`Invalid status: ${updates.status}`);
    }

    // Обновление полей
    Object.assign(step, updates);

    // Автоматическое управление временными метками
    if (updates.status === 'running' && !step.startedAt) {
      step.startedAt = new Date().toISOString();
    }

    if (updates.status === 'completed' || updates.status === 'failed') {
      if (!step.completedAt) {
        step.completedAt = new Date().toISOString();
      }
    }

    // Вычисление прогресса на основе itemsProcessed и totalItems
    if (updates.itemsProcessed !== undefined || updates.totalItems !== undefined) {
      if (step.totalItems > 0) {
        step.progress = Math.min(100, Math.round((step.itemsProcessed / step.totalItems) * 100));
      } else {
        step.progress = 0;
      }
    }

    return { ...step };
  }

  // Сброс всех шагов в начальное состояние
  reset() {
    this.steps.forEach(step => {
      step.status = 'pending';
      step.progress = 0;
      step.itemsProcessed = 0;
      step.totalItems = 0;
      step.startedAt = null;
      step.completedAt = null;
      step.error = null;
      step.report = null;
      step.sessionId = null;
    });
  }

  // Получить конкретный шаг
  getStep(stepId) {
    const step = this.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Step with id ${stepId} not found`);
    }
    return { ...step };
  }

  // Алиас для getStep (для совместимости)
  getStepStatus(stepId) {
    return this.getStep(stepId);
  }

  // Увеличить счетчик обработанных элементов
  incrementItemsProcessed(stepId, count = 1) {
    const step = this.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Step with id ${stepId} not found`);
    }
    step.itemsProcessed = (step.itemsProcessed || 0) + count;
    // Автоматически пересчитываем прогресс
    if (step.totalItems > 0) {
      step.progress = Math.min(100, Math.round((step.itemsProcessed / step.totalItems) * 100));
    }
    return step.itemsProcessed;
  }
}

// Создаем singleton экземпляр
const pipelineStateManager = new PipelineStateManager();

module.exports = pipelineStateManager;

