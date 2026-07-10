-- Migration: Ontology layer link types + item_type 'concept'
-- См. спецификацию: Ontology/ONTOLOGY_SPEC.md (разделы 4-5)
-- Коды в БД имеют префикс onto_; в MD-файлах понятий используются без префикса.

-- 1. Отношения понятие -> понятие (прямые + обратные)
INSERT INTO kosmos.link_type (code, label, description, is_active)
VALUES
  ('onto_part_of',      'Part of',      'Ontology: концепт является частью другого', true),
  ('onto_has_part',     'Has part',     'Ontology: обратное к part_of', true),
  ('onto_uses',         'Uses',         'Ontology: концепт использует другой', true),
  ('onto_used_by',      'Used by',      'Ontology: обратное к uses', true),
  ('onto_manages',      'Manages',      'Ontology: управление жизненным циклом', true),
  ('onto_managed_by',   'Managed by',   'Ontology: обратное к manages', true),
  ('onto_produces',     'Produces',     'Ontology: концепт порождает другой', true),
  ('onto_produced_by',  'Produced by',  'Ontology: обратное к produces', true),
  ('onto_consumes',     'Consumes',     'Ontology: потребление на входе', true),
  ('onto_consumed_by',  'Consumed by',  'Ontology: обратное к consumes', true),
  ('onto_precedes',     'Precedes (onto)', 'Ontology: порядок в процессе', true),
  ('onto_follows',      'Follows (onto)',  'Ontology: обратное к precedes', true),
  ('onto_related_to',   'Related to',   'Ontology: прочая связь (симметричная)', true)
ON CONFLICT (code) DO NOTHING;

-- 2. Grounding: понятие -> реальность (ai_item, таблица, документ, конфиг)
INSERT INTO kosmos.link_type (code, label, description, is_active)
VALUES
  ('onto_implemented_in', 'Implemented in', 'Grounding: реализовано в коде', true),
  ('onto_stored_in',      'Stored in',      'Grounding: хранится в таблице/структуре', true),
  ('onto_documented_in',  'Documented in',  'Grounding: описано в документе KB', true),
  ('onto_configured_in',  'Configured in',  'Grounding: настраивается в конфиге', true)
ON CONFLICT (code) DO NOTHING;

-- 3. Тип item 'concept'
INSERT INTO kosmos.item_type (context_code, code, name, description, is_system)
VALUES ('DEFAULT', 'concept', 'Понятие онтологии', 'Верхнеуровневое понятие домена; full_name = concept:<id>', true)
ON CONFLICT (context_code, code) DO NOTHING;

-- Verify
SELECT code, label FROM kosmos.link_type WHERE code LIKE 'onto_%' ORDER BY code;
SELECT context_code, code, name FROM kosmos.item_type WHERE code = 'concept';
