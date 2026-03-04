-- Миграция: добавление таблицы для хранения истории изменений prompts.json
-- Версия: 2.9.0
-- Дата: 2026-02-08

-- Таблица для хранения истории конфигурации промптов
CREATE TABLE IF NOT EXISTS prompt_config_history (
  id SERIAL PRIMARY KEY,
  config_snapshot JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version INTEGER NOT NULL,
  comment TEXT NULL,
  CONSTRAINT unique_version UNIQUE (version)
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_prompt_config_history_created_at ON prompt_config_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_config_history_version ON prompt_config_history(version DESC);

-- Комментарии к таблице и колонкам
COMMENT ON TABLE prompt_config_history IS 'История изменений конфигурации промптов (prompts.json)';
COMMENT ON COLUMN prompt_config_history.id IS 'Уникальный идентификатор записи истории';
COMMENT ON COLUMN prompt_config_history.config_snapshot IS 'Полный snapshot конфигурации промптов в формате JSON';
COMMENT ON COLUMN prompt_config_history.created_at IS 'Дата и время создания записи';
COMMENT ON COLUMN prompt_config_history.version IS 'Номер версии конфигурации (автоинкремент)';
COMMENT ON COLUMN prompt_config_history.comment IS 'Опциональный комментарий к изменению';

-- Функция для автоматического удаления старых версий (оставляем последние 100)
CREATE OR REPLACE FUNCTION cleanup_old_prompt_config_history()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM prompt_config_history
  WHERE id IN (
    SELECT id FROM prompt_config_history
    ORDER BY version DESC
    OFFSET 100
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер для автоматической очистки
DROP TRIGGER IF EXISTS trigger_cleanup_prompt_config_history ON prompt_config_history;
CREATE TRIGGER trigger_cleanup_prompt_config_history
  AFTER INSERT ON prompt_config_history
  FOR EACH STATEMENT
  EXECUTE FUNCTION cleanup_old_prompt_config_history();

-- Вставляем начальную версию (если prompts.json существует, её нужно будет загрузить через API)
-- Это просто placeholder для версии 0
INSERT INTO prompt_config_history (config_snapshot, version, comment)
VALUES (
  '{"l1l2Templates":{},"rag":{},"naturalQuery":{},"vectorOperations":{}}'::jsonb,
  0,
  'Initial placeholder version'
)
ON CONFLICT (version) DO NOTHING;

COMMENT ON FUNCTION cleanup_old_prompt_config_history IS 'Автоматически удаляет старые версии истории, оставляя последние 100';
