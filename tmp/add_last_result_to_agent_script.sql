-- Миграция: добавление поля last_result для хранения последнего результата выполнения скрипта
-- Выполнить один раз в БД

-- Добавляем поле last_result (jsonb) в таблицу agent_script
ALTER TABLE kosmos.agent_script 
ADD COLUMN IF NOT EXISTS last_result jsonb DEFAULT NULL;

-- Добавляем комментарий к полю для документации
COMMENT ON COLUMN kosmos.agent_script.last_result IS 'Последний результат выполнения скрипта в формате JSON: { raw: [...], human: "...", executed_at: "..." }';

