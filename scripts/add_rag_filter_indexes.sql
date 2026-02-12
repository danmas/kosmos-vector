-- Миграция: индексы для фильтрации RAG по типам и тегам AI Items
-- Выполнить вручную: psql -d your_db -f scripts/add_rag_filter_indexes.sql
-- См. docs/BACKEND_RAG_FILTER_IMPLEMENTATION.md

-- Индекс по типу AI Item (для itemFilter.typeCodes)
CREATE INDEX IF NOT EXISTS idx_ai_item_type ON public.ai_item (type);

-- tag(code) уже покрыт UNIQUE (context_code, code); при необходимости по одному code:
-- CREATE INDEX IF NOT EXISTS idx_tag_code ON public.tag (code);
-- ai_item_tag: idx_ai_item_tag_ai_item_full_name_context и idx_ai_item_tag_tag_id уже есть в схеме
