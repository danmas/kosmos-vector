// routes/graphSnapshots.js
// Роутер для управления снимками графа (Graph Snapshots API)
const express = require('express');

const router = express.Router();

/**
 * Генерация уникального ID снимка
 * Формат: snap_{timestamp}_{random}
 */
function generateSnapshotId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `snap_${timestamp}_${random}`;
}

module.exports = (dbService) => {
  // Middleware для валидации context-code
  const validateContextCode = (req, res, next) => {
    const contextCode = req.query['context-code'] || req.query.contextCode;

    if (!contextCode) {
      return res.status(400).json({
        success: false,
        error: 'Missing required query parameter: context-code'
      });
    }

    req.contextCode = contextCode;
    next();
  };

  // Применяем middleware ко всем маршрутам
  router.use(validateContextCode);

  // =====================================================
  // GET /api/graph-snapshots - Получить список всех снимков
  // =====================================================
  router.get('/', async (req, res) => {
    try {
      const contextCode = req.contextCode;

      const result = await dbService.pgClient.query(`
        SELECT 
          id,
          context_code,
          name,
          created_at,
          data
        FROM kosmos.graph_snapshot
        WHERE context_code = $1
        ORDER BY created_at DESC
      `, [contextCode]);

      const snapshots = result.rows.map(row => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        contextCode: row.context_code,
        nodeIds: row.data.nodeIds || [],
        selectedNodeIds: row.data.selectedNodeIds || [],
        focusedNodeIds: row.data.focusedNodeIds || [],
        hiddenLinkTypes: row.data.hiddenLinkTypes || [],
        nodeCount: row.data.nodeCount || 0,
        linkCount: row.data.linkCount || 0,
        previewNodeNames: row.data.previewNodeNames || []
      }));

      console.log(`[API/GRAPH-SNAPSHOTS] GET список: ${snapshots.length} снимков для context="${contextCode}"`);

      res.json({
        success: true,
        snapshots
      });
    } catch (error) {
      console.error('[API/GRAPH-SNAPSHOTS] GET Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // =====================================================
  // POST /api/graph-snapshots - Создать новый снимок
  // =====================================================
  router.post('/', async (req, res) => {
    try {
      const contextCode = req.contextCode;
      const {
        name,
        nodeIds,
        selectedNodeIds = [],
        focusedNodeIds = [],
        hiddenLinkTypes = [],
        linkCount = 0,
        previewNodeNames = []
      } = req.body;

      // Валидация обязательных полей
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Field "name" is required and must be a non-empty string'
        });
      }

      if (name.length > 200) {
        return res.status(400).json({
          success: false,
          error: 'Field "name" must not exceed 200 characters'
        });
      }

      if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Field "nodeIds" is required and must be a non-empty array'
        });
      }

      // Генерируем ID
      const snapshotId = generateSnapshotId();

      // Формируем данные для JSONB
      const data = {
        nodeIds,
        selectedNodeIds,
        focusedNodeIds,
        hiddenLinkTypes,
        nodeCount: nodeIds.length,
        linkCount,
        previewNodeNames
      };

      // Сохраняем в БД
      const result = await dbService.pgClient.query(`
        INSERT INTO kosmos.graph_snapshot (id, context_code, name, data)
        VALUES ($1, $2, $3, $4)
        RETURNING id, context_code, name, created_at, data
      `, [snapshotId, contextCode, name.trim(), JSON.stringify(data)]);

      const row = result.rows[0];
      const snapshot = {
        id: row.id,
        name: row.name,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        contextCode: row.context_code,
        nodeIds: row.data.nodeIds || [],
        selectedNodeIds: row.data.selectedNodeIds || [],
        focusedNodeIds: row.data.focusedNodeIds || [],
        hiddenLinkTypes: row.data.hiddenLinkTypes || [],
        nodeCount: row.data.nodeCount || 0,
        linkCount: row.data.linkCount || 0,
        previewNodeNames: row.data.previewNodeNames || []
      };

      console.log(`[API/GRAPH-SNAPSHOTS] POST создан: id="${snapshotId}", name="${name}", nodeCount=${data.nodeCount}`);

      res.status(201).json({
        success: true,
        snapshot
      });
    } catch (error) {
      console.error('[API/GRAPH-SNAPSHOTS] POST Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // =====================================================
  // GET /api/graph-snapshots/export - Экспорт всех снимков
  // =====================================================
  router.get('/export', async (req, res) => {
    try {
      const contextCode = req.contextCode;

      const result = await dbService.pgClient.query(`
        SELECT 
          id,
          context_code,
          name,
          created_at,
          data
        FROM kosmos.graph_snapshot
        WHERE context_code = $1
        ORDER BY created_at DESC
      `, [contextCode]);

      const snapshots = result.rows.map(row => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        contextCode: row.context_code,
        nodeIds: row.data.nodeIds || [],
        selectedNodeIds: row.data.selectedNodeIds || [],
        focusedNodeIds: row.data.focusedNodeIds || [],
        hiddenLinkTypes: row.data.hiddenLinkTypes || [],
        nodeCount: row.data.nodeCount || 0,
        linkCount: row.data.linkCount || 0,
        previewNodeNames: row.data.previewNodeNames || []
      }));

      console.log(`[API/GRAPH-SNAPSHOTS/EXPORT] Экспорт: ${snapshots.length} снимков для context="${contextCode}"`);

      res.json({
        success: true,
        version: 1,
        snapshots,
        exportedAt: new Date().toISOString(),
        contextCode
      });
    } catch (error) {
      console.error('[API/GRAPH-SNAPSHOTS/EXPORT] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // =====================================================
  // POST /api/graph-snapshots/import - Импорт снимков
  // =====================================================
  router.post('/import', async (req, res) => {
    try {
      const contextCode = req.contextCode;
      const { version, snapshots } = req.body;

      // Валидация
      if (version !== 1) {
        return res.status(400).json({
          success: false,
          error: 'Unsupported import version. Expected version: 1'
        });
      }

      if (!snapshots || !Array.isArray(snapshots) || snapshots.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Field "snapshots" is required and must be a non-empty array'
        });
      }

      let imported = 0;
      let skipped = 0;
      const total = snapshots.length;

      for (const snapshot of snapshots) {
        // Проверяем наличие обязательных полей
        if (!snapshot.id || !snapshot.name || !snapshot.nodeIds) {
          skipped++;
          continue;
        }

        // Проверяем, существует ли снимок с таким ID
        const existsResult = await dbService.pgClient.query(`
          SELECT id FROM kosmos.graph_snapshot WHERE id = $1
        `, [snapshot.id]);

        if (existsResult.rows.length > 0) {
          // Дубликат - пропускаем
          skipped++;
          continue;
        }

        // Формируем данные для JSONB
        const data = {
          nodeIds: snapshot.nodeIds || [],
          selectedNodeIds: snapshot.selectedNodeIds || [],
          focusedNodeIds: snapshot.focusedNodeIds || [],
          hiddenLinkTypes: snapshot.hiddenLinkTypes || [],
          nodeCount: snapshot.nodeCount || (snapshot.nodeIds ? snapshot.nodeIds.length : 0),
          linkCount: snapshot.linkCount || 0,
          previewNodeNames: snapshot.previewNodeNames || []
        };

        // Вставляем снимок с привязкой к текущему контексту
        await dbService.pgClient.query(`
          INSERT INTO kosmos.graph_snapshot (id, context_code, name, created_at, data)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          snapshot.id,
          contextCode, // Привязываем к текущему контексту
          snapshot.name,
          snapshot.createdAt || new Date().toISOString(),
          JSON.stringify(data)
        ]);

        imported++;
      }

      console.log(`[API/GRAPH-SNAPSHOTS/IMPORT] Импорт: ${imported} импортировано, ${skipped} пропущено из ${total}`);

      res.json({
        success: true,
        imported,
        skipped,
        total,
        message: `Импортировано ${imported} снимков, пропущено ${skipped} дубликатов`
      });
    } catch (error) {
      console.error('[API/GRAPH-SNAPSHOTS/IMPORT] Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // =====================================================
  // GET /api/graph-snapshots/:snapshotId - Получить снимок по ID
  // =====================================================
  router.get('/:snapshotId', async (req, res) => {
    try {
      const contextCode = req.contextCode;
      const { snapshotId } = req.params;

      const result = await dbService.pgClient.query(`
        SELECT 
          id,
          context_code,
          name,
          created_at,
          data
        FROM kosmos.graph_snapshot
        WHERE id = $1 AND context_code = $2
      `, [snapshotId, contextCode]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: `Snapshot not found: ${snapshotId}`
        });
      }

      const row = result.rows[0];
      const snapshot = {
        id: row.id,
        name: row.name,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        contextCode: row.context_code,
        nodeIds: row.data.nodeIds || [],
        selectedNodeIds: row.data.selectedNodeIds || [],
        focusedNodeIds: row.data.focusedNodeIds || [],
        hiddenLinkTypes: row.data.hiddenLinkTypes || [],
        nodeCount: row.data.nodeCount || 0,
        linkCount: row.data.linkCount || 0,
        previewNodeNames: row.data.previewNodeNames || []
      };

      console.log(`[API/GRAPH-SNAPSHOTS] GET by ID: "${snapshotId}"`);

      res.json({
        success: true,
        snapshot
      });
    } catch (error) {
      console.error('[API/GRAPH-SNAPSHOTS] GET by ID Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // =====================================================
  // PATCH /api/graph-snapshots/:snapshotId - Обновить название снимка
  // =====================================================
  router.patch('/:snapshotId', async (req, res) => {
    try {
      const contextCode = req.contextCode;
      const { snapshotId } = req.params;
      const { name } = req.body;

      // Валидация
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Field "name" is required and must be a non-empty string'
        });
      }

      if (name.length > 200) {
        return res.status(400).json({
          success: false,
          error: 'Field "name" must not exceed 200 characters'
        });
      }

      const result = await dbService.pgClient.query(`
        UPDATE kosmos.graph_snapshot
        SET name = $1
        WHERE id = $2 AND context_code = $3
        RETURNING id, context_code, name, created_at, data
      `, [name.trim(), snapshotId, contextCode]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: `Snapshot not found: ${snapshotId}`
        });
      }

      const row = result.rows[0];
      const snapshot = {
        id: row.id,
        name: row.name,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        contextCode: row.context_code,
        nodeIds: row.data.nodeIds || [],
        selectedNodeIds: row.data.selectedNodeIds || [],
        focusedNodeIds: row.data.focusedNodeIds || [],
        hiddenLinkTypes: row.data.hiddenLinkTypes || [],
        nodeCount: row.data.nodeCount || 0,
        linkCount: row.data.linkCount || 0,
        previewNodeNames: row.data.previewNodeNames || []
      };

      console.log(`[API/GRAPH-SNAPSHOTS] PATCH: "${snapshotId}" -> name="${name}"`);

      res.json({
        success: true,
        snapshot
      });
    } catch (error) {
      console.error('[API/GRAPH-SNAPSHOTS] PATCH Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // =====================================================
  // DELETE /api/graph-snapshots/:snapshotId - Удалить снимок
  // =====================================================
  router.delete('/:snapshotId', async (req, res) => {
    try {
      const contextCode = req.contextCode;
      const { snapshotId } = req.params;

      const result = await dbService.pgClient.query(`
        DELETE FROM kosmos.graph_snapshot
        WHERE id = $1 AND context_code = $2
        RETURNING id
      `, [snapshotId, contextCode]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: `Snapshot not found: ${snapshotId}`
        });
      }

      console.log(`[API/GRAPH-SNAPSHOTS] DELETE: "${snapshotId}"`);

      res.json({
        success: true,
        message: 'Снимок успешно удалён'
      });
    } catch (error) {
      console.error('[API/GRAPH-SNAPSHOTS] DELETE Ошибка:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
};
