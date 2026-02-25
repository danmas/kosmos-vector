-- Миграция: добавление новых типов связей для колонок таблиц
-- Выполнить после создания таблицы link_type

INSERT INTO link_type (code, label, description) VALUES
  ('reads_column', 'reads_column', 'Function reads column in SELECT'),
  ('updates_column', 'updates_column', 'Function updates column in SET'),
  ('inserts_column', 'inserts_column', 'Function inserts into column')
ON CONFLICT (code) DO NOTHING;
