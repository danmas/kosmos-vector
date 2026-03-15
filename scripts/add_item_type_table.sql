-- Миграция: таблица item_type для справочника типов AI Items
-- Выполнить вручную: psql -d your_db -f scripts/add_item_type_table.sql

-- Таблица справочника типов (аналогично tag)
CREATE TABLE IF NOT EXISTS kosmos.item_type (
  id SERIAL PRIMARY KEY,
  context_code TEXT NOT NULL DEFAULT 'DEFAULT',
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT item_type_context_code_unique UNIQUE (context_code, code)
);

COMMENT ON TABLE kosmos.item_type IS 'Справочник типов AI Items (function, class, table и т.д.)';
COMMENT ON COLUMN kosmos.item_type.is_system IS 'true = системный тип из seed, удаление запрещено';

CREATE INDEX IF NOT EXISTS idx_item_type_context_code ON kosmos.item_type (context_code);
