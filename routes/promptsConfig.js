// routes/promptsConfig.js
// Маршруты для управления конфигурацией промптов с историей

const express = require('express');
const router = express.Router();
const promptsConfigService = require('../packages/core/promptsConfigService');

module.exports = (dbService) => {
  // GET /api/prompts-config - получить текущую конфигурацию промптов
  router.get('/prompts-config', (req, res) => {
    try {
      const config = promptsConfigService.getPromptsConfig();
      res.json({
        success: true,
        config: config
      });
    } catch (error) {
      console.error('[API/PROMPTS-CONFIG] Ошибка получения конфига промптов:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get prompts configuration'
      });
    }
  });

  // PATCH /api/prompts-config - обновить конфигурацию промптов с сохранением в историю
  router.patch('/prompts-config', async (req, res) => {
    try {
      const { updates, comment } = req.body;
      
      if (!updates || Object.keys(updates).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Request body must contain "updates" field with configuration updates'
        });
      }

      const result = await promptsConfigService.updatePromptsConfig(
        dbService.pgClient,
        updates,
        comment || null
      );
      
      res.json({
        success: true,
        config: result.config,
        historyEntry: result.historyEntry,
        message: 'Prompts configuration updated successfully'
      });
    } catch (error) {
      console.error('[API/PROMPTS-CONFIG] Ошибка обновления конфига промптов:', error);
      
      // Если ошибка валидации - возвращаем 400 с деталями
      if (error.validationErrors) {
        return res.status(400).json({
          success: false,
          error: error.message,
          validationErrors: error.validationErrors
        });
      }
      
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to update prompts configuration'
      });
    }
  });

  // GET /api/prompts-config/history - получить список истории изменений
  router.get('/prompts-config/history', async (req, res) => {
    try {
      const { limit = 50, offset = 0 } = req.query;
      
      const history = await promptsConfigService.getPromptsConfigHistory(
        dbService.pgClient,
        parseInt(limit),
        parseInt(offset)
      );
      
      res.json({
        success: true,
        history: history,
        count: history.length
      });
    } catch (error) {
      console.error('[API/PROMPTS-CONFIG] Ошибка получения истории:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get prompts configuration history'
      });
    }
  });

  // GET /api/prompts-config/history/:id - получить конкретную версию из истории
  router.get('/prompts-config/history/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      const historyEntry = await promptsConfigService.getPromptsConfigHistoryById(
        dbService.pgClient,
        parseInt(id)
      );
      
      if (!historyEntry) {
        return res.status(404).json({
          success: false,
          error: `History entry with id ${id} not found`
        });
      }
      
      res.json({
        success: true,
        historyEntry: historyEntry
      });
    } catch (error) {
      console.error('[API/PROMPTS-CONFIG] Ошибка получения версии из истории:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get history entry'
      });
    }
  });

  // POST /api/prompts-config/restore/:id - восстановить конфигурацию из истории
  router.post('/prompts-config/restore/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { comment } = req.body;
      
      const result = await promptsConfigService.restorePromptsConfigFromHistory(
        dbService.pgClient,
        parseInt(id),
        comment || null
      );
      
      res.json({
        success: true,
        config: result.config,
        historyEntry: result.historyEntry,
        message: `Configuration restored from version ${id}`
      });
    } catch (error) {
      console.error('[API/PROMPTS-CONFIG] Ошибка восстановления из истории:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to restore configuration from history'
      });
    }
  });

  // POST /api/prompts-config/reset - сбросить конфигурацию к дефолтным значениям
  router.post('/prompts-config/reset', async (req, res) => {
    try {
      const { comment } = req.body;
      
      const result = await promptsConfigService.resetPromptsConfig(
        dbService.pgClient,
        comment || null
      );
      
      res.json({
        success: true,
        config: result.config,
        historyEntry: result.historyEntry,
        message: 'Prompts configuration reset to defaults'
      });
    } catch (error) {
      console.error('[API/PROMPTS-CONFIG] Ошибка сброса конфига промптов:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to reset prompts configuration'
      });
    }
  });

  // DELETE /api/prompts-config/history/:id - удалить запись из истории
  router.delete('/prompts-config/history/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      const deleted = await promptsConfigService.deletePromptsConfigHistoryEntry(
        dbService.pgClient,
        parseInt(id)
      );
      
      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: `History entry with id ${id} not found`
        });
      }
      
      res.json({
        success: true,
        message: `History entry ${id} deleted successfully`
      });
    } catch (error) {
      console.error('[API/PROMPTS-CONFIG] Ошибка удаления записи истории:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to delete history entry'
      });
    }
  });

  return router;
};
