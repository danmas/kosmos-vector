-- Инкрементальное обновление Pipeline: миграция схемы
-- =================================================

-- 0. Дедупликация (если есть дубли по filename+context_code, оставить по одной записи)
-- Выполнить вручную при необходимости перед миграцией на production:
-- DELETE FROM public.files a USING public.files b
--   WHERE a.id > b.id AND a.filename = b.filename AND a.context_code = b.context_code;

-- 1. files: убрать UNIQUE(filename), добавить file_hash, добавить UNIQUE(filename, context_code)
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_filename_key;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS file_hash TEXT;
ALTER TABLE public.files ADD CONSTRAINT files_filename_context_code_unique UNIQUE (filename, context_code);

-- 2. ai_item: добавить content_hash и needs_rebuild
ALTER TABLE public.ai_item ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE public.ai_item ADD COLUMN IF NOT EXISTS needs_rebuild BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_ai_item_needs_rebuild ON public.ai_item (context_code, needs_rebuild) WHERE needs_rebuild = true;
