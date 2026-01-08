// routes/prompts.js
// Роутер для управления промптами LLM
const express = require('express');
const promptsService = require('../packages/core/promptsService');

const router = express.Router();

/**
 * GET /api/prompts
 * Получить все промпты
 */
router.get('/', async (req, res) => {
  try {
    const prompts = promptsService.getAllPrompts();
    res.json({
      success: true,
      prompts: prompts,
      savedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('[PROMPTS] Ошибка получения промптов:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера'
    });
  }
});

/**
 * PUT /api/prompts
 * Обновить все промпты
 */
router.put('/', async (req, res) => {
  try {
    const newPrompts = req.body;
    
    if (!newPrompts || typeof newPrompts !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Невалидная структура промптов'
      });
    }

    const savedPrompts = await promptsService.updateAllPrompts(newPrompts);
    
    res.json({
      success: true,
      prompts: savedPrompts,
      savedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('[PROMPTS] Ошибка обновления промптов:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Ошибка обновления промптов'
    });
  }
});

/**
 * GET /api/prompts/{category}
 * Получить категорию промптов
 */
router.get('/:category', async (req, res) => {
  try {
    const { category } = req.params;

    if (category === 'naturalQuery') {
      const prompts = promptsService.getNaturalQueryPrompts();
      return res.json({
        success: true,
        category: 'naturalQuery',
        data: prompts
      });
    }

    // Для других категорий пока возвращаем ошибку (будут реализованы позже)
    res.status(404).json({
      success: false,
      error: `Категория "${category}" не найдена или не реализована`
    });
  } catch (error) {
    console.error(`[PROMPTS] Ошибка получения категории ${req.params.category}:`, error);
    res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера'
    });
  }
});

/**
 * PATCH /api/prompts/{category}
 * Частично обновить категорию промптов
 */
router.patch('/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const updates = req.body;

    if (category === 'naturalQuery') {
      if (!updates || typeof updates !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'Невалидные данные для обновления'
        });
      }

      // Проверяем, что обновляются только допустимые поля
      const allowedFields = ['scriptGeneration', 'humanize'];
      const updateKeys = Object.keys(updates);
      const invalidKeys = updateKeys.filter(key => !allowedFields.includes(key));
      
      if (invalidKeys.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Недопустимые поля: ${invalidKeys.join(', ')}. Разрешены: ${allowedFields.join(', ')}`
        });
      }

      const updatedPrompts = await promptsService.updateNaturalQueryPrompts(updates);
      
      return res.json({
        success: true,
        category: 'naturalQuery',
        data: updatedPrompts
      });
    }

    // Для других категорий пока возвращаем ошибку
    res.status(404).json({
      success: false,
      error: `Категория "${category}" не найдена или не реализована`
    });
  } catch (error) {
    console.error(`[PROMPTS] Ошибка обновления категории ${req.params.category}:`, error);
    res.status(400).json({
      success: false,
      error: error.message || 'Ошибка обновления промптов'
    });
  }
});

/**
 * POST /api/prompts/reload
 * Перезагрузить промпты из файла
 */
router.post('/reload', async (req, res) => {
  try {
    promptsService.clearCache();
    const prompts = promptsService.getAllPrompts();
    
    res.json({
      success: true,
      message: 'Prompts reloaded from prompts.json',
      prompts: prompts
    });
  } catch (error) {
    console.error('[PROMPTS] Ошибка перезагрузки промптов:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера'
    });
  }
});

/**
 * POST /api/prompts/validate
 * Валидировать структуру промптов
 */
router.post('/validate', async (req, res) => {
  try {
    const prompts = req.body;
    
    const errors = [];
    
    // Проверка обязательных полей
    if (!prompts.naturalQuery) {
      errors.push({ path: 'naturalQuery', message: 'Required field is missing' });
    } else {
      if (!prompts.naturalQuery.scriptGeneration) {
        errors.push({ path: 'naturalQuery.scriptGeneration', message: 'Required field is missing' });
      }
      if (!prompts.naturalQuery.humanize) {
        errors.push({ path: 'naturalQuery.humanize', message: 'Required field is missing' });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        valid: false,
        errors: errors
      });
    }

    res.json({
      success: true,
      valid: true,
      message: 'Prompts structure is valid'
    });
  } catch (error) {
    console.error('[PROMPTS] Ошибка валидации:', error);
    res.status(400).json({
      success: false,
      valid: false,
      errors: [{ path: 'root', message: error.message }]
    });
  }
});

/**
 * GET /api/prompts/export
 * Экспортировать промпты
 */
router.get('/export', async (req, res) => {
  try {
    const { format = 'json' } = req.query;
    const prompts = promptsService.getAllPrompts();

    if (format === 'yaml') {
      // Для YAML нужна библиотека js-yaml, но пока возвращаем JSON
      res.setHeader('Content-Type', 'application/x-yaml');
      res.setHeader('Content-Disposition', 'attachment; filename="prompts.yaml"');
      // TODO: конвертация в YAML
      return res.json(prompts);
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="prompts.json"');
    res.json(prompts);
  } catch (error) {
    console.error('[PROMPTS] Ошибка экспорта:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера'
    });
  }
});

/**
 * POST /api/prompts/import
 * Импортировать промпты
 */
router.post('/import', async (req, res) => {
  try {
    const newPrompts = req.body;
    
    if (!newPrompts || typeof newPrompts !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Невалидная структура промптов'
      });
    }

    const savedPrompts = await promptsService.updateAllPrompts(newPrompts);
    
    res.json({
      success: true,
      prompts: savedPrompts,
      savedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('[PROMPTS] Ошибка импорта:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Ошибка импорта промптов'
    });
  }
});

module.exports = router;
